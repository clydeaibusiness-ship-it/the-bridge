/**
 * match.js — given a qualifying story, choose the lever and the single
 * principle Earl will teach in Section 2.
 *
 * Each survival category maps to the levers that actually answer it. Among the
 * principles under those levers, the one whose wording best overlaps the story
 * is chosen. Deterministic and free; a Haiku matcher can replace this later
 * without changing the interface.
 */

const { byLevers } = require('./principles');
const { tokenize, jaccard } = require('./qualify');

// Survival category → the levers that genuinely speak to it.
// Most route to Capital (4), because survival is almost always a cash question.
const CATEGORY_TO_LEVERS = {
  interest_rates: [4],
  small_business_lending: [4],
  wages_labor_law: [4, 10],
  tariffs_trade: [4, 1],
  small_business_taxes: [4],
  consumer_spending: [1, 5],
  inflation_costs: [4],
  energy_fuel: [4, 9],
  health_insurance: [4, 10],
  commercial_rent: [4],
  payment_processing: [4],
  hiring_labor: [10],
  regulation_compliance: [9, 4],
  supply_chain: [9],
  insurance_costs: [4],
  ai_small_business: [9, 2],
};

/**
 * Choose a principle for a story.
 * @param {Object} story  qualified story (needs categoryId, headline, categoryLabel)
 * @param {Object} [opts]
 * @param {string[]} [opts.excludePrincipleTexts]  principle texts already used recently
 * @returns {{ lever:number, principle:Object } | null}
 */
function matchPrinciple(story, { excludePrincipleTexts = [] } = {}) {
  const levers = CATEGORY_TO_LEVERS[story.categoryId] || [4];
  let candidates = byLevers(levers).filter((p) => !excludePrincipleTexts.includes(p.text));
  if (!candidates.length) candidates = byLevers(levers);
  if (!candidates.length) return null;

  const storyTokens = tokenize(`${story.headline} ${story.categoryLabel || ''}`);

  // Best wording overlap with the story wins; ties keep stable order.
  let best = candidates[0];
  let bestScore = -1;
  for (const p of candidates) {
    const score = jaccard(storyTokens, tokenize(p.text));
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return { lever: best.lever, principle: best };
}

module.exports = { matchPrinciple, CATEGORY_TO_LEVERS };
