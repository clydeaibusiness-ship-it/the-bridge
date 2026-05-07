/* ============================================
   THE BRIDGE — Game Engine (Complete Rebuild)
   Game loop, threats, noise, ship positioning,
   resolution, dopamine stack, unlock ceremony,
   tutorial cards, death screen, run-end payload
   ============================================ */

/* ---------- CONSTANTS & CONFIG ---------- */
const THREATS_PER_SECTOR = 5;
const TOTAL_SECTORS = 7;
const ADJUSTMENT_DEFAULT = 3;
const NOISE_START_SECTOR = 4;

const COMBO_WORDS = {
  2: 'SHARP',
  3: 'PRECISE',
  4: 'COMMANDING',
  5: 'CAPTAIN',
  6: 'SOVEREIGN'  // 6+ uses this
};

const SHIP_POSITIONS = { LEFT: 0, CENTER: 1, RIGHT: 2 };
const SHIP_X_MAP = { 0: '25%', 1: '50%', 2: '75%' };

const NOISE_TYPES = [
  { label: 'INFLATION SPIKE', direction: 'left', size: 'medium', speed: 1 },
  { label: 'INTEREST RATE HIKE', direction: 'right', size: 'medium', speed: 1 },
  { label: 'KEY EMPLOYEE QUIT', direction: 'top-offset', size: 'small', speed: 1.5 },
  { label: 'MARKET DOWNTURN', direction: 'left', size: 'wide', speed: 0.6 },
  { label: 'SUPPLY CHAIN DISRUPTION', direction: 'multi', size: 'small', speed: 1 },
  { label: 'ALGORITHM CHANGE', direction: 'zigzag', size: 'small', speed: 1.4 }
];

/* ---------- AUDIO ENGINE (Web Audio API) ---------- */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, duration, startTime = 0) {
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, ctx.currentTime + startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + startTime);
  osc.stop(ctx.currentTime + startTime + duration);
}

function playCleanCounterChime() {
  playTone(523, 0.1, 0);    // C5
  playTone(659, 0.15, 0.1); // E5
}

function playPartialHitSound() {
  playTone(330, 0.15, 0); // E4 — muted thud
}

function playUnlockCeremonyChime() {
  playTone(392, 0.15, 0);    // G4
  playTone(523, 0.15, 0.18); // C5
  playTone(659, 0.15, 0.36); // E5
}

/* ---------- THREAT SVG DRAWING ---------- */
function drawThreatSVG(type) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 50 50');
  svg.setAttribute('width', '50');
  svg.setAttribute('height', '50');
  const cream = '#f5f0e8';

  switch (type) {
    case 'AGGRESSIVE': {
      // Sharp angular forward-pointing shape
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M25,2 L42,38 L35,32 L25,48 L15,32 L8,38 Z');
      p.setAttribute('fill', cream);
      svg.appendChild(p);
      break;
    }
    case 'HEAVY': {
      // Dense circular mass
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', '25'); c.setAttribute('cy', '25'); c.setAttribute('r', '20');
      c.setAttribute('fill', cream); c.setAttribute('opacity', '0.9');
      // Inner density ring
      const c2 = document.createElementNS(ns, 'circle');
      c2.setAttribute('cx', '25'); c2.setAttribute('cy', '25'); c2.setAttribute('r', '12');
      c2.setAttribute('fill', 'none'); c2.setAttribute('stroke', '#0a0a0f'); c2.setAttribute('stroke-width', '1.5'); c2.setAttribute('opacity', '0.3');
      svg.appendChild(c); svg.appendChild(c2);
      break;
    }
    case 'FAST': {
      // Thin elongated dart
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M25,0 L29,20 L27,48 L25,50 L23,48 L21,20 Z');
      p.setAttribute('fill', cream); p.setAttribute('opacity', '0.85');
      svg.appendChild(p);
      break;
    }
  }
  return svg;
}

/* ---------- NOISE DEBRIS DRAWING ---------- */
function drawNoiseDebris(size) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const w = size === 'wide' ? 60 : size === 'medium' ? 30 : 20;
  const h = size === 'wide' ? 20 : size === 'medium' ? 25 : 18;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);

  // Irregular fragment shape
  const pts = [];
  const segments = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const r = (Math.min(w, h) / 2) * (0.5 + Math.random() * 0.5);
    pts.push(`${w/2 + r * Math.cos(angle)},${h/2 + r * Math.sin(angle)}`);
  }
  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('points', pts.join(' '));
  poly.setAttribute('fill', 'var(--color-cream-dim, #b0a898)');
  svg.appendChild(poly);
  return svg;
}

/* ---------- GAME STATE ---------- */
const gameState = {
  // Core state
  sector: 1,
  turn: 0,
  threatsInSector: 0,
  alive: true,
  running: false,
  waitingForGo: false,

  // Lever values
  levers: {},
  adjustmentsUsed: 0,
  adjustmentCap: ADJUSTMENT_DEFAULT,
  previousLeverValues: {}, // snapshot before adjustments

  // Stats
  momentum: 5.0,
  resilience: 5.0,
  clarity: 5.0,

  // Ship position
  shipPosition: SHIP_POSITIONS.CENTER,

  // Combo
  comboCount: 0,

  // Passengers
  passengers: 10,

  // Unlock tracking
  unlockedLevers: [],

  // Run history for debrief
  threatLog: [],
  noiseHits: 0,
  comboHigh: 0,

  // Current threat
  currentThreat: null,
  currentNoise: null,

  // Intake answers
  intakeAnswers: {},

  // Personalization
  shipName: 'The Venture',
  destinationName: 'North Star'
};

/* ---------- DOM REFERENCES ---------- */
let $battlefield, $leverPanel, $statusBar, $goButton;
let $sectorDisplay, $turnDisplay;
let $momentumBar, $resilienceBar, $clarityBar;
let $momentumNum, $resilienceNum, $clarityNum;
let $diagnosisLine, $passengerCount;
let $adjustmentDots;
let $shipContainer;
let $intakeOverlay, $intakeForm;
let $deathOverlay, $deathPanel;
let $tutorialOverlay;
let $comboDisplay;
let $leverGrid, $multiplierGrid;

