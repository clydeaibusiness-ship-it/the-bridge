// ============================================================
// THE BRIDGE — GAME CONFIGURATION
// ============================================================
// Edit values in this file to adjust any game setting.
// Changes take effect on next page refresh.
// You never need to touch any other file for tuning.
//
// CHANGELOG — note your changes here:
// [date] [what you changed] [why]
// ============================================================

export const CONFIG = {

  // ----------------------------------------------------------
  // POWER SYSTEM
  // ----------------------------------------------------------
  power: {
    totalBudget: 20,
    // Total power the captain has to distribute each turn.
    // Raise this to make the game easier. Lower to make harder.

    startingAllocation: {
      sensors:        3,
      shields:        4,
      weapons:        3,
      engines:        0,        // Locked until mission 4 unlock
      lifesupport:    0,        // Locked until mission 6 unlock
      communications: 0,        // Locked until mission 8 unlock
    },
    // Where power sits at the start of every mission.
    // Unlocked systems start at 0 and are distributed
    // from totalBudget when they unlock.

    adjustmentsPerTurn: 3,
    // Max lever taps per turn (up OR down each count as 1).
    // 3 forces real decisions. Lower = harder. Higher = easier.

    regenerationRate: 0.5,
    // Power each system passively recovers between turns.
    // Higher = more forgiving. Lower = more punishing.
  },

  // ----------------------------------------------------------
  // THREAT SETTINGS
  // ----------------------------------------------------------
  threats: {
    strengthRange: [1, 5],
    // [min, max] strength dots on any threat.

    holdAtPercent: 0.40,
    // Threat pauses at this fraction down the viewscreen (0-1).
    // 0.40 = pauses 40% of the way down. Lower = more warning time.

    driftSpeed: 0.4,
    // Pixels per frame threat moves during approach.
    // Lower = slower = more thinking time.

    warningDuration: 2000,
    // Milliseconds the threat type label is visible on spawn.

    noiseBeginsAtMission: 4,
    // Which mission number noise events start appearing.

    noiseChancePerTurn: 0.30,
    // Probability (0-1) a noise event appears each turn.
    // 0.30 = 30% chance. Raise to increase chaos.

    dualThreatBeginsAt: 5,
    // Mission number when two simultaneous threats can first appear.
  },

  // ----------------------------------------------------------
  // SHIP VISUAL OPACITY RANGES
  // ----------------------------------------------------------
  ship: {
    opacity: {
      sensorsMin:       0.15,   // Sensors nose at power 0
      sensorsMax:       1.00,   // Sensors nose at power 10
      weaponsMin:       0.10,   // Weapon wings at power 0
      weaponsMax:       1.00,   // Weapon wings at power 10
      weaponsTargetAt:  0.50,   // Power ratio when targeting lines appear
      shieldsMin:       0.05,   // Shield ring barely visible at low power
      shieldsMax:       0.85,   // Shield ring clearly visible at high power
      enginesMin:       0.20,   // Engine body at power 0
      enginesMax:       1.00,   // Engine body at power 10
      lifesupportMin:   0.10,   // Cockpit glow at power 0
      lifesupportMax:   0.90,   // Cockpit glow at power 10
      commsMin:         0.10,   // Antenna visibility at power 0
      commsMax:         1.00,   // Antenna visibility at power 10
    },
    engineTrail: {
      minHeight: 10,            // Px — trail at power 0
      maxHeight: 60,            // Px — trail at power 10
    },
    shieldRing: {
      strokeWidthMin: 0.5,      // Ring thickness at low power
      strokeWidthMax: 2.5,      // Ring thickness at high power
    },
    slideDistance: 80,          // Px ship moves laterally on Engine maneuver
    slideDuration: 300,         // Ms the lateral slide takes
  },

  // ----------------------------------------------------------
  // ANIMATION TIMING (milliseconds unless noted)
  // ----------------------------------------------------------
  timing: {
    tapFeedback:        100,    // Button press visual response
    stateChange:        300,    // System activation transitions
    atmospheric:        600,    // Background drift animations
    fragmentBurst:      400,    // Clean counter fragment duration
    shipFlash:          300,    // Ship white flash total duration
    shipFlashPeak:       80,    // Ms ship holds at full white
    statTick:           800,    // Stat bar jump duration
    comboWordDisplay:   600,    // Combo word visible duration
    caseStudySlide:    6000,    // Ms case study tile stays visible
    repairWindow:      3000,    // Ms of passive repair between turns
    unlockCeremony:    4000,    // Total unlock ceremony duration
    realityFlash:      2000,    // Mid-game reality moment duration
    threatHold:         300,    // Ms threat pauses before continuing
    resolutionDelay:    200,    // Ms after GO before resolution starts
  },

  // ----------------------------------------------------------
  // AUDIO
  // ----------------------------------------------------------
  audio: {
    enabled: true,
    volume: 0.4,                // Master volume (0 to 1)

    cleanCounter: {
      tone1: { freq: 523, duration: 0.10 },
      tone2: { freq: 659, duration: 0.15 },
    },
    partialHit: {
      tone1: { freq: 349, duration: 0.20 },
    },
    fullHit: {
      tone1: { freq: 294, duration: 0.12 },
      tone2: { freq: 262, duration: 0.12 },
      tone3: { freq: 220, duration: 0.20 },
    },
    missionComplete: {
      tone1: { freq: 392, duration: 0.15 },
      tone2: { freq: 523, duration: 0.15 },
      tone3: { freq: 659, duration: 0.15 },
      tone4: { freq: 784, duration: 0.30 },
    },
    unlock: {
      tone1: { freq: 392, duration: 0.15 },
      tone2: { freq: 523, duration: 0.15 },
      tone3: { freq: 659, duration: 0.25 },
    },
    systemTones: {
      sensors:        { freq: 880, duration: 0.08 },
      shields:        { freq: 196, duration: 0.15 },
      weapons:        { freq: 660, duration: 0.06 },
      engines:        { freq: 110, duration: 0.12 },
      lifesupport:    { freq: 528, duration: 0.10 },
      communications: { freq: 440, duration: 0.18 },
    },
    noiseEvent:       { freq: 180, duration: 0.25 },
    stagnationWarning:{ freq: 160, duration: 0.40 },
  },

  // ----------------------------------------------------------
  // DOPAMINE STACK
  // ----------------------------------------------------------
  dopamine: {
    fragmentCount:      { min: 10, max: 14 },
    // Number of fragments on clean counter burst.

    fragmentDistance:   { min: 50, max: 90 },
    // Px fragments travel from contact point.

    screenPulseOpacity: 0.12,
    // White overlay intensity on clean counter (0-1).
    // Raise for more dramatic flash. Lower to subtlety.

    screenPulseDuration: 80,
    // Ms the white overlay is visible.

    statTickAmount: 0.4,
    // How much stat bars jump on clean counter (visual only).

    comboWords: {
      2: 'SHARP',
      3: 'PRECISE',
      4: 'COMMANDING',
      5: 'CAPTAIN',
      6: 'SOVEREIGN',
    },

    variableRewardWeights: {
      standard:  60,            // Must sum to 100
      surplus:   25,
      perfect:   10,
      cascade:    5,
    },
  },

  // ----------------------------------------------------------
  // PROGRESSION
  // ----------------------------------------------------------
  progression: {
    threatsToCompleteMission: 8,

    systemUnlockSchedule: {
      sensors:        1,        // Active from mission 1
      shields:        1,
      weapons:        1,
      engines:        4,
      lifesupport:    6,
      communications: 8,
    },

    captaincyPoints: {
      perMissionCompleted:  100,
      perCleanCounter:       10,
      perPassengerAtEnd:      5,
      perComboWord:          25,
      stagnationPenalty:    -50,
      overgrowthPenalty:    -75,
    },

    rankThresholds: {
      ensign:    0,
      lieutenant: 1000,
      commander:  3000,
      captain:    7500,
    },

    decayRate: 0.5,
    // Power lost per system every 3 turns if not fed resources.

    stagnationWarningAfter: 3,
    // Turns without clean counter before stagnation warning fires.

    passengerGrowthRate: 0.15,
    // Fraction of turns that add a passenger when Comms is above 6.
  },

  // ----------------------------------------------------------
  // MISSION TYPES
  // ----------------------------------------------------------
  missions: {
    survive: {
      description: 'Survive {N} threats',
      // {N} is replaced with threatsToCompleteMission
    },
    navigate: {
      description: 'Reach the beacon',
      advanceOnCleanCounter: true,
      stallOnPartialHit: true,
      retreatOnFullHit: true,
      retreatDistance: 1,
    },
    protect: {
      description: 'Protect your crew',
      passengerThreshold: 0.70,
      // Min fraction of starting passengers to survive mission.
    },
  },

  // ----------------------------------------------------------
  // CONVERSION
  // ----------------------------------------------------------
  conversion: {
    realityFlashTrigger: 'damageOnWeakestLever',
    // When to fire the mid-game reality moment.

    debriefsBeforeMemberPrompt: 3,
    // Free debriefs before paid membership prompt appears.

    apiTimeoutFallback: 4000,
    // Ms before static fallback debrief shows if API is slow.

    staticDebriefByDominantSystem: {
      sensors:        'You flew smart. Knowing what was coming saved you more than any weapon. In your business, that edge lives in Information Asymmetry — what you know that your competitors don\'t.',
      shields:        'You built to absorb. Your instinct was to protect what you have rather than grow what you don\'t. That is Capital thinking — deep reserves change what is possible.',
      weapons:        'You competed directly and won. A clearly differentiated business does not need to outspend — it needs to out-position. That is what your Weapons allocation reflects.',
      engines:        'You survived by moving. Positioning and timing kept threats from landing. The question your real business needs to answer is: are you moving toward something or just away from threats?',
      lifesupport:    'Your crew held together when others would have broken. People and Systems are the multipliers that make every other lever more effective. Your instinct to invest here is right.',
      communications: 'You built reach. Network Effects and Habit Design compound quietly until they become the most defensible moat in the business. You were already doing this.',
    },
  },

  // ----------------------------------------------------------
  // LEADERBOARD
  // ----------------------------------------------------------
  leaderboard: {
    industryFilterMinPlayers: 10,
    dailyMissionResetHour: 0,   // UTC hour
  },

  // ----------------------------------------------------------
  // SHIP NAME GENERATION (used before intake is complete)
  // ----------------------------------------------------------
  shipNames: {
    firstWords: [
      'ARDENT', 'CLARITY', 'SIGNAL', 'VANTAGE', 'RESOLVE',
      'BEACON', 'CIPHER', 'MARGIN', 'VECTOR', 'CARDINAL',
      'THRESHOLD', 'BEARING', 'CURRENT', 'APEX', 'MERIDIAN'
    ],
    secondWords: [
      'RISE', 'MARK', 'HOLD', 'FIELD', 'LINE',
      'REACH', 'POINT', 'CHAIN', 'WAVE', 'FRONT',
      'GROUND', 'COURSE', 'GATE', 'EDGE', 'TRACK'
    ],
    prefix: 'ISV',
  },

};
