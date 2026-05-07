/* ============================================
   THE BRIDGE — Threat Engine
   Spawns threats based on lever weaknesses
   ============================================ */

const THREAT_MAP = {
  switchingCosts: 'churn-wave',
  informationAsymmetry: 'blind-side',
  positioning: 'drift',
  capital: 'burn',
  differentiation: 'commoditization',
  time: 'assumption',
  habitDesign: 'noise'
};

const THREAT_NAMES = {
  'churn-wave': 'Churn Wave',
  'blind-side': 'Blind Side',
  'drift': 'Strategic Drift',
  'burn': 'Capital Burn',
  'commoditization': 'Commoditization',
  'assumption': 'False Assumption',
  'noise': 'Market Noise'
};

const THREAT_DESCRIPTIONS = {
  'churn-wave': 'Customers are leaving. Your lock-in isn\'t holding them.',
  'blind-side': 'Something you didn\'t see coming. Your intel failed you.',
  'drift': 'You\'ve lost focus. The market is pulling you off course.',
  'burn': 'Resources draining fast. This one costs more than you can afford.',
  'commoditization': 'Competitors look exactly like you. Price is the only differentiator now.',
  'assumption': 'A foundational assumption just cracked. The ground under you is shifting.',
  'noise': 'Your message is lost in a sea of identical signals.'
};

const THREAT_DEATH_TEMPLATES = {
  'churn-wave': 'Destroyed by customer exodus. Without switching costs, there was nothing keeping them aboard.',
  'blind-side': 'Destroyed by an unseen threat. Without intelligence, there was no warning.',
  'drift': 'Destroyed by strategic drift. Without clear positioning, the business wandered into danger.',
  'burn': 'Destroyed by capital depletion. Without reserves, there was no surviving the hit.',
  'commoditization': 'Destroyed by commoditization. Without differentiation, the business became invisible.',
  'assumption': 'Destroyed by a cracked foundation. Without testing assumptions, the structure gave way.',
  'noise': 'Destroyed by market noise. Without habits formed, customers couldn\'t find you in the chaos.'
};

// Which lever best counters each threat
const THREAT_COUNTER_LEVER = {
  'churn-wave': 'switchingCosts',
  'blind-side': 'informationAsymmetry',
  'drift': 'positioning',
  'burn': 'capital',
  'commoditization': 'differentiation',
  'assumption': 'time',
  'noise': 'habitDesign'
};

/**
 * Select the next threat based on current lever configuration
 * Targets the weakest lever, with some randomness for variety
 */
function selectThreat(levers, previousThreats = []) {
  // Sort levers by value (ascending — weakest first)
  const sorted = Object.entries(levers)
    .filter(([key]) => THREAT_MAP[key]) // only game levers
    .sort(([, a], [, b]) => a - b);

  // Take the bottom 3 weakest levers
  const candidates = sorted.slice(0, 3);

  // Avoid repeating the last threat if possible
  const lastThreat = previousThreats[previousThreats.length - 1];
  const filtered = candidates.filter(([key]) => THREAT_MAP[key] !== lastThreat);

  // Pick from filtered candidates, or all candidates if filtering removed everything
  const pool = filtered.length > 0 ? filtered : candidates;

  // Weighted random — lower values are more likely
  const totalWeight = pool.reduce((sum, [, val]) => sum + (11 - val), 0);
  let roll = Math.random() * totalWeight;

  for (const [key, val] of pool) {
    roll -= (11 - val);
    if (roll <= 0) {
      return THREAT_MAP[key];
    }
  }

  // Fallback
  return THREAT_MAP[pool[0][0]];
}

/**
 * Calculate damage from a threat based on lever configuration
 * Returns { damage, absorbed, leverUsed, leverValue }
 */
function calculateThreatDamage(threatId, levers) {
  const counterLever = THREAT_COUNTER_LEVER[threatId];
  const leverValue = levers[counterLever];

  // Base damage: inverse of lever value
  // Lever at 10: 0.5 damage. Lever at 1: 5 damage
  const baseDamage = (11 - leverValue) * 0.5;

  // Resilience absorbs some damage
  const stats = calculateStats(levers);
  const absorb = stats.resilience * 0.08; // up to ~0.8 absorption at max resilience

  const finalDamage = Math.max(0.2, baseDamage - absorb);

  return {
    damage: Math.round(finalDamage * 10) / 10,
    absorbed: Math.round(absorb * 10) / 10,
    leverUsed: counterLever,
    leverValue: leverValue,
    baseDamage: Math.round(baseDamage * 10) / 10
  };
}

/**
 * Calculate threat drift speed based on informationAsymmetry lever
 * Returns seconds for the threat to cross the battlefield
 */
function calculateThreatSpeed(levers) {
  const intel = levers.informationAsymmetry;
  // At 10: 20 seconds (slow, lots of warning)
  // At 1: 6 seconds (fast, minimal warning)
  return 6 + (intel * 1.4);
}

/**
 * Determine if the ship survives this threat
 * Ship has effective HP derived from stats
 */
function calculateShipHP(stats) {
  return (stats.momentum * 0.3) + (stats.resilience * 0.5) + (stats.clarity * 0.2);
}

/**
 * Get case study for a threat from the loaded case studies data
 */
function getCaseStudy(threatId, caseStudies) {
  const studies = caseStudies[threatId];
  if (!studies || studies.length === 0) return null;
  return studies[Math.floor(Math.random() * studies.length)];
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    THREAT_MAP, THREAT_NAMES, THREAT_DESCRIPTIONS, THREAT_DEATH_TEMPLATES,
    THREAT_COUNTER_LEVER, selectThreat, calculateThreatDamage,
    calculateThreatSpeed, calculateShipHP, getCaseStudy
  };
}
