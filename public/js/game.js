import { CONFIG }          from '/config.js';
import { renderStarfield } from './starfield.js';
import { initShip,
         updateShipVisuals,
         animateWeapons,
         animateShields,
         animateEngines,
         animateShipHit,
         animateShipFlash,
         animateShipDestroyed } from './ship.js';
import { initLevers,
         allocatePower,
         getSystemValues,
         setSystemValues,
         resetAdjustments,
         unlockSystem,
         applyPassiveRegeneration } from './levers.js';
import { initThreats,
         spawnThreat,
         advanceThreat,
         releaseThreat,
         getThreatState,
         clearThreats,
         destroyThreat,
         spawnNoise,
         advanceNoise,
         checkNoiseCollision } from './threats.js';
import { playCleanCounter,
         playPartialHit,
         playFullHit,
         playMissionComplete,
         playUnlock,
         playNoise,
         playStagnationWarning,
         hapticHit,
         hapticCleanCounter,
         hapticMissionComplete,
         hapticUnlock } from './audio.js';
import { logEvent }        from './analytics.js';

// ============================================================
// GAME.JS — Orchestrator only. No logic lives here.
// Calls other modules. Manages game state machine.
// ============================================================

// ── GAME STATE ──
const state = {
  mission:         1,
  turn:            0,
  threatsResolved: 0,
  shipPosition:    'center',   // 'left' | 'center' | 'right'
  combo:           0,
  passengers:      5,
  stagnantTurns:   0,
  realityFlashFired: false,
  stats: {
    momentum:   7,
    resilience: 7,
    clarity:    7,
  },
  phase: 'idle',
  // 'idle' | 'threat_approaching' | 'threat_held' |
  // 'resolving' | 'between_turns' | 'mission_complete' | 'dead'
};

// ── INIT ──
async function init() {
  renderStarfield('starfield');
  initShip('ship-container');

  // Size threat canvas to viewscreen
  const vs     = document.getElementById('viewscreen');
  const canvas = document.createElement('canvas');
  canvas.id    = 'threat-canvas';
  canvas.style.cssText =
    'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
  canvas.width  = vs.clientWidth;
  canvas.height = vs.clientHeight;
  document.getElementById('threat-area').appendChild(canvas);

  await initThreats(canvas);
  initLevers(state.mission);
  updateStats();

  // Wire GO button
  document.getElementById('btn-go')
    ?.addEventListener('click', onGoPressed);

  // Wire exit button
  document.getElementById('btn-exit')
    ?.addEventListener('click', showExitModal);

  document.getElementById('exit-save')
    ?.addEventListener('click', () => saveAndExit());
  document.getElementById('exit-leave')
    ?.addEventListener('click', () => window.location.href = '/');
  document.getElementById('exit-stay')
    ?.addEventListener('click', hideExitModal);

  // Wire death screen buttons
  document.getElementById('death-save')
    ?.addEventListener('click', () => {
      hideDeathScreen();
      showEmailCapture();
    });
  document.getElementById('death-member')
    ?.addEventListener('click', () => {
      window.location.href = '/?from=game&ship=' +
        encodeURIComponent(getShipName());
    });

  // Check if intake needed
  if (!localStorage.getItem('bridge_intake_done')) {
    await runIntake();
  }

  // Run tutorial on first visit
  if (!localStorage.getItem('bridge_tutorial_done')) {
    await runTutorial();
  }

  startMission();
}

// ── INTAKE ──
function runIntake() {
  return new Promise(resolve => {
    const overlay = document.getElementById('intake-overlay');
    if (!overlay) { resolve(); return; }

    overlay.classList.remove('hidden');

    document.getElementById('intake-submit')
      ?.addEventListener('click', () => {
        const answers = collectIntakeAnswers();
        localStorage.setItem('bridge_intake', JSON.stringify(answers));
        localStorage.setItem('bridge_intake_done', '1');

        // Score levers from intake
        const scored = scoreLeverFromIntake(answers);
        setSystemValues(scored);

        // Generate ship name
        generateShipName(answers);

        overlay.classList.add('hidden');
        resolve();
      });

    document.getElementById('intake-skip')
      ?.addEventListener('click', () => {
        localStorage.setItem('bridge_intake_done', '1');
        generateShipName({});
        overlay.classList.add('hidden');
        resolve();
      });
  });
}

