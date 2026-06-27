/**
 * score.js — the four-factor judge. One Sonnet call grades an issue 1-10 on
 * each factor, harshly. The blended average drives the admin display (best on
 * the left) and the regenerate gate (anything under the threshold gets one
 * swap-and-retry before it can be shown).
 *
 * Grade honestly. A 4 is a 4 — the distinction is the point.
 */

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

const RUBRIC = `You are a hard, fair editor grading a small-business newsletter issue.
Score each factor from 1 to 10. Be critical. Do not inflate. A 4 means a 4.

Factors:
1. news_strength: How much this story actually matters to whether a small
   business survives. Noise scores low; a real shift in the terrain scores high.
2. voice: How well the writing holds the rules — no em dashes, no AI tells, no
   "[X] is not [Y], it's [Z]", no stacked short fragments, varied rhythm, a
   present human voice that does not perform its own cleverness.
3. principle_fit: How well Section 2's principle actually answers what Section 1
   raised, and whether the named human is used as genuine borrowed trust.
4. seo_aio: How likely this issue is to rank in Google and be cited by AI search
   — clear, answer-shaped, self-contained, useful, not keyword-stuffed.

Return ONLY a JSON object, no prose:
{"news_strength":N,"voice":N,"principle_fit":N,"seo_aio":N,"notes":"one short sentence on the weakest leg"}`;

/**
 * Grade one issue.
 * @returns {Object} { news_strength, voice, principle_fit, seo_aio, overall, notes }
 */
async function scoreIssue({ issue, story, principle }) {
  const payload = `STORY: ${story.headline}
CATEGORY: ${story.categoryLabel || ''}
PRINCIPLE TAUGHT: ${principle.book}${principle.author ? ` — ${principle.author}` : ''}: ${principle.text}

ISSUE:
SUBJECT: ${issue.subject}

SECTION 1:
${issue.section1}

SECTION 2:
${issue.section2}

SECTION 3:
${issue.section3}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [{ type: 'text', text: RUBRIC, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: payload }],
  });

  const raw = response.content.find((b) => b.type === 'text')?.text || '';
  const parsed = safeJson(raw);
  if (!parsed) {
    return { news_strength: 0, voice: 0, principle_fit: 0, seo_aio: 0, overall: 0, notes: 'unparseable score', raw };
  }

  const factors = ['news_strength', 'voice', 'principle_fit', 'seo_aio'].map((k) => clamp(parsed[k]));
  const overall = Math.round((factors.reduce((a, b) => a + b, 0) / factors.length) * 10) / 10;
  return {
    news_strength: factors[0],
    voice: factors[1],
    principle_fit: factors[2],
    seo_aio: factors[3],
    overall,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}

function clamp(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return 0;
  return Math.max(1, Math.min(10, Math.round(v * 10) / 10));
}

function safeJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

module.exports = { scoreIssue };