/* ---------- INITIALIZATION ---------- */
function initGame() {
  // Cache DOM refs
  $battlefield = document.querySelector('.battlefield');
  $leverPanel = document.querySelector('.lever-panel');
  $statusBar = document.querySelector('.status-bar');
  $goButton = document.querySelector('.go-button');
  $sectorDisplay = document.querySelector('.sector-display');
  $turnDisplay = document.querySelector('.turn-display');
  $shipContainer = document.querySelector('.ship-container');
  $intakeOverlay = document.querySelector('.intake-overlay');
  $intakeForm = document.getElementById('intake-form');
  $deathOverlay = document.querySelector('.death-overlay');
  $deathPanel = document.querySelector('.death-panel');
  $diagnosisLine = document.querySelector('.diagnosis-line');
  $passengerCount = document.querySelector('.passenger-count');
  $adjustmentDots = document.querySelector('.adjustment-dots');

  // Draw ship position zone lines
  drawPositionZones();

  // Setup intake form
  $intakeOverlay.style.display = 'flex';
  $intakeForm.addEventListener('submit', handleIntakeSubmit);

  // Setup GO button
  $goButton.addEventListener('click', handleGo);
  $goButton.disabled = true;

  // Init stat displays
  updateStatDisplays();
}

/* ---------- POSITION ZONES ---------- */
function drawPositionZones() {
  // Three faint vertical guidelines
  [25, 50, 75].forEach(pct => {
    const line = document.createElement('div');
    line.className = 'position-zone-line';
    line.style.cssText = `position:absolute;top:0;bottom:0;left:${pct}%;width:1px;background:rgba(200,184,154,0.08);pointer-events:none;z-index:1;`;
    $battlefield.appendChild(line);
  });
}

/* ---------- INTAKE HANDLER ---------- */
async function handleIntakeSubmit(e) {
  e.preventDefault();
  const form = new FormData($intakeForm);
  const answers = {};
  for (const [k, v] of form.entries()) answers[k] = v;
  gameState.intakeAnswers = answers;

  // Show loading state
  const btn = $intakeForm.querySelector('.intake-submit');
  btn.textContent = 'Building your ship...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/game/personalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intake: answers })
    });
    const data = await res.json();
    gameState.shipName = data.ship_name || 'The Venture';
    gameState.destinationName = data.destination_name || 'North Star';
  } catch (err) {
    console.warn('Personalize failed, using defaults');
  }

  $intakeOverlay.style.display = 'none';
  startGame();
}

/* ---------- START GAME ---------- */
function startGame() {
  gameState.sector = 1;
  gameState.turn = 0;
  gameState.threatsInSector = 0;
  gameState.alive = true;
  gameState.running = true;
  gameState.momentum = 5.0;
  gameState.resilience = 5.0;
  gameState.clarity = 5.0;
  gameState.comboCount = 0;
  gameState.passengers = 10;
  gameState.shipPosition = SHIP_POSITIONS.CENTER;
  gameState.threatLog = [];
  gameState.noiseHits = 0;
  gameState.comboHigh = 0;

  // Init levers for sector 1
  gameState.unlockedLevers = getUnlockedLevers(1);
  gameState.levers = {};
  for (const id of gameState.unlockedLevers) {
    gameState.levers[id] = ALL_LEVERS[id].defaultValue;
  }

  buildLeverPanel();
  updateShipPosition(false);
  updateStatDisplays();
  updateSectorDisplay();

  // Run initial tutorial, then spawn first threat
  runTutorial(() => {
    spawnThreat();
  });
}

/* ---------- LEVER PANEL BUILD ---------- */
function buildLeverPanel() {
  $leverPanel.innerHTML = '';

  // Adjustment dots (top of panel)
  const dotsContainer = document.createElement('div');
  dotsContainer.className = 'adjustment-dots';
  for (let i = 0; i < ADJUSTMENT_DEFAULT; i++) {
    const dot = document.createElement('div');
    dot.className = 'adj-dot';
    dotsContainer.appendChild(dot);
  }
  $leverPanel.appendChild(dotsContainer);
  $adjustmentDots = dotsContainer;

  // Primary levers grid
  const primaryGrid = document.createElement('div');
  primaryGrid.className = 'lever-grid primary-levers';

  const primaryIds = gameState.unlockedLevers.filter(id => !MULTIPLIER_DEFS[id]);
  const multiplierIds = gameState.unlockedLevers.filter(id => MULTIPLIER_DEFS[id]);

  primaryIds.forEach(id => {
    const cell = buildLeverCell(id);
    primaryGrid.appendChild(cell);
  });

  // Add placeholder slots for locked primary levers
  const allPrimaryIds = Object.keys(LEVER_DEFS);
  allPrimaryIds.forEach(id => {
    if (!primaryIds.includes(id)) {
      const placeholder = document.createElement('div');
      placeholder.className = 'lever-cell locked';
      placeholder.dataset.leverId = id;
      placeholder.innerHTML = '<div class="locked-icon">?</div>';
      primaryGrid.appendChild(placeholder);
    }
  });

  $leverPanel.appendChild(primaryGrid);
  $leverGrid = primaryGrid;

  // Multiplier section (if any unlocked)
  if (multiplierIds.length > 0 || gameState.sector >= 5) {
    const sep = document.createElement('div');
    sep.className = 'multiplier-separator';
    sep.innerHTML = '<span>MULTIPLIERS</span>';
    $leverPanel.appendChild(sep);

    const multGrid = document.createElement('div');
    multGrid.className = 'lever-grid multiplier-levers';

    multiplierIds.forEach(id => {
      const cell = buildLeverCell(id);
      multGrid.appendChild(cell);
    });

    // Placeholders for locked multipliers
    Object.keys(MULTIPLIER_DEFS).forEach(id => {
      if (!multiplierIds.includes(id)) {
        const placeholder = document.createElement('div');
        placeholder.className = 'lever-cell locked';
        placeholder.dataset.leverId = id;
        placeholder.innerHTML = '<div class="locked-icon">?</div>';
        multGrid.appendChild(placeholder);
      }
    });

    $leverPanel.appendChild(multGrid);
    $multiplierGrid = multGrid;
  }

  resetAdjustments();
}