function collectIntakeAnswers() {
  return {
    business:    document.getElementById('intake-business')?.value || '',
    age:         document.getElementById('intake-age')?.value || 'established',
    repeat:      document.getElementById('intake-repeat')?.value || 'medium',
    switching:   document.getElementById('intake-switching')?.value || 'medium',
    systems:     document.getElementById('intake-systems')?.value || 'medium',
    capital:     document.getElementById('intake-capital')?.value || 'medium',
    uncertainty: document.getElementById('intake-uncertainty')?.value || '',
  };
}

function scoreLeverFromIntake(answers) {
  return {
    sensors: answers.uncertainty ? 4 : 5,
    shields: { high: 7, medium: 5, low: 3 }[answers.capital] || 5,
    weapons: { established: 6, mature: 7, early: 4, new: 3 }[answers.age] || 5,
    engines: 0,        // Locked until mission 4
    lifesupport: { high: 7, medium: 5, low: 3 }[answers.systems] || 5,
    communications: { high: 7, medium: 5, low: 3 }[answers.repeat] || 5,
  };
}

function generateShipName(answers) {
  const cfg = CONFIG.shipNames;
  const first = cfg.firstWords[Math.floor(Math.random() * cfg.firstWords.length)];
  const second = cfg.secondWords[Math.floor(Math.random() * cfg.secondWords.length)];
  const name = `${cfg.prefix} ${first} ${second}`;
  localStorage.setItem('bridge_ship_name', name);
  return name;
}

// ── MISSION ──
function startMission() {
  state.phase           = 'idle';
  state.threatsResolved = 0;
  state.turn            = 0;
  state.realityFlashFired = false;

  updateMissionObjective();
  updateTurnCounter();
  document.getElementById('mission-number').textContent = state.mission;

  setTimeout(beginTurn, 800);
}

function beginTurn() {
  if (state.phase === 'dead') return;

  // Passive regeneration
  applyPassiveRegeneration();

  // Reset adjustments
  resetAdjustments();

  // Decay check
  checkDecay();

  // Check stagnation
  if (state.stagnantTurns >= CONFIG.progression.stagnationWarningAfter) {
    showDiagnosis('You\'re holding position. Standing still is moving backward.');
    playStagnationWarning();
    applyStagnationDecay();
  }

  // Spawn noise after mission threshold
  if (state.mission >= CONFIG.threats.noiseBeginsAtMission &&
      Math.random() < CONFIG.threats.noiseChancePerTurn) {
    spawnNoise();
    playNoise();
  }

  // Spawn threat
  const threat = spawnThreat(state.mission);
  if (!threat) return;

  state.phase = 'threat_approaching';
  state.turn++;
  updateTurnCounter();

  // Animate threat approach
  const approachInterval = setInterval(() => {
    advanceThreat();
    advanceNoise();

    const t = getThreatState();
    if (t?.held) {
      clearInterval(approachInterval);
      state.phase = 'threat_held';

      // Highlight relevant system
      highlightSystem(threat.system);
    }
  }, 16);
}

// ── RESOLUTION ──
function onGoPressed() {
  if (state.phase !== 'threat_held') return;

  state.phase = 'resolving';
  document.getElementById('btn-go').disabled = true;

  const systems = getSystemValues();
  const threat  = getThreatState();
  if (!threat) return;

  clearSystemHighlight();

  // Check noise collision
  const noiseDamage = checkNoiseCollision(state.shipPosition);
  if (noiseDamage) {
    applyDamage('resilience', 0.3);
  }

  // Calculate outcome
  const outcome = calculateOutcome(systems, threat);

  // Animate ship response
  animateResolution(systems, threat, outcome, () => {
    applyOutcome(outcome, threat);
    showPostResolution(threat, outcome);

    setTimeout(() => {
      state.phase = 'between_turns';
      clearThreats();
      hideDiagnosis();

      // Check mission complete
      state.threatsResolved++;
      if (state.threatsResolved >=
          CONFIG.progression.threatsToCompleteMission) {
        completeMission();
        return;
      }

      // Check unlock
      const unlock = checkUnlock();
      if (unlock) {
        showUnlockCeremony(unlock, () => beginTurn());
      } else {
        beginTurn();
      }
    }, CONFIG.timing.caseStudySlide + 500);
  });
}

