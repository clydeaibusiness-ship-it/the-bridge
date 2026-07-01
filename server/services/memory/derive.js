/**
 * derive.js — turns a finished session into structured memory, and writes
 * the member's profile document. These are the only LLM calls in the memory
 * system, and they go to Anthropic only (the same party that already sees
 * every message). Pure data extraction: nothing here touches Earl's soul,
 * voice, or behavior.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getCommanderSessionMessages } = require('../supabase');
const { embed } = require('./embed');
const store = require('./store');

// Native fetch when available: the SDK's bundled node-fetch breaks on newer
// Node versions (premature close on gzipped responses).
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(typeof globalThis.fetch === 'function' ? { fetch: globalThis.fetch } : {}),
});
const MODEL = 'claude-sonnet-4-6';

function parseJson(text, label) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error(label + ': non-JSON response: ' + String(text).slice(0, 200));
  return JSON.parse(m[0]);
}

/**
 * Derive memory from one session. Reads the transcript, compares against the
 * member's existing facts and ledger, then writes new facts (with supersession
 * of contradicted ones), decisions with status, and deflections.
 *
 * opts.messages lets callers (backfill, eval) supply the transcript directly;
 * opts.asOf timestamps the derived facts (used by backfill so history keeps
 * its real dates, which is what the decay slope runs on).
 */
async function deriveSession(userId, sessionId, opts = {}) {
  let messages = opts.messages;
  if (!messages) messages = await getCommanderSessionMessages(userId, sessionId);
  messages = (messages || []).filter((m) => m.message_role === 'user' || m.message_role === 'assistant');
  if (messages.length < 4) return { facts: 0, decisions: 0, deflections: 0, skipped: 'too short' };

  const asOf = opts.asOf || messages[messages.length - 1].created_at || new Date().toISOString();
  const transcript = messages
    .map((m) => `${m.message_role === 'user' ? 'Member' : 'Earl'}: ${m.message_content}`)
    .join('\n\n');

  const existingFacts = await store.listFacts(userId, 150);
  const existingLedger = await store.listLedger(userId, 40);

  const factsBlock = existingFacts.length
    ? existingFacts.map((f) => `[${f.id}] ${f.fact}`).join('\n')
    : '(none yet)';
  const ledgerBlock = existingLedger.length
    ? existingLedger.map((l) => `[${l.id}] (${l.status}) ${l.topic}: ${l.conclusion}`).join('\n')
    : '(none yet)';

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: 'You maintain the long-term memory of a business mentor. You extract durable knowledge from one advisory conversation, reconciling it against what is already known. Be precise and conservative: only record what the member actually said or clearly established. Return ONLY a JSON object, no markdown, no prose.',
    messages: [{
      role: 'user',
      content: `EXISTING FACTS about this member (with ids):
${factsBlock}

EXISTING LEDGER of decisions and threads (with ids):
${ledgerBlock}

NEW CONVERSATION:
${transcript}

Extract and reconcile. Return this JSON shape:
{
  "facts": [
    {"text": "one durable, specific, self-contained fact about the member or their business",
     "confirms": "existing fact id if this merely restates it, else null",
     "supersedes": "existing fact id if this contradicts/replaces it, else null"}
  ],
  "decisions": [
    {"topic": "short topic name",
     "conclusion": "what was concluded or where it stands",
     "reasoning": "the member's reasoning, one or two sentences",
     "status": "resolved" or "open",
     "updates": "existing ledger id if this changes an existing entry, else null"}
  ],
  "deflections": [
    {"topic": "short topic name", "note": "what the member avoided or deflected, and how"}
  ]
}

Rules:
- Facts must stand alone without the conversation (say "the member's lead tech Marcus", not "he").
- Skip pleasantries, hypotheticals, and Earl's own advice unless the member adopted it.
- "resolved" means the member reached a reasoned conclusion. A topic the member dodged, changed the subject on, or refused to engage with belongs in deflections, never in decisions.
- If an existing deflection was finally engaged and settled, emit a decision with "updates" pointing at that ledger id and status "resolved".
- Empty arrays are fine. Do not pad.`
    }],
  });

  const parsed = parseJson(response.content[0].text, 'deriveSession');
  const factIds = new Set(existingFacts.map((f) => f.id));
  const ledgerIds = new Set(existingLedger.map((l) => l.id));
  let nFacts = 0, nDecisions = 0, nDeflections = 0;

  for (const f of parsed.facts || []) {
    if (!f || !f.text) continue;
    if (f.confirms && factIds.has(f.confirms)) {
      await store.confirmFact(f.confirms, asOf);
      continue;
    }
    const embedding = await embed(f.text);
    const newId = await store.insertFact({ userId, fact: f.text, embedding, sourceSession: sessionId, asOf });
    if (f.supersedes && factIds.has(f.supersedes)) await store.supersedeFact(f.supersedes, newId);
    nFacts++;
  }

  for (const d of parsed.decisions || []) {
    if (!d || !d.topic || !d.conclusion) continue;
    const status = d.status === 'resolved' ? 'resolved' : 'open';
    const decidedAt = status === 'resolved' ? new Date(asOf).toISOString() : null;
    if (d.updates && ledgerIds.has(d.updates)) {
      await store.updateLedgerEntry(d.updates, { conclusion: d.conclusion, reasoning: d.reasoning || null, status, decided_at: decidedAt });
    } else {
      await store.insertLedgerEntry({ userId, topic: d.topic, conclusion: d.conclusion, reasoning: d.reasoning || null, status, decidedAt });
    }
    nDecisions++;
  }

  for (const def of parsed.deflections || []) {
    if (!def || !def.topic) continue;
    const existing = existingLedger.find(
      (l) => l.status === 'deflected' && l.topic.toLowerCase() === String(def.topic).toLowerCase()
    );
    if (existing) {
      await store.updateLedgerEntry(existing.id, { conclusion: def.note || existing.conclusion });
    } else {
      await store.insertLedgerEntry({ userId, topic: def.topic, conclusion: def.note || 'The member has avoided this topic.', status: 'deflected' });
    }
    nDeflections++;
  }

  return { facts: nFacts, decisions: nDecisions, deflections: nDeflections };
}

