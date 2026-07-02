/**
 * write.js — Newsletter Earl writing one issue.
 *
 * Mirrors the product's soul-prefill technique: a silent user prime, soul.md
 * as a cached assistant message (identity), then newsletter-earl.md as the
 * cached system block (the job + the hard rules). Only the material for THIS
 * issue is uncached, because only it changes.
 *
 * Earl is handed the one news story, the one principle to teach, and a small
 * shortlist of resources. He writes three sections and names which resource he
 * chose. Code never picks the resource; Earl does, from the filtered shortlist.
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Native fetch avoids the SDK node-fetch "premature close" on newer Node.
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(typeof globalThis.fetch === 'function' ? { fetch: globalThis.fetch } : {}),
});

const MODEL = 'claude-sonnet-4-6';

function readSystem(file) {
  return fs.readFileSync(path.join(__dirname, '../../../system', file), 'utf8');
}

/**
 * Safety net for the hard rules. Earl is told never to use em dashes; this
 * catches any that slip through so they never reach a reader.
 */
function scrubTells(text) {
  if (!text) return text;
  return text
    .replace(/\s+—\s+/g, ', ') // spaced em dash → comma
    .replace(/\s+–\s+/g, ', ') // spaced en dash → comma
    .replace(/—/g, ', ')
    .replace(/–/g, ', ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Build the uncached "material for this issue" block.
 */
function buildMaterial(story, principle, resources) {
  const sourceLines = (story.sources || [])
    .map((s) => `  - ${s.lean || 'unrated'} | ${s.domain} | ${s.title}`)
    .join('\n');

  const resourceLines = resources
    .map(
      (r) =>
        `  - id: ${r.id}\n    person: ${r.person}${r.polarizing ? '  [POLARIZING: anchor to the idea only, never their platform]' : ''}\n    where: ${r.type} on ${r.platform}\n    about: ${r.anchors}`
    )
    .join('\n');

  return `<material_for_this_issue>

<news_story category="${story.categoryLabel || ''}">
Headline: ${story.headline}
What is reported: ${story.summary}
Reported across these outlets (differing political lean, which is why it qualifies):
${sourceLines || '  (sources list unavailable)'}
</news_story>

<principle_to_teach lever="${principle.lever || ''}">
From: ${principle.book}${principle.author ? ` — ${principle.author}` : ''}
Principle: ${principle.text}
</principle_to_teach>

<resource_shortlist>
Pick exactly ONE of these as the single link in Section 2. Choose the one that
best fits the point you actually make. Name the human, not the format.
${resourceLines}
</resource_shortlist>

<output_contract>
Write the issue and return it EXACTLY in this shape, with these literal markers
on their own lines and nothing before SUBJECT or after the RESOURCE_ID line:

SUBJECT: <one plain subject line, no label words like "Newsletter">
[SECTION 1]
<the news section>
[SECTION 2]
<the principle section, ending by pointing the reader to the one human resource>
[SECTION 3]
<the one question>
[RESOURCE_ID] <the exact id of the resource you chose>
</output_contract>

</material_for_this_issue>`;
}

/**
 * Generate one issue.
 * @returns {Object} { subject, section1, section2, section3, resourceId, raw }
 */
async function generateIssue({ story, principle, resources }) {
  const soul = readSystem('soul.md');
  const instructions = readSystem('newsletter-earl.md');
  const material = buildMaterial(story, principle, resources);

  const systemBlocks = [
    { type: 'text', text: instructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: material },
  ];

  const messages = [
    { role: 'user', content: '.' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: soul, cache_control: { type: 'ephemeral' } }],
    },
    {
      role: 'user',
      content:
        'Write today\'s issue from the material in your context. Three sections, in order. Hold every rule. Return it exactly in the output contract shape.',
    },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1600,
    system: systemBlocks,
    messages,
  });

  const raw = response.content.find((b) => b.type === 'text')?.text || '';
  return { ...parseIssue(raw), raw };
}

/**
 * Parse Earl's structured output back into fields.
 */
function parseIssue(raw) {
  const subjectMatch = raw.match(/SUBJECT:\s*(.+)/);
  const s1 = raw.match(/\[SECTION 1\]\s*([\s\S]*?)\s*\[SECTION 2\]/);
  const s2 = raw.match(/\[SECTION 2\]\s*([\s\S]*?)\s*\[SECTION 3\]/);
  const s3 = raw.match(/\[SECTION 3\]\s*([\s\S]*?)\s*\[RESOURCE_ID\]/);
  const rid = raw.match(/\[RESOURCE_ID\]\s*([^\s]+)/);

  return {
    subject: subjectMatch ? scrubTells(subjectMatch[1]) : '',
    section1: s1 ? scrubTells(s1[1]) : '',
    section2: s2 ? scrubTells(s2[1]) : '',
    section3: s3 ? scrubTells(s3[1]) : '',
    resourceId: rid ? rid[1].trim() : '',
  };
}

const SECTION_NAMES = {
  1: 'Section 1 — one thing from the world this week (the news)',
  2: 'Section 2 — one thing someone else learned the hard way (the principle and the one resource)',
  3: 'Section 3 — one question to carry into the week',
};

/**
 * Regenerate a single section from the same story and principle, in fresh
 * words. Powers the per-box reload on the admin page.
 *
 * @returns {Object} { text, resourceId } (resourceId only meaningful for section 2)
 */
async function regenerateSection({ story, principle, resources, section }) {
  const soul = readSystem('soul.md');
  const instructions = readSystem('newsletter-earl.md');
  const material = buildMaterial(story, principle, resources);

  const isTwo = Number(section) === 2;
  const ask = isTwo
    ? `Rewrite ONLY ${SECTION_NAMES[2]}. Same principle, fresh words. End by pointing the reader to one human from the resource shortlist. Return the section text, then a final line: [RESOURCE_ID] <the id you chose>. Nothing else.`
    : `Rewrite ONLY ${SECTION_NAMES[section]}. Same story, fresh words, every rule held. Return just the new section text and nothing else.`;

  const systemBlocks = [
    { type: 'text', text: instructions, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: material },
  ];
  const messages = [
    { role: 'user', content: '.' },
    { role: 'assistant', content: [{ type: 'text', text: soul, cache_control: { type: 'ephemeral' } }] },
    { role: 'user', content: ask },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: systemBlocks,
    messages,
  });

  const raw = response.content.find((b) => b.type === 'text')?.text || '';
  if (isTwo) {
    const rid = raw.match(/\[RESOURCE_ID\]\s*([^\s]+)/);
    const text = scrubTells(raw.replace(/\[RESOURCE_ID\][\s\S]*$/, ''));
    return { text, resourceId: rid ? rid[1].trim() : '' };
  }
  return { text: scrubTells(raw), resourceId: '' };
}

module.exports = { generateIssue, regenerateSection, parseIssue, scrubTells };
