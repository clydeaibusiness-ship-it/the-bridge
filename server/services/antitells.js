/**
 * antitells.js — one source of truth for the AI writing tells Sasha called out.
 *
 * The newsletter already fought these (see newsletter/write.js); this module
 * lets Earl's *chat voice* and his *notifications* fight them the same way, so
 * the rule can never drift between surfaces. Three layers, same as the letter:
 *   1. BAN_TEXT   — the instruction, dropped into prompts / soul.md.
 *   2. hasTells   — detection, so a background composer can regenerate once.
 *   3. scrubTells — a last-resort, grammar-safe backstop before text ships.
 *
 * The two tells: the negation-flip / antithesis ("not X, it's Y" and its
 * two-sentence cousin "This is not X. This is Y.") and the "sit with it"
 * family ("let that land", "let it breathe").
 */

/** The prompt-level instruction. Reused in soul.md and the composer prompts. */
const BAN_TEXT =
  'Never use the negation-flip / antithesis construction in any form: not the ' +
  'one-sentence "not X, it\'s Y", not the two-sentence "This is not X. This is ' +
  'Y.", and none of its variants ("isn\'t just X, it\'s Y", "not just X, but Y", ' +
  '"less X, more Y"). Never define a thing by what it is not. Say what it IS, ' +
  'once, plainly, and move on. Never tell them to "sit with" something, to "let ' +
  'it sit", "let that land", or "let it breathe". Say the thing and trust them.';

/** The reminder appended when a background draft trips hasTells and is retried. */
const TELL_REMINDER =
  'Your draft used a banned construction: either the negation-flip / antithesis ' +
  '("not X, it\'s Y", or "This is not X. This is Y."), or a "sit with it / let ' +
  'that land" phrase. Rewrite it clean of BOTH. Never define a thing by what it ' +
  'is not. Say what it is, once, and move on.';

/**
 * Detect the tells. Used by background composers (the pulse notification) that
 * can afford to regenerate once. The same regexes the newsletter uses.
 */
function hasTells(text) {
  if (!text) return false;
  const t = String(text);
  return (
    // "not X, it's Y" / "isn't just X, it's Y" / "not just X, but Y" (one sentence)
    /\b(not|isn'?t|aren'?t|wasn'?t|weren'?t|ain'?t)\s+(just\s+)?[a-z][^.,;:]{1,70}[,;]\s+(it'?s|it’s|that'?s|but\b|they'?re|you'?re|it\s+is|that\s+is|they\s+are|you\s+are)/i.test(t) ||
    // "This is not X. This is Y." (two sentences)
    /\b(this|that|it)\s+(is|was)\s+not\b[^.?!]*[.?!]+\s+(this|that|it)\s+(is|was)\b/i.test(t) ||
    /\b(this|that|it)\s+(isn'?t|is\s?n'?t)\b[^.?!]*[.?!]+\s+(this|that|it)\s+(is|was|'?s)\b/i.test(t) ||
    // "sit with it / let that sit / let it land / breathe"
    /\bsit(ting)?\s+with\b/i.test(t) ||
    /\blet\s+(it|that|this)\s+(sit|land|breathe)\b/i.test(t)
  );
}

/**
 * Grammar-safe last resort. Only rewrites phrases that have a clean, drop-in
 * replacement — it never tries to surgically rebuild an antithesis sentence
 * (that is what the instruction and the regenerate pass are for). Kept
 * conservative on purpose so it can run on every outbound string without
 * mangling Earl's grammar.
 */
function scrubTells(text) {
  if (!text) return text;
  return text
    .replace(/\bworth sitting with\b/gi, 'worth remembering')
    .replace(/\bsit with (it|that|this)\b/gi, 'remember $1')
    .replace(/\blet\s+(it|that|this)\s+sit\b/gi, 'remember $1')
    .replace(/\blet\s+(it|that|this)\s+land\b/gi, 'remember $1')
    .replace(/\blet\s+(it|that|this)\s+breathe\b/gi, 'remember $1');
}

module.exports = { BAN_TEXT, TELL_REMINDER, hasTells, scrubTells };
