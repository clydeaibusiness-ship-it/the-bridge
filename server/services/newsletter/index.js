/**
 * index.js — the newsletter orchestrator.
 *
 * Produces the three candidate issues the admin page shows side by side, each
 * built around its own qualifying story, each scored, best first. The gate:
 * any candidate under the threshold gets ONE story-swap-and-retry, then the
 * better of the two is kept and flagged if it still falls short.
 *
 * Usage is NOT stamped here — that happens on send, so the three throwaway
 * drafts never poison the rotation.
 */

const { fetchAll } = require('./gdelt');
const { qualifyStories } = require('./qualify');
const { matchPrinciple } = require('./match');
const { pickResources } = require('./library');
const { generateIssue } = require('./write');
const { scoreIssue } = require('./score');

const GATE_THRESHOLD = 6;

/** Build one full candidate (issue + score) from a story. */
async function buildCandidate(story, usedPrincipleTexts) {
  const match = matchPrinciple(story, { excludePrincipleTexts: usedPrincipleTexts });
  if (!match) return null;

  const resources = pickResources({ lever: match.lever, principle: match.principle.text, limit: 5 });
  const issue = await generateIssue({ story, principle: match.principle, resources });
  const score = await scoreIssue({ issue, story, principle: match.principle });
  const resourceChosen = resources.find((r) => r.id === issue.resourceId) || null;

  return { story, principle: match.principle, resources, resourceChosen, issue, score };
}

/**
 * Generate the candidate set.
 * @param {Object} [opts]
 * @param {number} [opts.count]          how many candidates (default 3)
 * @param {number} [opts.gateThreshold]  min overall before regenerate (default 6)
 * @param {string} [opts.timespan]       GDELT lookback (default '2d')
 * @returns {Promise<{candidates:Array, research:Object}>}
 */
async function generateCandidates({ count = 3, gateThreshold = GATE_THRESHOLD, timespan = '2d', onProgress } = {}) {
  const report = (stage, detail) => { try { onProgress && onProgress({ stage, detail }); } catch (_) {} };

  report('fetching', 'pulling the news');
  const articles = await fetchAll({ timespan });
  report('qualifying', `${articles.length} articles`);
  const stories = qualifyStories(articles);

  if (!stories.length) {
    return { candidates: [], research: { articleCount: articles.length, storyCount: 0, note: 'no qualifying stories' } };
  }

  const candidates = [];
  const usedPrincipleTexts = [];
  let ptr = 0; // pointer into the ranked story pool

  while (candidates.length < count && ptr < stories.length) {
    report('writing', `issue ${candidates.length + 1} of ${count}`);
    const storyA = stories[ptr++];
    let best = await buildCandidate(storyA, usedPrincipleTexts);
    if (!best) continue;

    // Gate: one swap-and-retry if it can't clear the bar.
    if (best.score.overall < gateThreshold && ptr < stories.length) {
      const storyB = stories[ptr++];
      const alt = await buildCandidate(storyB, usedPrincipleTexts);
      if (alt && alt.score.overall > best.score.overall) best = alt;
    }

    best.flagged = best.score.overall < gateThreshold;
    usedPrincipleTexts.push(best.principle.text);
    candidates.push(best);
  }

  // Best on the left.
  candidates.sort((a, b) => b.score.overall - a.score.overall);

  return {
    candidates,
    research: {
      articleCount: articles.length,
      storyCount: stories.length,
      crossSpectrum: stories.filter((s) => s.crossSpectrum).length,
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = { generateCandidates, buildCandidate, GATE_THRESHOLD };
