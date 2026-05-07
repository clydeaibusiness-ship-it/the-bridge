/* ============================================
   THE BRIDGE — Lever Mechanics & Stat Calculations
   Pure client-side logic, no API calls
   ============================================ */

const LEVER_NAMES = {
  positioning: 'Positioning',
  informationAsymmetry: 'Intel',
  time: 'Time',
  capital: 'Capital',
  differentiation: 'Edge',
  habitDesign: 'Habit',
  switchingCosts: 'Lock-In'
};

const LEVER_KEYS = Object.keys(LEVER_NAMES);

const FOCUS_POINTS_PER_TURN = 20;
const LEVER_ADJUST_COST = 2; // per point of increase
// Decreasing a lever costs nothing
// High People (from Big Book lever 10) reduces costs by 1
// Low People increases costs by 1
// Note: People is a strategic lever in the framework but not a game slider.
// Its influence is baked into the focus economy via intake answers.

const STAT_WEIGHTS = {
  momentum: {
    positioning: 0.35,
    differentiation: 0.35,
    habitDesign: 0.30
  },
  resilience: {
    switchingCosts: 0.40,
    capital: 0.35,
    time: 0.25
  },
  clarity: {
    informationAsymmetry: 0.45,
    positioning: 0.30,
    time: 0.25
  }
};

/**
 * Calculate starting lever positions from intake answers
 */
function calculateStartingLevers(intake) {
  return {
    positioning: scorePositioning(intake),
    informationAsymmetry: scoreInfoAsymmetry(intake),
    time: scoreTime(intake),
    capital: scoreCapital(intake),
    differentiation: scoreDifferentiation(intake),
    habitDesign: scoreHabitDesign(intake),
    switchingCosts: scoreSwitchingCosts(intake)
  };
}

function clamp(val, min = 1, max = 10) {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function scorePositioning(a) {
  let s = 5;
  if (a.customerClarity === 'very_clear') s += 2;
  else if (a.customerClarity === 'somewhat_clear') s += 1;
  else if (a.customerClarity === 'vague') s -= 2;

  if (a.competitiveAdvantage === 'strong') s += 2;
  else if (a.competitiveAdvantage === 'moderate') s += 1;
  else if (a.competitiveAdvantage === 'unclear') s -= 2;

  return clamp(s);
}

function scoreInfoAsymmetry(a) {
  let s = 5;
  if (a.customerInsight === 'deep') s += 2;
  else if (a.customerInsight === 'surface') s -= 1;
  else if (a.customerInsight === 'guessing') s -= 3;

  if (a.dataUsage === 'systematic') s += 1;
  else if (a.dataUsage === 'none') s -= 1;

  return clamp(s);
}

function scoreTime(a) {
  let s = 5;
  if (a.timeAllocation === 'strategic') s += 2;
  else if (a.timeAllocation === 'mixed') s += 0;
  else if (a.timeAllocation === 'reactive') s -= 2;

  if (a.decisionSpeed === 'deliberate') s += 1;
  else if (a.decisionSpeed === 'slow') s -= 1;

  return clamp(s);
}

function scoreCapital(a) {
  let s = 5;
  if (a.runway === 'comfortable') s += 2;
  else if (a.runway === 'tight') s -= 1;
  else if (a.runway === 'critical') s -= 3;

  if (a.investmentApproach === 'calculated') s += 1;
  else if (a.investmentApproach === 'scattered') s -= 1;

  return clamp(s);
}

function scoreDifferentiation(a) {
  let s = 5;
  if (a.uniqueness === 'very_unique') s += 3;
  else if (a.uniqueness === 'somewhat_unique') s += 1;
  else if (a.uniqueness === 'commodity') s -= 3;

  return clamp(s);
}

function scoreHabitDesign(a) {
  let s = 5;
  if (a.repeatBehavior === 'habitual') s += 2;
  else if (a.repeatBehavior === 'occasional') s += 0;
  else if (a.repeatBehavior === 'one_time') s -= 2;

  if (a.triggerClarity === 'clear') s += 1;
  else if (a.triggerClarity === 'unclear') s -= 1;

  return clamp(s);
}

function scoreSwitchingCosts(a) {
  let s = 5;
  if (a.customerInvestment === 'high') s += 2;
  else if (a.customerInvestment === 'moderate') s += 1;
  else if (a.customerInvestment === 'low') s -= 2;

  if (a.dataLock === 'significant') s += 1;
  else if (a.dataLock === 'none') s -= 1;

  return clamp(s);
}

/**
 * Calculate the three stats from current lever values
 */
function calculateStats(levers) {
  return {
    momentum: weightedScore(levers, STAT_WEIGHTS.momentum),
    resilience: weightedScore(levers, STAT_WEIGHTS.resilience),
    clarity: weightedScore(levers, STAT_WEIGHTS.clarity)
  };
}

function weightedScore(levers, weights) {
  return Object.entries(weights).reduce((total, [lever, weight]) => {
    return total + (levers[lever] * weight);
  }, 0);
}

/**
 * Calculate focus point cost for a lever change
 * Increasing costs LEVER_ADJUST_COST per point. Decreasing is free.
 */
function calculateAdjustmentCost(oldValue, newValue, peopleMod = 0) {
  if (newValue <= oldValue) return 0;
  const diff = newValue - oldValue;
  const costPerPoint = Math.max(1, LEVER_ADJUST_COST + peopleMod);
  return diff * costPerPoint;
}

/**
 * Validate a set of lever changes against available focus points
 */
function validateLeverChanges(oldLevers, newLevers, focusPoints, peopleMod = 0) {
  let totalCost = 0;
  for (const key of LEVER_KEYS) {
    totalCost += calculateAdjustmentCost(oldLevers[key], newLevers[key], peopleMod);
  }
  return {
    valid: totalCost <= focusPoints,
    cost: totalCost,
    remaining: focusPoints - totalCost
  };
}

/**
 * Generate plain English diagnosis from stats
 */
function generateDiagnosis(stats, levers) {
  const lowestLever = LEVER_KEYS.reduce((min, key) =>
    levers[key] < levers[min] ? key : min
  , LEVER_KEYS[0]);

  const diagnoses = {
    positioning: "Your positioning is weak — customers can't tell why you're different.",
    informationAsymmetry: "You're flying blind. Your competitors know things you don't.",
    time: "You're spending time on the wrong things. The 80/20 is inverted.",
    capital: "Capital is running thin. Every bet needs to count from here.",
    differentiation: "You look like everyone else. That's a race to the bottom.",
    habitDesign: "Customers aren't coming back on autopilot. Each return is a conscious decision.",
    switchingCosts: "There's nothing keeping customers from walking. The door is wide open."
  };

  let line = diagnoses[lowestLever];

  if (stats.momentum < 3) {
    line += " Forward progress has stalled.";
  } else if (stats.resilience < 3) {
    line += " One more hit could end this run.";
  } else if (stats.clarity < 3) {
    line += " You can't navigate what you can't see.";
  }

  return line;
}

// Export for use in game.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LEVER_NAMES, LEVER_KEYS, FOCUS_POINTS_PER_TURN, LEVER_ADJUST_COST,
    STAT_WEIGHTS, calculateStartingLevers, calculateStats, calculateAdjustmentCost,
    validateLeverChanges, generateDiagnosis, clamp
  };
}