function calculateOutcome(systems, threat) {
  const sysVal  = systems[threat.system] || 0;
  const threshold = threat.strength * 1.5;

  if (sysVal >= threshold + 2) return 'clean';
  if (sysVal >= threshold - 1) return 'partial';
  return 'full';
}

function animateResolution(systems, threat, outcome, onComplete) {
  const primary = getPrimarySystem(systems);

  switch (primary) {
    case 'weapons':
      animateWeapons(() => finishResolution(outcome, onComplete));
      break;
    case 'shields':
      animateShields(() => finishResolution(outcome, onComplete));
      break;
    case 'engines': {
      const dir = Math.random() > 0.5 ? 'left' : 'right';
      state.shipPosition = dir;
      animateEngines(dir, () => finishResolution(outcome, onComplete));
      break;
    }
    default:
      setTimeout(() => finishResolution(outcome, onComplete), 300);
  }
}

function finishResolution(outcome, onComplete) {
  releaseThreat();
  destroyThreat();

  switch (outcome) {
    case 'clean':
      fireDopamineStack();
      state.combo++;
      state.stagnantTurns = 0;
      playCleanCounter();
      hapticCleanCounter();
      break;
    case 'partial':
      animateShipHit();
      playPartialHit();
      hapticHit();
      state.combo = 0;
      state.stagnantTurns++;
      break;
    case 'full':
      animateShipHit();
      playFullHit();
      hapticHit();
      applyDamage('resilience', 1);
      state.combo = 0;
      state.stagnantTurns++;
      break;
  }

  // Reality flash — once per mission when weakest lever takes damage
  if (!state.realityFlashFired && outcome !== 'clean') {
    fireRealityFlash();
    state.realityFlashFired = true;
  }

  document.getElementById('btn-go').disabled = false;
  onComplete?.();
}

function applyOutcome(outcome, threat) {
  switch (outcome) {
    case 'clean':
      applyVariableReward();
      break;
    case 'partial':
      applyDamage(threat.statDamage, 0.5);
      break;
    case 'full':
      applyDamage(threat.statDamage, 1.5);
      break;
  }

  checkDeathCondition();
}

// ── DOPAMINE STACK ──
function fireDopamineStack() {
  // 1. Fragment burst
  const vs = document.getElementById('viewscreen');
  const rect = vs.getBoundingClientRect();
  spawnFragments(rect.width / 2, rect.height * 0.4);

  // 2. Ship flash
  animateShipFlash();

  // 3. Stat tick
  tickStats();

  // 4. Screen pulse
  screenPulse();

  // 5. Combo word
  if (state.combo >= 2) showComboWord();
}

function spawnFragments(x, y) {
  const cfg   = CONFIG.dopamine;
  const count = Math.floor(
    Math.random() * (cfg.fragmentCount.max - cfg.fragmentCount.min)
  ) + cfg.fragmentCount.min;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist  = Math.random() *
      (cfg.fragmentDistance.max - cfg.fragmentDistance.min) +
      cfg.fragmentDistance.min;
    const frag  = document.createElement('div');
    frag.style.cssText = `
      position:fixed;
      width:${Math.random() * 4 + 2}px;
      height:${Math.random() * 10 + 4}px;
      background:var(--cream);
      left:${x}px; top:${y}px;
      border-radius:1px;
      pointer-events:none;
      z-index:80;
      transform-origin:center;
      transform:rotate(${angle}rad);
    `;
    document.body.appendChild(frag);

    const endX = x + Math.cos(angle) * dist;
    const endY = y + Math.sin(angle) * dist;

    frag.animate([
      { transform: `translate(0,0) rotate(${angle}rad)`, opacity: 1 },
      { transform: `translate(${endX-x}px,${endY-y}px) rotate(${angle+2}rad)`, opacity: 0 },
    ], {
      duration: CONFIG.timing.fragmentBurst,
      easing: 'cubic-bezier(0.2,0,0.4,1)',
      fill: 'forwards',
    }).onfinish = () => frag.remove();
  }
}

function screenPulse() {
  const pulse = document.getElementById('screen-pulse');
  if (!pulse) return;
  pulse.style.opacity = CONFIG.dopamine.screenPulseOpacity;
  setTimeout(() => {
    pulse.style.transition =
      `opacity 0.3s var(--ease-smooth)`;
    pulse.style.opacity = '0';
  }, CONFIG.dopamine.screenPulseDuration);
}

