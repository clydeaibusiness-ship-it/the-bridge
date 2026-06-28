/**
 * test-run.js — Milestone 1 proof. Generates one issue to the console so we
 * can hear Newsletter Earl's voice before anything is wired to delivery.
 *
 * Uses a representative story by default (GDELT throttles shared IPs hard).
 * Run from the project root:  node server/services/newsletter/test-run.js
 */

require('dotenv').config();

const { pickResources } = require('./library');
const { generateIssue } = require('./write');

// A representative qualifying story: appears across left, center, and right
// outlets, and sits squarely in a survival category (cost of borrowing).
const FIXTURE_STORY = {
  headline: 'Fed holds rates steady, signaling small-business borrowing costs stay high into next quarter',
  summary:
    'The Federal Reserve left its benchmark rate unchanged and signaled no near-term cut. For small businesses, that means lines of credit, equipment loans, and variable-rate debt stay expensive for at least another quarter. Lenders are still tightening terms on Main Street borrowers.',
  categoryLabel: 'Interest rates and the Fed (cost of borrowing)',
  date: new Date().toISOString().slice(0, 10),
  sources: [
    { lean: 'left', domain: 'cnbc.com', title: 'Fed holds rates steady, signals patience on cuts' },
    { lean: 'center', domain: 'reuters.com', title: 'Federal Reserve keeps rates unchanged, cites sticky inflation' },
    { lean: 'right', domain: 'foxbusiness.com', title: 'Fed leaves rates high; small businesses feel the squeeze' },
  ],
};

// The principle to teach for this story: cash and survival math (Lever 4).
const FIXTURE_PRINCIPLE = {
  lever: 4,
  book: 'Profit First',
  author: 'Mike Michalowicz',
  text:
    'Revenue is vanity, profit is sanity, cash is reality. More businesses die from cash flow problems than from lack of revenue. When borrowing is expensive, the business that survives is the one that already takes its profit first and runs on what is left, instead of leaning on credit to paper over thin margins.',
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\nNo ANTHROPIC_API_KEY in env. Add it to .env to run this test.\n');
    process.exit(1);
  }

  const resources = pickResources({ lever: FIXTURE_PRINCIPLE.lever, limit: 5 });
  console.log('\n=== Resource shortlist handed to Earl (Lever 4) ===');
  resources.forEach((r) => console.log(`  ${r.id}  —  ${r.person} (${r.type})`));

  console.log('\nGenerating issue (one Sonnet call)...\n');
  const issue = await generateIssue({
    story: FIXTURE_STORY,
    principle: FIXTURE_PRINCIPLE,
    resources,
  });

  const chosen = resources.find((r) => r.id === issue.resourceId);

  console.log('============================================================');
  console.log('SUBJECT:', issue.subject);
  console.log('============================================================\n');
  console.log('[1 — One thing from the world this week]\n');
  console.log(issue.section1, '\n');
  console.log('[2 — One thing someone else learned the hard way]\n');
  console.log(issue.section2, '\n');
  console.log('[3 — One question to carry into the week]\n');
  console.log(issue.section3, '\n');
  console.log('------------------------------------------------------------');
  console.log('Resource Earl chose:', issue.resourceId, chosen ? `(${chosen.person} — ${chosen.title})` : '(UNMATCHED — check output)');
  console.log('------------------------------------------------------------\n');

  if (!issue.section1 || !issue.section2 || !issue.section3) {
    console.log('NOTE: a section did not parse. Raw output below for inspection:\n');
    console.log(issue.raw);
  }
}

main().catch((e) => {
  console.error('Generation failed:', e.message);
  process.exit(1);
});