function buildLeverCell(id) {
  const def = ALL_LEVERS[id];
  const cell = document.createElement('div');
  cell.className = 'lever-cell';
  cell.dataset.leverId = id;

  // Icon
  const iconWrap = document.createElement('div');
  iconWrap.className = 'lever-icon';
  iconWrap.appendChild(drawLeverIcon(def.icon, 24));
  cell.appendChild(iconWrap);

  // Name
  const name = document.createElement('div');
  name.className = 'lever-name';
  name.textContent = def.shortName;
  cell.appendChild(name);

  // Value display
  const valDisplay = document.createElement('div');
  valDisplay.className = 'lever-value-display';
  valDisplay.textContent = gameState.levers[id];
  cell.appendChild(valDisplay);

  // Vertical slider container
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'lever-slider-wrap';

  const track = document.createElement('div');
  track.className = 'lever-track';
  const fill = document.createElement('div');
  fill.className = 'lever-fill';
  fill.style.height = `${(gameState.levers[id] / 10) * 100}%`;
  track.appendChild(fill);

  const thumb = document.createElement('div');
  thumb.className = 'lever-thumb';
  thumb.style.bottom = `${(gameState.levers[id] / 10) * 100}%`;
  track.appendChild(thumb);

  sliderWrap.appendChild(track);
  cell.appendChild(sliderWrap);

  // Touch/mouse drag on the track
  let dragging = false;

  const handleDrag = (clientY) => {
    if (!gameState.waitingForGo) return;
    const rect = track.getBoundingClientRect();
    const pct = 1 - ((clientY - rect.top) / rect.height);
    const newVal = Math.max(0, Math.min(10, Math.round(pct * 10)));
    const oldVal = gameState.levers[id];

    if (newVal !== oldVal) {
      // Check adjustment cap
      const adjustmentsNeeded = Math.abs(newVal - (gameState.previousLeverValues[id] ?? oldVal));
      const currentUsed = countAdjustments();
      // Each point of change from the turn-start snapshot is one adjustment
      // Recalculate total adjustments if we change this lever
      const otherAdjustments = countAdjustmentsExcluding(id);
      const thisAdjustments = Math.abs(newVal - gameState.previousLeverValues[id]);

      if (otherAdjustments + thisAdjustments > gameState.adjustmentCap) {
        // Can't exceed cap — clamp the value
        const maxDelta = gameState.adjustmentCap - otherAdjustments;
        const startVal = gameState.previousLeverValues[id];
        const dir = newVal > startVal ? 1 : -1;
        const clamped = startVal + dir * maxDelta;
        gameState.levers[id] = Math.max(0, Math.min(10, clamped));
      } else {
        gameState.levers[id] = newVal;
      }

      updateLeverVisual(cell, id);
      updateAdjustmentDots();
      updateGoButton();
    }
  };

  // Mouse events
  track.addEventListener('mousedown', (e) => {
    dragging = true;
    handleDrag(e.clientY);
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (dragging) handleDrag(e.clientY);
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // Touch events
  track.addEventListener('touchstart', (e) => {
    dragging = true;
    handleDrag(e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  track.addEventListener('touchmove', (e) => {
    if (dragging) handleDrag(e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  track.addEventListener('touchend', () => { dragging = false; });

  // Set initial color state
  updateLeverColorState(cell, gameState.levers[id]);

  return cell;
}

function updateLeverVisual(cell, id) {
  const val = gameState.levers[id];
  const fill = cell.querySelector('.lever-fill');
  const thumb = cell.querySelector('.lever-thumb');
  const valDisplay = cell.querySelector('.lever-value-display');

  fill.style.height = `${(val / 10) * 100}%`;
  thumb.style.bottom = `${(val / 10) * 100}%`;
  valDisplay.textContent = val;

  updateLeverColorState(cell, val);
}

function updateLeverColorState(cell, val) {
  if (val <= 3) {
    cell.classList.add('neglected');
    cell.classList.remove('active-lever');
  } else {
    cell.classList.remove('neglected');
    cell.classList.add('active-lever');
  }
}

/* ---------- ADJUSTMENT TRACKING ---------- */
function countAdjustments() {
  let total = 0;
  for (const id of gameState.unlockedLevers) {
    const prev = gameState.previousLeverValues[id] ?? gameState.levers[id];
    total += Math.abs(gameState.levers[id] - prev);
  }
  return total;
}

function countAdjustmentsExcluding(excludeId) {
  let total = 0;
  for (const id of gameState.unlockedLevers) {
    if (id === excludeId) continue;
    const prev = gameState.previousLeverValues[id] ?? gameState.levers[id];
    total += Math.abs(gameState.levers[id] - prev);
  }
  return total;
}

function resetAdjustments() {
  gameState.adjustmentCap = getAdjustmentCap(gameState.levers, gameState.sector);
  gameState.adjustmentsUsed = 0;
  gameState.previousLeverValues = { ...gameState.levers };

  // Update dots to reflect new cap
  if ($adjustmentDots) {
    $adjustmentDots.innerHTML = '';
    for (let i = 0; i < gameState.adjustmentCap; i++) {
      const dot = document.createElement('div');
      dot.className = 'adj-dot';
      $adjustmentDots.appendChild(dot);
    }
  }
}

function updateAdjustmentDots() {
  const used = countAdjustments();
  const dots = $adjustmentDots.querySelectorAll('.adj-dot');
  dots.forEach((dot, i) => {
    dot.classList.toggle('filled', i < used);
  });

  // If all used, lock levers and pulse
  if (used >= gameState.adjustmentCap) {
    $leverPanel.classList.add('levers-locked');
    $goButton.classList.add('pulse');
    setTimeout(() => $goButton.classList.remove('pulse'), 600);
  } else {
    $leverPanel.classList.remove('levers-locked');
  }
}

function updateGoButton() {
  $goButton.disabled = !gameState.waitingForGo;
}

/* ---------- STAT DISPLAYS ---------- */
function updateStatDisplays() {
  const stats = [
    { key: 'momentum', val: gameState.momentum },
    { key: 'resilience', val: gameState.resilience },
    { key: 'clarity', val: gameState.clarity }
  ];

  stats.forEach(({ key, val }) => {
    const readout = document.querySelector(`.stat-readout[data-stat="${key}"]`);
    if (!readout) return;
    const num = readout.querySelector('.stat-number');
    const barFill = readout.querySelector('.stat-bar-fill');
    num.textContent = val.toFixed(1);
    barFill.style.width = `${(val / 10) * 100}%`;
  });

  // Passenger count
  if ($passengerCount) {
    $passengerCount.textContent = gameState.passengers;
  }
}

function updateSectorDisplay() {
  if ($sectorDisplay) $sectorDisplay.textContent = `SECTOR ${gameState.sector}`;
  if ($turnDisplay) $turnDisplay.textContent = `TURN ${gameState.turn}`;
}

/* ---------- SHIP POSITION ---------- */
function updateShipPosition(animate = true) {
  const x = SHIP_X_MAP[gameState.shipPosition];
  if ($shipContainer) {
    $shipContainer.style.transition = animate ? 'left 0.4s ease, transform 0.4s ease' : 'none';
    $shipContainer.style.left = x;
    $shipContainer.style.transform = 'translateX(-50%)';

    // Motion trail for animated moves
    if (animate) {
      showMotionTrail();
    }
  }
}

function showMotionTrail() {
  // Three fading ghost images
  for (let i = 0; i < 3; i++) {
    const ghost = $shipContainer.cloneNode(true);
    ghost.classList.add('ship-ghost');
    ghost.style.opacity = (0.3 - i * 0.1).toString();
    ghost.style.position = 'absolute';
    ghost.style.bottom = $shipContainer.style.bottom || '15%';
    ghost.style.left = $shipContainer.style.left;
    ghost.style.transform = $shipContainer.style.transform;
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '1';
    $battlefield.appendChild(ghost);
    setTimeout(() => ghost.remove(), 300 + i * 100);
  }
}

/* ---------- THREAT SPAWNING ---------- */
function spawnThreat() {
  if (!gameState.alive) return;

  gameState.turn++;
  gameState.threatsInSector++;
  updateSectorDisplay();

  // Select threat type based on sector complexity
  const threatType = selectThreatType();

  // Create threat element
  const threatEl = document.createElement('div');
  threatEl.className = 'threat-element';
  threatEl.appendChild(drawThreatSVG(threatType));

  // Type label (visible until Sector 3)
  if (gameState.sector <= 3) {
    const label = document.createElement('div');
    label.className = 'threat-label';
    label.textContent = threatType;
    threatEl.appendChild(label);
    setTimeout(() => label.classList.add('fade-out'), 2000);
  }

  // Position threat at top
  threatEl.style.top = '-60px';
  const laneX = 25 + Math.random() * 50; // center-ish
  threatEl.style.left = `${laneX}%`;
  $battlefield.appendChild(threatEl);

  gameState.currentThreat = {
    type: threatType,
    element: threatEl,
    x: laneX,
    startTime: Date.now()
  };

  // Animate threat down to 40% then pause
  animateThreatEntry(threatEl, () => {
    // Threat paused at 40% — player can now adjust and GO
    gameState.waitingForGo = true;
    resetAdjustments();
    updateGoButton();
    $goButton.disabled = false;
  });

  // If info asymmetry is low (sector 5+), hide threat type
  if (gameState.sector >= 5 && gameState.levers.informationAsymmetry !== undefined && gameState.levers.informationAsymmetry <= 2) {
    threatEl.classList.add('hidden-type');
  }

  // Spawn noise if applicable
  if (gameState.sector >= NOISE_START_SECTOR && threatType !== 'HEAVY') {
    // Random chance of noise
    if (Math.random() < 0.5) {
      setTimeout(() => spawnNoise(), 500 + Math.random() * 1000);
    }
  }
}

function selectThreatType() {
  const types = ['AGGRESSIVE', 'HEAVY', 'FAST'];
  const sector = gameState.sector;

  if (sector <= 1) return 'AGGRESSIVE'; // First sector: only aggressive
  if (sector === 2) return Math.random() < 0.5 ? 'AGGRESSIVE' : 'HEAVY';

  // Sector 3+: all three types, weighted by lever weaknesses
  const leverVals = gameState.levers;

  // Find highest category lever values
  const offensiveMax = Math.max(leverVals.positioning || 0, leverVals.differentiation || 0);
  const defensiveMax = Math.max(leverVals.capital || 0, leverVals.switchingCosts || 0, leverVals.systems || 0);
  const maneuverMax = Math.max(leverVals.habitDesign || 0, leverVals.networkEffects || 0);

  // Target weakest category
  const scores = [
    { type: 'AGGRESSIVE', weakness: 11 - offensiveMax },
    { type: 'HEAVY', weakness: 11 - defensiveMax },
    { type: 'FAST', weakness: 11 - maneuverMax }
  ];

  // Weighted random
  const total = scores.reduce((s, x) => s + x.weakness, 0);
  let roll = Math.random() * total;
  for (const s of scores) {
    roll -= s.weakness;
    if (roll <= 0) return s.type;
  }
  return types[Math.floor(Math.random() * types.length)];
}

function animateThreatEntry(el, onPause) {
  const battlefieldH = $battlefield.clientHeight;
  const targetTop = battlefieldH * 0.4;
  const duration = 2000; // 2 seconds to drift down
  const startTop = -60;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const pct = Math.min(elapsed / duration, 1);
    const eased = pct * pct * (3 - 2 * pct); // smoothstep
    const currentTop = startTop + (targetTop - startTop) * eased;
    el.style.top = `${currentTop}px`;

    if (pct < 1) {
      requestAnimationFrame(step);
    } else {
      // Paused at 40%
      if (onPause) onPause();
    }
  }
  requestAnimationFrame(step);
}

/* ---------- NOISE SPAWNING ---------- */
function spawnNoise() {
  if (!gameState.alive) return;

  const noiseType = NOISE_TYPES[Math.floor(Math.random() * NOISE_TYPES.length)];
  const el = document.createElement('div');
  el.className = 'noise-element';
  el.appendChild(drawNoiseDebris(noiseType.size));

  // Label
  const label = document.createElement('div');
  label.className = 'noise-label';
  label.textContent = noiseType.label;
  el.appendChild(label);
  setTimeout(() => label.classList.add('fade-out'), 1500);

  // Position based on direction
  let startX, startY, endX, endY;
  const bw = $battlefield.clientWidth;
  const bh = $battlefield.clientHeight;

  // Determine lateral position (which of the 3 zones it passes through)
  const noiseTargetZone = Math.floor(Math.random() * 3); // 0=LEFT, 1=CENTER, 2=RIGHT

  switch (noiseType.direction) {
    case 'left':
      startX = -40; startY = bh * 0.3;
      endX = bw + 40; endY = bh * 0.7;
      break;
    case 'right':
      startX = bw + 40; startY = bh * 0.3;
      endX = -40; endY = bh * 0.7;
      break;
    case 'top-offset':
      startX = [bw * 0.25, bw * 0.5, bw * 0.75][noiseTargetZone];
      startY = -30; endX = startX + (Math.random() - 0.5) * 100;
      endY = bh + 30;
      break;
    case 'zigzag':
      startX = Math.random() * bw; startY = -30;
      endX = bw - startX; endY = bh + 30;
      break;
    case 'multi':
      // Will spawn 3 pieces — this is the first
      startX = -40; startY = bh * 0.4;
      endX = bw + 40; endY = bh * 0.6;
      break;
    default:
      startX = -40; startY = bh * 0.5;
      endX = bw + 40; endY = bh * 0.5;
  }

  el.style.left = `${startX}px`;
  el.style.top = `${startY}px`;
  el.style.position = 'absolute';
  el.style.zIndex = '5';
  $battlefield.appendChild(el);

  gameState.currentNoise = { type: noiseType, element: el, targetZone: noiseTargetZone };

  // Animate noise drift
  const dur = 3000 / noiseType.speed;
  const start = performance.now();

  function animNoise(now) {
    const pct = Math.min((now - start) / dur, 1);

    let x = startX + (endX - startX) * pct;
    let y = startY + (endY - startY) * pct;

    // Zigzag variation
    if (noiseType.direction === 'zigzag' && pct > 0.4 && pct < 0.6) {
      x += Math.sin(pct * Math.PI * 4) * 60;
    }

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    if (pct >= 1) {
      el.remove();
      gameState.currentNoise = null;
    } else {
      // Check collision with ship at ~70% through
      if (pct > 0.6 && pct < 0.75) {
        checkNoiseCollision(noiseTargetZone);
      }
      requestAnimationFrame(animNoise);
    }
  }
  requestAnimationFrame(animNoise);

  // Multi type: spawn additional debris
  if (noiseType.direction === 'multi') {
    setTimeout(() => {
      if (gameState.alive) spawnNoiseExtra('left', bh);
    }, 3000);
    setTimeout(() => {
      if (gameState.alive) spawnNoiseExtra('left', bh);
    }, 6000);
  }
}

function spawnNoiseExtra(dir, bh) {
  const el = document.createElement('div');
  el.className = 'noise-element';
  el.appendChild(drawNoiseDebris('small'));
  const bw = $battlefield.clientWidth;
  const startX = -40;
  const startY = bh * (0.3 + Math.random() * 0.4);
  el.style.left = `${startX}px`;
  el.style.top = `${startY}px`;
  el.style.position = 'absolute';
  el.style.zIndex = '5';
  $battlefield.appendChild(el);
  const zone = Math.floor(Math.random() * 3);

  const endX = bw + 40;
  const dur = 2500;
  const start = performance.now();
  function step(now) {
    const pct = Math.min((now - start) / dur, 1);
    el.style.left = `${startX + (endX - startX) * pct}px`;
    if (pct >= 1) { el.remove(); }
    else {
      if (pct > 0.6 && pct < 0.75) checkNoiseCollision(zone);
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

function checkNoiseCollision(noiseZone) {
  if (noiseZone === gameState.shipPosition) {
    // Hit! 0.3 resilience damage
    gameState.resilience = Math.max(0, gameState.resilience - 0.3);
    gameState.noiseHits++;
    updateStatDisplays();
    shakeShip();
    checkDeath();
  }
}

/* ---------- GO BUTTON HANDLER ---------- */
function handleGo() {
  if (!gameState.waitingForGo || !gameState.currentThreat) return;
  gameState.waitingForGo = false;
  $goButton.disabled = true;

  resolveRound();
}

/* ---------- RESOLUTION SEQUENCE ---------- */
function resolveRound() {
  const threat = gameState.currentThreat;
  if (!threat) return;

  // 1. Determine which lever category counters this threat
  const counterCat = {
    'AGGRESSIVE': 'OFFENSIVE',
    'HEAVY': 'DEFENSIVE',
    'FAST': 'MANEUVER'
  }[threat.type];

  // 2. Find highest lever in the counter category
  const categoryLevers = gameState.unlockedLevers.filter(id => {
    const def = ALL_LEVERS[id];
    return def.category === counterCat;
  });

  let primaryLeverId = null;
  let primaryValue = 0;
  categoryLevers.forEach(id => {
    if (gameState.levers[id] > primaryValue) {
      primaryValue = gameState.levers[id];
      primaryLeverId = id;
    }
  });

  // If no matching lever unlocked, use best available
  if (!primaryLeverId) {
    let best = null; let bestVal = 0;
    gameState.unlockedLevers.forEach(id => {
      if (!MULTIPLIER_DEFS[id] && gameState.levers[id] > bestVal) {
        bestVal = gameState.levers[id]; best = id;
      }
    });
    primaryLeverId = best;
    primaryValue = bestVal;
  }

  // 3. Apply multiplier bonus
  const primaryDef = ALL_LEVERS[primaryLeverId];
  const multiplierBonus = getMultiplierBonus(primaryDef?.category || 'OFFENSIVE', gameState.levers);
  const effectiveValue = primaryValue * multiplierBonus;

  // Show multiplier modifier if not 1.0
  if (Math.abs(multiplierBonus - 1.0) > 0.01) {
    showMultiplierModifier(primaryLeverId, multiplierBonus);
  }

  // 4. Determine outcome
  // Effective 7+ = clean counter, 4-6 = partial, below 4 = full hit
  let outcome;
  if (effectiveValue >= 7) {
    outcome = 'clean';
  } else if (effectiveValue >= 4) {
    outcome = 'partial';
  } else {
    outcome = 'full_hit';
  }

  // 5. Play ship response visual
  playShipResponse(counterCat, primaryValue);

  // 6. Animate threat to ship & resolve
  const threatEl = threat.element;
  setTimeout(() => {
    if (outcome === 'clean') {
      resolveCleanCounter(threatEl, primaryLeverId);
    } else if (outcome === 'partial') {
      resolvePartialHit(threatEl);
    } else {
      resolveFullHit(threatEl);
    }

    // Apply stat changes
    applyOutcome(outcome, threat.type, primaryLeverId, primaryValue);

    // Log
    gameState.threatLog.push({
      type: threat.type,
      lever_used: primaryLeverId,
      outcome: outcome,
      sector: gameState.sector,
      turn: gameState.turn
    });

    // Show diagnosis
    showDiagnosis(outcome, threat.type, primaryLeverId);

    // Clean up
    setTimeout(() => {
      threatEl.remove();
      gameState.currentThreat = null;

      // Check death
      if (!checkDeath()) {
        // Check sector complete
        if (gameState.threatsInSector >= THREATS_PER_SECTOR) {
          advanceSector();
        } else {
          // Next threat after 1.5s
          setTimeout(spawnThreat, 1500);
        }
      }
    }, 800);
  }, 500); // Wait for ship response to play
}

/* ---------- SHIP RESPONSE VISUALS ---------- */
function playShipResponse(category, leverValue) {
  switch (category) {
    case 'OFFENSIVE':
      fireBeam(leverValue);
      break;
    case 'DEFENSIVE':
      pulseHull(leverValue);
      break;
    case 'MANEUVER':
      slideShip(leverValue);
      break;
  }
}

function fireBeam(value) {
  const beam = document.createElement('div');
  beam.className = 'attack-beam';
  beam.style.opacity = value >= 7 ? '0.9' : '0.4';
  beam.style.width = value >= 7 ? '3px' : '6px'; // narrow = precise
  $shipContainer.appendChild(beam);

  // Animate beam upward
  beam.animate([
    { transform: 'scaleY(0)', transformOrigin: 'bottom' },
    { transform: 'scaleY(1)', transformOrigin: 'bottom' }
  ], { duration: 200, fill: 'forwards' });

  setTimeout(() => beam.remove(), 500);
}

function pulseHull(value) {
  const pulse = document.createElement('div');
  pulse.className = 'hull-pulse';
  $shipContainer.appendChild(pulse);

  pulse.animate([
    { transform: 'scale(1)', opacity: value >= 7 ? 0.6 : 0.2 },
    { transform: 'scale(3)', opacity: 0 }
  ], { duration: 600, fill: 'forwards' });

  setTimeout(() => pulse.remove(), 700);
}

function slideShip(value) {
  // Move ship to adjacent position
  const current = gameState.shipPosition;
  if (current === SHIP_POSITIONS.CENTER) {
    // Choose a side
    gameState.shipPosition = Math.random() < 0.5 ? SHIP_POSITIONS.LEFT : SHIP_POSITIONS.RIGHT;
  } else {
    gameState.shipPosition = SHIP_POSITIONS.CENTER;
  }
  updateShipPosition(true);
}

/* ---------- OUTCOME RESOLUTION ---------- */
function resolveCleanCounter(threatEl, primaryLeverId) {
  // Fragment burst
  fragmentBurst(threatEl);
  // Ship flash
  shipFlash();
  // Stat tick
  statTick(primaryLeverId);
  // Audio chime
  playCleanCounterChime();
  // Screen micro-pulse
  screenMicroPulse();
  // Combo
  gameState.comboCount++;
  if (gameState.comboCount > gameState.comboHigh) gameState.comboHigh = gameState.comboCount;
  showComboWord();

  // Fade out threat
  threatEl.style.transition = 'opacity 0.3s';
  threatEl.style.opacity = '0';
}

function resolvePartialHit(threatEl) {
  // Smaller burst
  fragmentBurst(threatEl, 5);
  playPartialHitSound();
  shakeShip();
  gameState.comboCount = 0;
  threatEl.style.transition = 'opacity 0.5s';
  threatEl.style.opacity = '0';
}

function resolveFullHit(threatEl) {
  // No burst, ship shake, stat drops
  shakeShip();
  gameState.comboCount = 0;
  threatEl.style.transition = 'opacity 0.5s';
  threatEl.style.opacity = '0';
}

function applyOutcome(outcome, threatType, primaryLeverId, primaryValue) {
  if (outcome === 'clean') {
    gameState.momentum = Math.min(10, gameState.momentum + 0.3);
    gameState.clarity = Math.min(10, gameState.clarity + 0.2);
  } else if (outcome === 'partial') {
    gameState.resilience = Math.max(0, gameState.resilience - 0.8);
    gameState.momentum = Math.max(0, gameState.momentum - 0.2);
  } else {
    // Full hit
    gameState.resilience = Math.max(0, gameState.resilience - 1.5);
    gameState.momentum = Math.max(0, gameState.momentum - 0.5);
    gameState.clarity = Math.max(0, gameState.clarity - 0.3);
  }

  // Apply specific lever neglect consequences
  applyNeglectConsequences(threatType);

  // Systems self-repair check
  if (gameState.levers.systems && gameState.levers.systems >= 4) {
    gameState.resilience = Math.min(10, gameState.resilience + 0.15);
  }

  updateStatDisplays();
}

function applyNeglectConsequences(threatType) {
  const levers = gameState.levers;

  // Capital: at 2 or below when hit, one random lever drops by 1
  if (threatType === 'HEAVY' && levers.capital !== undefined && levers.capital <= 2) {
    const otherLevers = gameState.unlockedLevers.filter(id => id !== 'capital' && !MULTIPLIER_DEFS[id]);
    if (otherLevers.length > 0) {
      const target = otherLevers[Math.floor(Math.random() * otherLevers.length)];
      gameState.levers[target] = Math.max(0, gameState.levers[target] - 1);
      refreshLeverCell(target);
    }
  }

  // Switching costs: passenger loss
  if (levers.switchingCosts !== undefined && levers.switchingCosts <= 3) {
    gameState.passengers = Math.max(0, gameState.passengers - 1);
    updateStatDisplays();
    // Animate passenger dot leaving
    animatePassengerLoss();
  }
}

function animatePassengerLoss() {
  const dots = $battlefield.querySelectorAll('.passenger-dot.active');
  if (dots.length > 0) {
    const lastDot = dots[dots.length - 1];
    lastDot.classList.add('drifting');
    setTimeout(() => {
      lastDot.classList.remove('active');
      lastDot.classList.remove('drifting');
    }, 800);
  }
}

function refreshLeverCell(id) {
  const cell = document.querySelector(`.lever-cell[data-lever-id="${id}"]`);
  if (cell) updateLeverVisual(cell, id);
}

/* ---------- DOPAMINE STACK ---------- */
function fragmentBurst(anchorEl, count = 12) {
  const rect = anchorEl.getBoundingClientRect();
  const bfRect = $battlefield.getBoundingClientRect();
  const cx = rect.left - bfRect.left + rect.width / 2;
  const cy = rect.top - bfRect.top + rect.height / 2;

  for (let i = 0; i < count; i++) {
    const frag = document.createElement('div');
    frag.className = 'fragment';
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 60 + Math.random() * 20;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const rotation = Math.random() * 360;
    const size = 3 + Math.random() * 5;

    frag.style.cssText = `
      position:absolute; left:${cx}px; top:${cy}px;
      width:${size}px; height:${size}px;
      background:#f5f0e8; transform:rotate(${rotation}deg);
      pointer-events:none; z-index:50;
    `;

    $battlefield.appendChild(frag);

    frag.animate([
      { transform: `translate(0,0) rotate(${rotation}deg)`, opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) rotate(${rotation + 180}deg)`, opacity: 0 }
    ], { duration: 400, fill: 'forwards' });

    setTimeout(() => frag.remove(), 450);
  }
}

function shipFlash() {
  const flash = document.createElement('div');
  flash.className = 'ship-flash-overlay';
  $shipContainer.appendChild(flash);
  flash.animate([
    { opacity: 1 },
    { opacity: 0 }
  ], { duration: 300, fill: 'forwards' });
  setTimeout(() => flash.remove(), 350);
}

function statTick(leverKey) {
  // Find highest stat and give it a visual tick
  const stats = ['momentum', 'resilience', 'clarity'];
  stats.forEach(s => {
    const el = document.querySelector(`.stat-readout[data-stat="${s}"] .stat-bar-fill`);
    if (el) {
      const currentWidth = parseFloat(el.style.width) || 50;
      el.style.width = `${Math.min(100, currentWidth + 4)}%`;
      setTimeout(() => {
        el.style.width = `${(gameState[s] / 10) * 100}%`;
      }, 800);
    }
  });
}

function screenMicroPulse() {
  const pulse = document.createElement('div');
  pulse.className = 'screen-pulse';
  document.body.appendChild(pulse);
  pulse.animate([
    { opacity: 0.12 },
    { opacity: 0 }
  ], { duration: 280 });
  setTimeout(() => pulse.remove(), 300);
}

function showComboWord() {
  const count = gameState.comboCount;
  if (count < 2) return;

  const word = COMBO_WORDS[Math.min(count, 6)];
  if (!word) return;

  const el = document.createElement('div');
  el.className = 'combo-word';
  el.textContent = word;
  $battlefield.appendChild(el);

  el.animate([
    { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
    { opacity: 0, transform: 'translate(-50%, -20px) scale(1.1)' }
  ], { duration: 600, fill: 'forwards' });

  setTimeout(() => el.remove(), 650);
}

function showMultiplierModifier(leverKey, bonus) {
  const cell = document.querySelector(`.lever-cell[data-lever-id="${leverKey}"]`);
  if (!cell) return;

  const pct = Math.round((bonus - 1) * 100);
  const sign = pct >= 0 ? '+' : '';
  const mod = document.createElement('div');
  mod.className = 'multiplier-modifier';
  mod.textContent = `${sign}${pct}%`;
  cell.appendChild(mod);

  mod.animate([
    { opacity: 1 },
    { opacity: 0 }
  ], { duration: 500, delay: 500, fill: 'forwards' });

  setTimeout(() => mod.remove(), 1100);
}

function shakeShip() {
  $shipContainer.classList.add('shaking');
  setTimeout(() => $shipContainer.classList.remove('shaking'), 300);
}

/* ---------- DIAGNOSIS LINE ---------- */
function showDiagnosis(outcome, threatType, leverKey) {
  if (!$diagnosisLine) return;

  const leverName = ALL_LEVERS[leverKey]?.shortName || leverKey;
  let text;

  if (outcome === 'clean') {
    text = `${leverName} countered the ${threatType.toLowerCase()} threat cleanly.`;
  } else if (outcome === 'partial') {
    text = `${leverName} weakened the ${threatType.toLowerCase()} threat, but it still grazed the hull.`;
  } else {
    text = `The ${threatType.toLowerCase()} threat broke through. ${leverName} wasn't strong enough.`;
  }

  $diagnosisLine.textContent = text;
  $diagnosisLine.classList.add('visible');
  setTimeout(() => $diagnosisLine.classList.remove('visible'), 4000);
}

/* ---------- DEATH CHECK ---------- */
function checkDeath() {
  if (gameState.resilience <= 0) {
    gameState.alive = false;
    gameState.running = false;
    showDeathScreen();
    return true;
  }
  return false;
}

/* ---------- DEATH SCREEN ---------- */
async function showDeathScreen() {
  $deathOverlay.classList.add('active');

  const nameEl = $deathOverlay.querySelector('.death-ship-name');
  const summaryEl = $deathOverlay.querySelector('.death-summary');
  const debriefStatus = $deathOverlay.querySelector('.death-debrief-status');

  nameEl.textContent = gameState.shipName;
  summaryEl.textContent = `Survived ${gameState.turn} turns. Reached Sector ${gameState.sector}. Combo high: ${gameState.comboHigh}.`;

  // Assemble payload and send to API
  debriefStatus.textContent = 'Generating your strategic debrief...';
  debriefStatus.classList.add('ready');

  const payload = buildRunEndPayload();

  try {
    const res = await fetch('/api/game/debrief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.debrief) {
      debriefStatus.innerHTML = `<div class="debrief-text">${data.debrief.replace(/\n/g, '<br>')}</div>`;
    }
  } catch (err) {
    debriefStatus.textContent = 'Debrief unavailable. Try again later.';
  }

  // Wire restart button
  const restartBtn = $deathOverlay.querySelector('.death-cta-primary');
  restartBtn.onclick = () => {
    $deathOverlay.classList.remove('active');
    startGame();
  };
}

function buildRunEndPayload() {
  const leverValuesAtDeath = {};
  for (const id of Object.keys(ALL_LEVERS)) {
    leverValuesAtDeath[id] = gameState.levers[id] ?? null;
  }

  return {
    intake_answers: gameState.intakeAnswers,
    run_summary: {
      turns_survived: gameState.turn,
      sector_reached: gameState.sector,
      levers_unlocked: gameState.unlockedLevers,
      lever_values_at_death: leverValuesAtDeath,
      threats_encountered: gameState.threatLog,
      noise_events_hit: gameState.noiseHits,
      killing_threat: gameState.threatLog[gameState.threatLog.length - 1]?.type || '',
      combo_high: gameState.comboHigh,
      passenger_count_final: gameState.passengers
    }
  };
}

/* ---------- SECTOR ADVANCEMENT ---------- */
function advanceSector() {
  if (gameState.sector >= TOTAL_SECTORS) {
    // Game complete — victory
    showVictoryScreen();
    return;
  }

  const nextSector = gameState.sector + 1;
  const newLevers = getNewLeversForSector(nextSector);

  if (newLevers.length > 0) {
    // Run unlock ceremony for each new lever
    runUnlockCeremony(newLevers, 0, () => {
      gameState.sector = nextSector;
      gameState.threatsInSector = 0;
      gameState.unlockedLevers = getUnlockedLevers(nextSector);

      // Initialize new lever values
      for (const id of newLevers) {
        gameState.levers[id] = ALL_LEVERS[id].defaultValue;
      }

      buildLeverPanel();
      updateSectorDisplay();

      // Sector bonus based on passengers
      const bonus = Math.floor(gameState.passengers / 5) * 0.2;
      gameState.momentum = Math.min(10, gameState.momentum + bonus);
      updateStatDisplays();

      // Tutorial cards for new levers
      runLeverTutorials(newLevers, 0, () => {
        setTimeout(spawnThreat, 1500);
      });
    });
  } else {
    gameState.sector = nextSector;
    gameState.threatsInSector = 0;
    updateSectorDisplay();
    setTimeout(spawnThreat, 1500);
  }
}

/* ---------- UNLOCK CEREMONY ---------- */
function runUnlockCeremony(leverIds, index, onComplete) {
  if (index >= leverIds.length) {
    if (onComplete) onComplete();
    return;
  }

  const leverId = leverIds[index];
  const def = ALL_LEVERS[leverId];
  const unlockText = UNLOCK_TEXT[leverId];

  // 1. Dim battlefield
  const dimOverlay = document.createElement('div');
  dimOverlay.className = 'ceremony-dim';
  $battlefield.appendChild(dimOverlay);
  dimOverlay.animate([{ opacity: 0 }, { opacity: 0.8 }], { duration: 500, fill: 'forwards' });

  // 2. Play ceremony chime
  setTimeout(() => playUnlockCeremonyChime(), 500);

  // 3. Illuminate lever slot
  setTimeout(() => {
    const slot = document.querySelector(`.lever-cell.locked[data-lever-id="${leverId}"]`);
    if (slot) {
      slot.classList.add('illuminating');
    }
  }, 500);

  // 4. Show text
  setTimeout(() => {
    const textEl = document.createElement('div');
    textEl.className = 'ceremony-text';
    textEl.innerHTML = `
      <div class="ceremony-title">NEW LEVER UNLOCKED</div>
      <div class="ceremony-name">${def.name}</div>
      <div class="ceremony-line">${unlockText?.gameLine || ''}</div>
      <div class="ceremony-line">${unlockText?.bizLine || ''}</div>
    `;
    $battlefield.appendChild(textEl);
    textEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });

    // 5. Pulse from lever slot
    setTimeout(() => {
      const pulseRing = document.createElement('div');
      pulseRing.className = 'ceremony-pulse-ring';
      $leverPanel.appendChild(pulseRing);
      pulseRing.animate([
        { transform: 'scale(0)', opacity: 0.6 },
        { transform: 'scale(4)', opacity: 0 }
      ], { duration: 1000, fill: 'forwards' });
      setTimeout(() => pulseRing.remove(), 1100);
    }, 500);

    // 6. Fade out after 2 seconds
    setTimeout(() => {
      textEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
      dimOverlay.animate([{ opacity: 0.8 }, { opacity: 0 }], { duration: 500, fill: 'forwards' });

      setTimeout(() => {
        textEl.remove();
        dimOverlay.remove();
        // Next lever in sequence
        runUnlockCeremony(leverIds, index + 1, onComplete);
      }, 500);
    }, 2500);
  }, 1000);
}

/* ---------- LEVER TUTORIALS ---------- */
function runLeverTutorials(leverIds, index, onComplete) {
  if (index >= leverIds.length) {
    if (onComplete) onComplete();
    return;
  }

  const leverId = leverIds[index];
  const def = ALL_LEVERS[leverId];
  if (!def.tutorial) {
    runLeverTutorials(leverIds, index + 1, onComplete);
    return;
  }

  const card = document.createElement('div');
  card.className = 'lever-tutorial-card';
  card.innerHTML = `
    <div class="tutorial-card-icon"></div>
    <div class="tutorial-card-name">${def.name}</div>
    <div class="tutorial-card-line">In the game: ${def.tutorial.game}</div>
    <div class="tutorial-card-line">In your business: ${def.tutorial.business}</div>
    <button class="tutorial-card-next">NEXT</button>
  `;

  // Insert icon
  const iconSlot = card.querySelector('.tutorial-card-icon');
  iconSlot.appendChild(drawLeverIcon(def.icon, 40));

  $battlefield.appendChild(card);

  const nextBtn = card.querySelector('.tutorial-card-next');
  nextBtn.addEventListener('click', () => {
    card.remove();
    runLeverTutorials(leverIds, index + 1, onComplete);
  });
}

/* ---------- INITIAL TUTORIAL ---------- */
function runTutorial(onComplete) {
  const steps = [
    'Welcome aboard. Your business is now a ship. Each turn, a threat appears. Adjust your levers and press GO.',
    'You have 3 lever adjustments per turn. Each point you move any lever costs one adjustment.',
    'AGGRESSIVE threats need OFFENSIVE levers. HEAVY threats need DEFENSIVE levers. FAST threats need MANEUVER levers.',
    'Watch the threat shapes — sharp is aggressive, round is heavy, thin darts are fast.',
    'Your ship\'s fate depends on your choices. Good luck, Captain.'
  ];

  let current = 0;

  // Create tutorial overlay
  const overlay = document.createElement('div');
  overlay.className = 'tutorial-overlay active';

  const textBox = document.createElement('div');
  textBox.className = 'tutorial-text-box';

  const textP = document.createElement('p');
  textP.className = 'tutorial-text';
  textP.textContent = steps[0];

  const stepIndicator = document.createElement('div');
  stepIndicator.className = 'tutorial-step-indicator';

  const dotsDiv = document.createElement('div');
  dotsDiv.className = 'tutorial-dots';
  steps.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'tutorial-dot' + (i === 0 ? ' active' : '');
    dotsDiv.appendChild(d);
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'tutorial-next';
  nextBtn.textContent = 'NEXT';

  stepIndicator.appendChild(dotsDiv);
  stepIndicator.appendChild(nextBtn);
  textBox.appendChild(textP);
  textBox.appendChild(stepIndicator);
  overlay.appendChild(textBox);
  document.body.appendChild(overlay);

  nextBtn.addEventListener('click', () => {
    current++;
    if (current >= steps.length) {
      overlay.remove();
      if (onComplete) onComplete();
    } else {
      textP.textContent = steps[current];
      dotsDiv.querySelectorAll('.tutorial-dot').forEach((d, i) => {
        d.classList.toggle('active', i <= current);
      });
      if (current === steps.length - 1) nextBtn.textContent = 'BEGIN';
    }
  });
}

/* ---------- VICTORY SCREEN ---------- */
function showVictoryScreen() {
  $deathOverlay.classList.add('active');
  const nameEl = $deathOverlay.querySelector('.death-ship-name');
  const summaryEl = $deathOverlay.querySelector('.death-summary');

  nameEl.textContent = `${gameState.shipName} — VOYAGE COMPLETE`;
  summaryEl.textContent = `You navigated all 7 sectors. ${gameState.passengers} passengers survived. Combo high: ${gameState.comboHigh}. Well captained.`;

  // Still send debrief
  showDeathScreen();
}

/* ---------- PASSENGER DOTS ---------- */
function renderPassengerDots() {
  const container = $battlefield.querySelector('.passenger-indicators');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < 15; i++) {
    const dot = document.createElement('div');
    dot.className = 'passenger-dot' + (i < gameState.passengers ? ' active' : '');
    container.appendChild(dot);
  }
}

/* ---------- INIT ON LOAD ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initGame();
  renderPassengerDots();
});