function tickStats() {
  const amt = CONFIG.dopamine.statTickAmount;
  Object.keys(state.stats).forEach(key => {
    const original = state.stats[key];
    state.stats[key] = Math.min(10, original + amt);
    updateStats();
    setTimeout(() => {
      state.stats[key] = original;
      updateStats();
    }, CONFIG.timing.statTick);
  });
}

function showComboWord() {
  const words = CONFIG.dopamine.comboWords;
  const word  = words[Math.min(state.combo, 6)] || 'SOVEREIGN';
  if (!word) return;

  const el = document.createElement('div');
  el.textContent = word;
  el.style.cssText = `
    position:fixed;
    top:35%;left:50%;
    transform:translate(-50%,-50%);
    font-family:'Space Mono',monospace;
    font-size:1.5rem;
    color:var(--signal);
    letter-spacing:0.2em;
    pointer-events:none;
    z-index:85;
    opacity:1;
    text-align:center;
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition =
      `opacity ${CONFIG.timing.comboWordDisplay}ms var(--ease-smooth)`;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), CONFIG.timing.comboWordDisplay);
  }, 50);
}

// ── STATS ──
function applyDamage(statKey, amount) {
  if (state.stats[statKey] === undefined) return;
  state.stats[statKey] = Math.max(0, state.stats[statKey] - amount);
  updateStats();

  // Critical state warning
  const total = Object.values(state.stats).reduce((s,v)=>s+v,0);
  if (total < 9) {
    document.getElementById('viewscreen')
      ?.classList.add('critical');
  }
}

function applyVariableReward() {
  const roll = Math.random() * 100;
  const w    = CONFIG.dopamine.variableRewardWeights;

  if (roll < w.cascade) {
    showDiagnosis('Cascade effect — your strength weakened the next threat.');
    state.passengers = Math.min(state.passengers + 2, 50);
  } else if (roll < w.cascade + w.perfect) {
    showDiagnosis('Perfect allocation. Not a point wasted.');
    state.passengers = Math.min(state.passengers + 1, 50);
  } else if (roll < w.cascade + w.perfect + w.surplus) {
    showDiagnosis('Surplus power — resources carried forward.');
    state.stats.resilience = Math.min(10, state.stats.resilience + 0.2);
    state.passengers = Math.min(state.passengers + 1, 50);
  }
  updateStats();
}

function updateStats() {
  Object.entries(state.stats).forEach(([key, val]) => {
    const fill = document.getElementById(`fill-${key}`);
    const valEl = document.getElementById(`val-${key}`);
    if (fill)  fill.style.width = `${(val / 10) * 100}%`;
    if (valEl) valEl.textContent = val.toFixed(1);
  });
}

function checkDeathCondition() {
  const total = Object.values(state.stats).reduce((s,v)=>s+v,0);
  if (total <= 3 || state.stats.resilience <= 0) {
    triggerDeath();
  }
}

function triggerDeath() {
  state.phase = 'dead';
  clearThreats();

  animateShipDestroyed(() => {
    showDeathScreen();
    callDebriefAPI();
  });
}

// ── POST RESOLUTION ──
function showPostResolution(threat, outcome) {
  showDiagnosis(threat.diagnosis);
  showCaseStudy(threat.caseStudyId);

  logEvent({
    type: 'threat_resolved',
    threatId: threat.id,
    system: threat.system,
    outcome,
    mission: state.mission,
    turn: state.turn,
  });
}

function showDiagnosis(text) {
  const el = document.getElementById('diagnosis-line');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
}

function hideDiagnosis() {
  document.getElementById('diagnosis-line')
    ?.classList.remove('visible');
}

async function showCaseStudy(caseStudyId) {
  try {
    const res  = await fetch('/data/case-studies.json');
    const data = await res.json();
    const text = data[caseStudyId];
    if (!text) return;

    const tile = document.getElementById('case-study-tile');
    const txt  = document.getElementById('case-study-text');
    if (!tile || !txt) return;

    txt.textContent  = text;
    tile.classList.remove('hidden');
    tile.classList.add('visible');

    setTimeout(() => {
      tile.classList.remove('visible');
      setTimeout(() => tile.classList.add('hidden'),
        CONFIG.timing.stateChange);
    }, CONFIG.timing.caseStudySlide);
  } catch (e) {
    console.error('Case study load failed:', e);
  }
}

// ── MISSION COMPLETE ──
function completeMission() {
  state.phase = 'mission_complete';
  playMissionComplete();
  hapticMissionComplete();

  // Award captaincy points
  const pts = CONFIG.progression.captaincyPoints;
  let earned = pts.perMissionCompleted +
    (state.combo * pts.perComboWord) +
    (state.passengers * pts.perPassengerAtEnd);

  saveCaptaincyPoints(earned);

  // Advance mission
  state.mission++;
  initLevers(state.mission);

  setTimeout(() => {
    startMission();
  }, 1500);
}

// ── UNLOCK CEREMONY ──
function checkUnlock() {
  const schedule = CONFIG.progression.systemUnlockSchedule;
  for (const [sys, missionNum] of Object.entries(schedule)) {
    if (missionNum === state.mission) return sys;
  }
  return null;
}

function showUnlockCeremony(system, onComplete) {
  const defs = {
    engines: {
      title: 'ENGINES ONLINE',
      game: 'Move the ship out of a threat\'s path entirely.',
      framework: 'Positioning + Time — knowing where you compete means some problems simply miss you.',
    },
    lifesupport: {
      title: 'CREW SYSTEMS ONLINE',
      game: 'Keeps all systems performing at full capacity. Neglect this and everything costs more.',
      framework: 'People + Systems — the ceiling of your team determines how effectively every other lever operates.',
    },
    communications: {
      title: 'COMMUNICATIONS ONLINE',
      game: 'Generates reach and occasionally produces allied assistance.',
      framework: 'Network Effects + Habit Design — each customer makes the next one more likely.',
    },
  };

  const def = defs[system];
  if (!def) { onComplete?.(); return; }

  document.getElementById('unlock-title').textContent    = def.title;
  document.getElementById('unlock-game').textContent     = def.game;
  document.getElementById('unlock-framework').textContent = def.framework;

  const overlay = document.getElementById('unlock-overlay');
  overlay.classList.remove('hidden');

  playUnlock();
  hapticUnlock();
  unlockSystem(system);

  document.getElementById('unlock-dismiss')
    .onclick = () => {
      overlay.classList.add('hidden');
      onComplete?.();
    };
}

// ── REALITY FLASH ──
function fireRealityFlash() {
  const flash = document.getElementById('reality-flash');
  const text  = document.getElementById('reality-text');
  if (!flash || !text) return;

  text.textContent = 'This is happening in your business right now.';
  flash.classList.remove('hidden');
  flash.classList.add('visible');

  setTimeout(() => {
    flash.classList.remove('visible');
    setTimeout(() => flash.classList.add('hidden'),
      CONFIG.timing.stateChange);
  }, CONFIG.timing.realityFlash);
}

// ── DECAY ──
function checkDecay() {
  const systems = getSystemValues();
  let decayFired = false;
  Object.entries(systems).forEach(([sys, val]) => {
    if (val <= 2 && state.turn % 3 === 0) {
      applyDamage('resilience', CONFIG.progression.decayRate);
      decayFired = true;
    }
  });
  if (decayFired) {
    showDiagnosis('Neglected systems are degrading the ship.');
  }
}

function applyStagnationDecay() {
  applyDamage('momentum', 0.3);
}

// ── SYSTEM HIGHLIGHT ──
function highlightSystem(system) {
  const cell = document.getElementById(`cell-${system}`);
  if (cell) cell.style.borderColor = 'var(--signal)';
}

function clearSystemHighlight() {
  document.querySelectorAll('.system-cell').forEach(c => {
    c.style.borderColor = '';
  });
}

// ── UI HELPERS ──
function updateTurnCounter() {
  const el = document.getElementById('turn-number');
  if (el) el.textContent = state.turn;
}

function updateMissionObjective() {
  const el = document.getElementById('mission-objective');
  if (el) el.textContent =
    `MISSION ${state.mission} — ` +
    CONFIG.missions.survive.description.replace(
      '{N}', CONFIG.progression.threatsToCompleteMission
    );
}

function getPrimarySystem(systems) {
  return Object.entries(systems)
    .sort(([,a],[,b]) => b - a)[0]?.[0] || 'shields';
}

function getShipName() {
  return localStorage.getItem('bridge_ship_name') || 'ISV UNKNOWN';
}

// ── MODALS ──
function showExitModal() {
  document.getElementById('exit-modal').classList.remove('hidden');
}

function hideExitModal() {
  document.getElementById('exit-modal').classList.add('hidden');
}

function showDeathScreen() {
  const name  = getShipName();
  const cause = getThreatState()?.description || 'Unknown threat';
  document.getElementById('death-ship-name').textContent =
    `${name} HAS BEEN DESTROYED`;
  document.getElementById('death-cause').textContent = cause;
  document.getElementById('death-screen').classList.remove('hidden');
}

function hideDeathScreen() {
  document.getElementById('death-screen').classList.add('hidden');
}

function showEmailCapture() {
  window.location.href = '/login?from=game&save=true';
}

function saveAndExit() {
  saveGameState().then(() => {
    window.location.href = '/';
  });
}

async function saveGameState() {
  try {
    await fetch('/api/game/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stats: state.stats,
        mission: state.mission,
        passengers: state.passengers,
        systems: getSystemValues(),
      }),
    });
  } catch (e) {
    console.error('Save failed:', e);
  }
}

// ── DEBRIEF API ──
async function callDebriefAPI() {
  const systems = getSystemValues();
  const payload = {
    intakeAnswers: JSON.parse(
      localStorage.getItem('bridge_intake') || '{}'
    ),
    runSummary: {
      missionReached: state.mission,
      turnsSurvived: state.turn,
      finalStats: state.stats,
      leverValuesAtDeath: systems,
      passengerCount: state.passengers,
      comboHigh: state.combo,
    },
  };

  // Show static fallback immediately
  const dominant = Object.entries(systems)
    .sort(([,a],[,b]) => b - a)[0]?.[0] || 'shields';
  const fallback =
    CONFIG.conversion.staticDebriefByDominantSystem[dominant];
  document.getElementById('death-debrief').textContent = fallback;

  // API call in background
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(
      () => controller.abort(),
      CONFIG.conversion.apiTimeoutFallback
    );

    const res = await fetch('/api/game/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data.debrief) {
      document.getElementById('death-debrief').textContent =
        data.debrief;
    }
  } catch (e) {
    // Fallback already shown — silent fail
    console.error('Debrief API failed:', e);
  }
}

// ── TUTORIAL ──
async function runTutorial() {
  return new Promise(resolve => {
    const steps = [
      'This is your ship. It represents your business. Its appearance changes as you power each system.',
      'These are your systems. Each one controls how your ship — and your business — handles what is coming. You have 3 adjustments per turn.',
      'Momentum moves you forward. Resilience absorbs hits. Clarity keeps you on course. Watch all three.',
      'A threat is approaching. The system indicator tells you what it targets. Adjust your power and press GO.',
      'When you\'re ready, press GO. The ship responds to your configuration. Watch what happens.',
    ];

    const overlay = document.getElementById('tutorial-overlay');
    const text    = document.getElementById('tutorial-text');
    const dotsEl  = document.getElementById('tutorial-dots');
    const nextBtn = document.getElementById('tutorial-next');

    let step = 0;

    // Build dots
    dotsEl.innerHTML = steps.map((_, i) =>
      `<span class="tutorial-dot${i === 0 ? ' active' : ''}"></span>`
    ).join('');

    function showStep(i) {
      text.textContent = steps[i];
      dotsEl.querySelectorAll('.tutorial-dot').forEach((d, idx) => {
        d.classList.toggle('active', idx === i);
      });
      nextBtn.textContent = i === steps.length - 1
        ? 'BEGIN MISSION →'
        : 'NEXT →';
    }

    overlay.classList.remove('hidden');
    showStep(0);

    nextBtn.onclick = () => {
      step++;
      if (step >= steps.length) {
        overlay.classList.add('hidden');
        localStorage.setItem('bridge_tutorial_done', '1');
        resolve();
      } else {
        showStep(step);
      }
    };
  });
}

// ── PROGRESSION ──
function saveCaptaincyPoints(points) {
  const existing = parseInt(
    localStorage.getItem('bridge_captaincy') || '0'
  );
  localStorage.setItem(
    'bridge_captaincy',
    (existing + points).toString()
  );
}

// ── START ──
document.addEventListener('DOMContentLoaded', init);
