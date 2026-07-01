/**
 * memory-eval.js — acceptance checks for Earl's memory system, run against a
 * throwaway test user so no real member data is touched.
 *
 *   node scripts/memory-eval.js               # deterministic checks (no LLM)
 *   node scripts/memory-eval.js --derive      # + derivation round-trip (LLM calls)
 *
 * Covers: recency outranks older facts, supersession hides contradicted facts,
 * time gaps soften detail while preserving conclusions, resolved vs deflected
 * ledger rendering, per-user erasure, and rebuild-from-transcript.
 */

require('dotenv').config();

const store = require('../server/services/memory/store');
const { embed } = require('../server/services/memory/embed');
const { buildMemoryContext } = require('../server/services/memory/context');
const { deriveSession } = require('../server/services/memory/derive');

const TEST_USER = '00000000-0000-4000-8000-00000000ea51';
const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function seedFact(text, daysOld) {
  const embedding = await embed(text);
  return store.insertFact({ userId: TEST_USER, fact: text, embedding, asOf: ago(daysOld) });
}

async function deterministic() {
  console.log('\n== Deterministic checks ==');
  await store.wipeMemory(TEST_USER);

  // AC3: recency + supersession.
  const oldId = await seedFact('The member\'s company focuses on residential remodeling work.', 35);
  const newId = await seedFact('The member pivoted the company to commercial remodeling contracts.', 1);
  await store.supersedeFact(oldId, newId);
  const q = await embed('what kind of remodeling work do they focus on');
  const hits = await store.searchFacts(TEST_USER, q, 10);
  check('superseded fact hidden from retrieval', !hits.some((h) => h.id === oldId));
  check('current fact retrievable', hits.some((h) => h.id === newId));

  // Seed material for softening checks.
  await seedFact('The member\'s lead technician Marcus has been repeatedly late to job sites.', 2);
  await seedFact('The member concluded the shop needs a second estimator before spring.', 40);
  await store.insertLedgerEntry({ userId: TEST_USER, topic: 'September price increase', conclusion: 'Prices go up 8 percent in September.', reasoning: 'Material costs rose and the calendar is already full.', status: 'resolved', decidedAt: ago(10) });
  await store.insertLedgerEntry({ userId: TEST_USER, topic: 'Bookkeeping backlog', conclusion: 'The member changes the subject whenever the books come up.', status: 'deflected' });
  await store.insertLedgerEntry({ userId: TEST_USER, topic: 'Hiring an office manager', conclusion: 'Named as a problem, no decision yet.', status: 'open' });

  // AC2 mechanism: relevant fact lands in the assembled context.
  const ctxNow = await buildMemoryContext(TEST_USER, 'the Marcus situation got worse this week', { now: new Date() });
  check('cross-session fact present in context', /Marcus/.test(ctxNow || ''));

  // AC4: a 50-day gap softens detail but keeps conclusions and settled items.
  const ctxLater = await buildMemoryContext(TEST_USER, 'the Marcus situation got worse this week', { now: new Date(Date.now() + 50 * DAY) });
  const marcusRecent = (ctxNow || '').includes('Recent:') && /Recent:[\s\S]*Marcus/.test(ctxNow || '');
  check('fresh fact rendered as recent detail today', marcusRecent);
  check('same fact demoted or dropped after 50-day gap', !/Recent:[\s\S]*Marcus/.test(ctxLater || ''));
  check('resolved decision survives the gap', /September price increase/.test(ctxLater || ''));

  // AC5 mechanism: statuses render with the right instructions.
  check('resolved renders as do-not-reopen', /RESOLVED[\s\S]*September[\s\S]*do not reopen/i.test(ctxNow || ''));
  check('deflected renders as return-to-gently', /AVOIDED[\s\S]*Bookkeeping[\s\S]*gently/i.test(ctxNow || ''));
  check('open thread renders as open', /OPEN: Hiring an office manager/.test(ctxNow || ''));

  // AC9: erasure.
  await store.wipeMemory(TEST_USER);
  const afterWipe = await buildMemoryContext(TEST_USER, 'anything at all', { now: new Date() });
  const factsAfter = await store.listFacts(TEST_USER);
  const ledgerAfter = await store.listLedger(TEST_USER);
  check('erasure removes everything', afterWipe === null && factsAfter.length === 0 && ledgerAfter.length === 0);
}

const SYNTHETIC_SESSION = [
  { message_role: 'user', message_content: 'My lead tech Marcus was late again yesterday, third time this month. The crew waited forty minutes at the Hendersons\' place.', created_at: ago(1) },
  { message_role: 'assistant', message_content: 'Third time is a pattern, not an accident. What have you actually said to Marcus about it?', created_at: ago(1) },
  { message_role: 'user', message_content: 'I finally decided on the pricing thing. We are raising prices eight percent in September. Materials are up and the calendar is full, it is the right call and I am done going back and forth on it.', created_at: ago(1) },
  { message_role: 'assistant', message_content: 'Good. That is a reasoned call and the numbers back it. Now, we still have not looked at your books this quarter.', created_at: ago(1) },
  { message_role: 'user', message_content: 'Yeah, anyway, the other thing is the new van, I think we will wrap it with the logo next month.', created_at: ago(1) },
  { message_role: 'assistant', message_content: 'Noted, and I saw what you did there with the books. We will come back to that.', created_at: ago(1) },
];

async function derivation() {
  console.log('\n== Derivation round-trip (LLM) ==');
  await store.wipeMemory(TEST_USER);
  const sessionId = '00000000-0000-4000-8000-00000000e5e5';

  const r1 = await deriveSession(TEST_USER, sessionId, { messages: SYNTHETIC_SESSION, asOf: ago(1) });
  console.log('  derived:', JSON.stringify(r1));
  const facts = await store.listFacts(TEST_USER);
  const ledger = await store.listLedger(TEST_USER);
  check('derivation extracted facts', facts.length >= 1);
  check('Marcus fact captured', facts.some((f) => /Marcus/.test(f.fact)));
  check('price decision recorded as resolved', ledger.some((l) => l.status === 'resolved' && /pric/i.test(l.topic + l.conclusion)));
  check('bookkeeping dodge recorded as deflected', ledger.some((l) => l.status === 'deflected' && /book/i.test(l.topic + l.conclusion)));

  // AC10: rebuildability — wipe, re-derive from the same transcript, re-assert.
  await store.wipeMemory(TEST_USER);
  await deriveSession(TEST_USER, sessionId, { messages: SYNTHETIC_SESSION, asOf: ago(1) });
  const facts2 = await store.listFacts(TEST_USER);
  check('memory rebuilds from transcript alone', facts2.some((f) => /Marcus/.test(f.fact)));

  await store.wipeMemory(TEST_USER);
}

async function main() {
  console.log('Memory acceptance checks (test user, no real member data touched)');
  await deterministic();
  if (process.argv.includes('--derive')) await derivation();
  else console.log('\n(skipping LLM derivation round-trip; run with --derive to include it)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('Eval fatal:', e); process.exit(1); });