/**
 * Rewrite the member's profile document from everything currently known.
 * The nightly reflection: the mentor updating his private file on a person.
 */
async function refreshProfile(userId) {
  const facts = await store.listFacts(userId, 200);
  const ledger = await store.listLedger(userId, 40);
  if (!facts.length && !ledger.length) return false;

  const existing = await store.getProfile(userId);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: 'You maintain a business mentor\'s private file on a member he has advised for months. Write it as durable knowledge: plain, specific, dated where dates are known. No advice, no flattery, no speculation beyond what the record supports. Return only the file text, no preamble.',
    messages: [{
      role: 'user',
      content: `${existing ? 'CURRENT FILE (rewrite it, keeping what still holds):\n' + existing.profile + '\n\n' : ''}KNOWN FACTS (with freshness dates):
${facts.map((f) => `- ${f.fact} (as of ${String(f.last_confirmed).slice(0, 10)})`).join('\n')}

DECISIONS AND THREADS:
${ledger.map((l) => `- (${l.status}) ${l.topic}: ${l.conclusion}`).join('\n')}

Write the updated file with these sections, each a short paragraph or tight bullets:
WHO THEY ARE / HOW THEY DECIDE / WHAT DRIVES AND WORRIES THEM / THE BUSINESS ARC / STANDING DECISIONS / WATCH LIST (things avoided or left open).
Keep it under 400 words. Older detail collapses into conclusions; recent specifics may stay specific.`
    }],
  });

  const profile = response.content[0].text.trim();
  if (!profile) return false;
  await store.saveProfile(userId, profile);
  return true;
}

module.exports = { deriveSession, refreshProfile };
