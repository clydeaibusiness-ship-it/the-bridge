// ============================================================
// SIMULATOR.JS — The Bridge Simulator v2
// All game logic: resources, situations, outcomes, celebrations
// ============================================================

let situationsData = null;       // static fallback data
let currentSituation = 0;
let selectedOption = null;
let intakeProfile = null;          // personalized profile from API
let generatedSituations = [];      // API-generated situations stored here
let nextSituationPromise = null;   // pre-fetch promise for next situation
let coveredThemes = [];            // themes already used
let businessContext = null;        // from intake API

// Resources
const resources = {
  capital: 18400,
  customers: 24,
  positioning: 62,
  switchingCosts: 38
};

const CAPS = {
  capital: 25000,
  customers: 40,
  positioning: 100,
  switchingCosts: 100
};

const RESOURCE_LABELS = {
  capital: 'Capital',
  customers: 'Customers',
  positioning: 'Positioning',
  switchingCosts: 'Switching Costs'
};

// ============================================================
// INIT
// ============================================================
async function init() {
  try {
    const resp = await fetch('/data/situations.json');
    situationsData = await resp.json();
  } catch (e) {
    console.error('Failed to load situations:', e);
    return;
  }

  // Load session state from localStorage
  try {
    const session = JSON.parse(localStorage.getItem('bridge_session'));
    if (session) {
      // Load business context for situation generation
      if (session.businessContext) businessContext = session.businessContext;

      // Show business name on intro screen
      const name = session.businessName || session.shipName;
      if (name) {
        const titleEl = document.querySelector('.intro-title');
        if (titleEl) titleEl.textContent = name;
      }

      // Load previous simulator resource state if saved
      if (session.simulatorResources) {
        const r = session.simulatorResources;
        if (r.capital !== undefined) resources.capital = r.capital;
        if (r.customers !== undefined) resources.customers = r.customers;
        if (r.positioning !== undefined) resources.positioning = r.positioning;
        if (r.switchingCosts !== undefined) resources.switchingCosts = r.switchingCosts;
      }
    }
  } catch (e) {}

  bindEvents();
  updateResourceDisplay();
}

let isLoggedIn = false;

function bindEvents() {
  document.getElementById('btn-start').addEventListener('click', showIntake);
  document.getElementById('intake-form').addEventListener('submit', submitIntake);
  document.getElementById('btn-go-back').addEventListener('click', goBackToSituation);
  document.getElementById('btn-confirm').addEventListener('click', confirmChoice);
  document.getElementById('btn-next').addEventListener('click', nextSituation);

  const playAgainBtn = document.getElementById('btn-play-again');
  if (playAgainBtn) playAgainBtn.addEventListener('click', restartGame);

  const fullAnalysisBtn = document.getElementById('btn-full-analysis');
  if (fullAnalysisBtn) fullAnalysisBtn.addEventListener('click', getFullAnalysis);

  // Tooltip overlay dismiss
  document.getElementById('tooltip-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeTooltip();
  });

  // Check Clerk auth state
  checkAuth();
}

async function checkAuth() {
  try {
    const { Clerk } = await import('https://cdn.jsdelivr.net/npm/@clerk/clerk-js/+esm');
    const clerk = new Clerk('pk_live_Y2xlcmsuY2FwdGFpbnNicmlkZ2UuaW8k');
    await clerk.load();
    isLoggedIn = !!clerk.user;
  } catch (e) {
    isLoggedIn = false;
  }
}

// ============================================================
// SCREEN MANAGEMENT
// ============================================================
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  // Toggle sim-active class on html for scroll behavior
  const gameScreens = ['screen-situation', 'screen-confirm', 'screen-outcome', 'screen-results'];
  if (gameScreens.includes(id)) {
    document.documentElement.classList.add('sim-active');
  } else {
    document.documentElement.classList.remove('sim-active');
  }

  // Scroll page to top on screen change
  window.scrollTo(0, 0);
}

// ============================================================
// GAME FLOW
// ============================================================
async function showIntake() {
  // Issue 3: Pre-populate simulator intake from shared intake data
  await prefillSimulatorIntake();
  showScreen('screen-intake');
}

async function prefillSimulatorIntake() {
  let prefilled = false;

  // Field mapping: Navigation Chart intake field → simulator intake field
  const fieldMap = {
    industry: 'intake-industry',
    description: 'intake-industry', // fallback: use description for industry
    years: 'intake-years',
    revenue: 'intake-revenue',
    employees: 'intake-employees',
    uncertainty: 'intake-challenge',
    challenge: 'intake-challenge',
    goal: 'intake-goal',
    differentiator: 'intake-differentiator'
  };

  // 1. Try server-side unified intake
  try {
    const resp = await fetch('/api/intake/data');
    if (resp.ok) {
      const data = await resp.json();
      if (data.intake) {
        const a = data.intake;
        // Map fields
        if (a.industry) setVal('intake-industry', a.industry);
        else if (a.description) setVal('intake-industry', a.description);
        if (a.years) setVal('intake-years', a.years);
        if (a.revenue) setVal('intake-revenue', a.revenue);
        if (a.employees) setVal('intake-employees', a.employees);
        if (a.challenge || a.uncertainty) setVal('intake-challenge', a.challenge || a.uncertainty);
        if (a.goal) setVal('intake-goal', a.goal);
        if (a.differentiator) setVal('intake-differentiator', a.differentiator);
        prefilled = true;
      }
    }
  } catch (e) {}

  // 2. Fallback: localStorage
  if (!prefilled) {
    try {
      const session = JSON.parse(localStorage.getItem('bridge_session'));
      if (session && session.intakeAnswers) {
        const a = session.intakeAnswers;
        if (a.description) setVal('intake-industry', a.description);
        if (a.years) setVal('intake-years', a.years);
        if (a.revenue) setVal('intake-revenue', a.revenue);
        if (a.employees) setVal('intake-employees', a.employees);
        if (a.uncertainty) setVal('intake-challenge', a.uncertainty);
        if (a.goal) setVal('intake-goal', a.goal);
        if (a.differentiator) setVal('intake-differentiator', a.differentiator);
        prefilled = true;
      }
    } catch (e) {}
  }

  if (prefilled) {
    const notice = document.getElementById('sim-prefill-notice');
    if (notice) notice.style.display = 'block';
  }
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val) el.value = val;
}

async function submitIntake(e) {
  e.preventDefault();

  const answers = {
    industry: document.getElementById('intake-industry').value,
    years: document.getElementById('intake-years').value,
    revenue: document.getElementById('intake-revenue').value,
    employees: document.getElementById('intake-employees').value,
    challenge: document.getElementById('intake-challenge').value,
    goal: document.getElementById('intake-goal').value,
    differentiator: document.getElementById('intake-differentiator').value
  };

  // Show loading screen
  showScreen('screen-loading');

  // Race: API call vs 6s timeout (intake now also generates businessContext)
  const fallback = {
    ship_name: 'ISV Greenline',
    destination_name: 'Growth Horizon',
    industry_key: 'lawn_care',
    flavor_text: 'Your business is waiting. The decisions ahead are yours to make.',
    businessContext: null
  };

  try {
    const result = await Promise.race([
      fetchIntake(answers),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
    ]);
    intakeProfile = result;
  } catch (err) {
    console.warn('Intake API failed or timed out, using fallback:', err.message);
    intakeProfile = fallback;
  }

  // Store answers and businessContext
  intakeProfile._answers = answers;
  businessContext = intakeProfile.businessContext || null;

  // Save to localStorage
  try {
    localStorage.setItem('bridge_session', JSON.stringify({
      shipName: intakeProfile.ship_name,
      destination: intakeProfile.destination_name,
      industryKey: intakeProfile.industry_key,
      businessContext: businessContext
    }));
  } catch (e) { /* localStorage unavailable */ }

  // Issue 3: Save simulator intake answers to server for sharing with Navigation Chart
  try {
    fetch('/api/intake/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: {
          industry: answers.industry,
          challenge: answers.challenge,
          goal: answers.goal,
          differentiator: answers.differentiator,
          years: answers.years,
          revenue: answers.revenue,
          employees: answers.employees
        }
      })
    }).catch(() => {}); // non-critical
  } catch (e) {}

  // Reset state
  generatedSituations = [];
  coveredThemes = [];
  nextSituationPromise = null;

  // Pre-generate situation 1 before starting the game
  try {
    const sit1 = await fetchSituation(1);
    generatedSituations[0] = sit1;
    if (sit1.theme) coveredThemes.push(sit1.theme);
  } catch (err) {
    console.warn('Situation 1 generation failed, using static fallback:', err.message);
    generatedSituations[0] = situationsData.situations[0];
  }

  startGame();
}

async function fetchIntake(answers) {
  const resp = await fetch('/api/game/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

async function fetchSituation(num) {
  if (!businessContext) throw new Error('No businessContext');
  const resp = await fetch('/api/game/situation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessContext,
      situationNumber: num,
      previousThemes: coveredThemes
    })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json();
}

function prefetchNextSituation(num) {
  if (num > 5 || !businessContext) return;
  nextSituationPromise = fetchSituation(num)
    .then(sit => {
      generatedSituations[num - 1] = sit;
      if (sit.theme) coveredThemes.push(sit.theme);
      return sit;
    })
    .catch(err => {
      console.warn(`Background fetch for situation ${num} failed:`, err.message);
      // Will fall back to static in nextSituation()
      return null;
    });
}

function startGame() {
  document.getElementById('resource-bar').classList.remove('hidden');
  currentSituation = 0;
  updateResourceDisplay();
  showSituation(0);

  // Pre-generate situation 2 in background
  prefetchNextSituation(2);
}

function showSituation(index) {
  const sit = generatedSituations[index] || situationsData.situations[index];
  if (!sit) {
    showResults();
    return;
  }

  document.getElementById('turn-label').textContent = sit.turnLabel;
  document.getElementById('situation-title').textContent = sit.title;
  document.getElementById('situation-body').textContent = sit.body;
  document.getElementById('crew-comment-text').textContent = sit.crewComment;

  const container = document.getElementById('options-container');
  container.innerHTML = '';

  sit.options.forEach((opt, i) => {
    const card = document.createElement('div');
    card.className = 'option-card';
    card.dataset.index = i;

    // Check if option costs capital the player can't afford
    const capitalCost = opt.resourceChanges.capital || 0;
    if (capitalCost < 0 && resources.capital + capitalCost < 0) {
      card.classList.add('disabled');
    }

    const letter = document.createElement('div');
    letter.className = 'option-letter';
    letter.textContent = `Option ${opt.id}`;

    const body = document.createElement('p');
    body.className = 'option-body';
    body.textContent = opt.body;

    const tags = document.createElement('div');
    tags.className = 'option-tags';
    opt.tags.forEach(tag => {
      tags.appendChild(createTag(tag));
    });

    card.appendChild(letter);
    card.appendChild(body);
    card.appendChild(tags);

    card.addEventListener('click', () => selectOption(i));
    container.appendChild(card);
  });

  selectedOption = null;
  showScreen('screen-situation');
}

function selectOption(index) {
  selectedOption = index;
  const sit = generatedSituations[currentSituation] || situationsData.situations[currentSituation];
  const opt = sit.options[index];

  // Update confirm screen
  document.getElementById('confirm-body').textContent = opt.body;
  const tagsEl = document.getElementById('confirm-tags');
  tagsEl.innerHTML = '';
  opt.tags.forEach(tag => {
    tagsEl.appendChild(createTag(tag));
  });

  showScreen('screen-confirm');
}

function goBackToSituation() {
  showScreen('screen-situation');
}

function confirmChoice() {
  const sit = generatedSituations[currentSituation] || situationsData.situations[currentSituation];
  const opt = sit.options[selectedOption];

  // Store pre-change values
  const prev = { ...resources };

  // 1. Apply resource changes
  applyResourceChanges(opt.resourceChanges);

  // 2. Passive capital income: customers × $600
  resources.capital += resources.customers * 600;

  // 3. Passive customer growth: 25% chance of +1 if below cap
  if (resources.customers < CAPS.customers && Math.random() < 0.25) {
    resources.customers += 1;
  }

  // 4. Clamp
  clampResources();

  // 5. Update display
  updateResourceDisplay();

  // Save resource state to localStorage after every decision (so dashboard shows progress)
  try {
    const session = JSON.parse(localStorage.getItem('bridge_session')) || {};
    session.simulatorResources = { ...resources };
    session.simulatorProgress = { currentSituation: currentSituation + 1, totalSituations: 5 };
    localStorage.setItem('bridge_session', JSON.stringify(session));
  } catch (e) {}

  // Show outcome
  showOutcome(sit, opt, prev);

  // Pre-generate next situation while player reads the outcome
  // Only start if we don't already have one in-flight or stored
  const nextIdx = currentSituation + 1;
  if (nextIdx < 5 && !generatedSituations[nextIdx] && !nextSituationPromise) {
    prefetchNextSituation(nextIdx + 1); // +1 because situationNumber is 1-based
  }
}

async function nextSituation() {
  currentSituation++;
  if (currentSituation >= 5) {
    showResults();
    return;
  }

  // If we have a pre-fetched situation, await it
  if (!generatedSituations[currentSituation] && nextSituationPromise) {
    // Show brief loading only if the promise hasn't resolved yet
    const loadingTimeout = setTimeout(() => {
      document.getElementById('loading-text').textContent = '';
      document.getElementById('loading-subtext').textContent = 'PREPARING NEXT SITUATION';
      showScreen('screen-loading');
    }, 150);

    try {
      const sit = await nextSituationPromise;
      if (sit) generatedSituations[currentSituation] = sit;
    } catch (err) {
      console.warn(`Pre-fetch for situation ${currentSituation + 1} failed, using static:`, err.message);
    }
    clearTimeout(loadingTimeout);
  }

  // Safety net: fall back to static
  if (!generatedSituations[currentSituation]) {
    generatedSituations[currentSituation] = situationsData.situations[currentSituation];
  }

  showSituation(currentSituation);
}

async function restartGame() {
  resources.capital = 18400;
  resources.customers = 24;
  resources.positioning = 62;
  resources.switchingCosts = 38;
  currentSituation = 0;
  generatedSituations = [];
  coveredThemes = [];
  nextSituationPromise = null;

  // Re-generate situation 1
  showScreen('screen-loading');
  document.getElementById('loading-text').textContent = '';
  document.getElementById('loading-subtext').textContent = 'PREPARING NEXT SITUATION';

  try {
    const sit1 = await fetchSituation(1);
    generatedSituations[0] = sit1;
    if (sit1.theme) coveredThemes.push(sit1.theme);
  } catch (err) {
    generatedSituations[0] = situationsData.situations[0];
  }

  updateResourceDisplay();
  showSituation(0);
  prefetchNextSituation(2);
}

function getFullAnalysis() {
  // Try sendPrompt if available (embedded in Claude chat)
  if (typeof window.sendPrompt === 'function') {
    window.sendPrompt('I just finished the Bridge simulator. Can you tell me what the full Bridge membership would give me based on how I played?');
    return;
  }
  // Standalone: go to pricing/landing with resource state
  const params = new URLSearchParams({
    capital: resources.capital,
    customers: resources.customers,
    positioning: resources.positioning,
    switchingCosts: resources.switchingCosts,
    source: 'simulator'
  });
  window.location.href = `/?${params.toString()}`;
}

// ============================================================
// RESOURCE MANAGEMENT
// ============================================================
function applyResourceChanges(changes) {
  // Only apply to the 4 core resources. Other keys (informationAsymmetry, etc.)
  // are narrative — they appear in tags but don't affect the 4 tracked bars.
  if (changes.capital) resources.capital += changes.capital;
  if (changes.customers) resources.customers += changes.customers;
  if (changes.positioning) resources.positioning += changes.positioning;
  if (changes.switchingCosts) resources.switchingCosts += changes.switchingCosts;
}

function clampResources() {
  resources.capital = Math.max(0, Math.min(CAPS.capital, resources.capital));
  resources.customers = Math.max(0, Math.min(CAPS.customers, resources.customers));
  resources.positioning = Math.max(0, Math.min(CAPS.positioning, resources.positioning));
  resources.switchingCosts = Math.max(0, Math.min(CAPS.switchingCosts, resources.switchingCosts));
}

function updateResourceDisplay() {
  const data = [
    { key: 'capital', text: `$${resources.capital.toLocaleString()}`, pct: (resources.capital / CAPS.capital) * 100 },
    { key: 'customers', text: `${resources.customers} / ${CAPS.customers}`, pct: (resources.customers / CAPS.customers) * 100 },
    { key: 'positioning', text: `${resources.positioning}%`, pct: resources.positioning },
    { key: 'switchingCosts', text: `${resources.switchingCosts}%`, pct: resources.switchingCosts }
  ];

  data.forEach(({ key, text, pct }) => {
    // Mobile floating bar
    const valEl = document.getElementById(`val-${key}`);
    const fillEl = document.getElementById(`fill-${key}`);
    if (valEl) valEl.textContent = text;
    if (fillEl) fillEl.style.width = `${pct}%`;

    // Desktop inline bar (inside sim-left)
    const valEl2 = document.getElementById(`val-${key}-2`);
    const fillEl2 = document.getElementById(`fill-${key}-2`);
    if (valEl2) valEl2.textContent = text;
    if (fillEl2) fillEl2.style.width = `${pct}%`;
  });
}

// ============================================================
// OUTCOME DISPLAY
// ============================================================
function showOutcome(situation, option, prevResources) {
  const el = (id) => document.getElementById(id);

  // Turn label
  el('outcome-turn-label').textContent = situation.turnLabel;

  // Outcome label
  const labelEl = el('outcome-label');
  labelEl.className = 'outcome-label'; // reset
  let labelText = '';
  if (option.outcomeType === 'clean') {
    labelText = 'Course held';
    labelEl.classList.add('clean');
  } else if (option.outcomeType === 'partial') {
    labelText = 'Partial response';
    labelEl.classList.add('partial');
  } else {
    labelText = 'Position lost';
    labelEl.classList.add('missed');
  }
  labelEl.textContent = labelText;

  // Determine celebration scale
  const scale = getCelebrationScale(option);

  // Apply celebration animation
  if (scale > 0) {
    labelEl.classList.add(`celebrate-${scale}`);
    // Pulse resource bars
    pulseResourceBars(option.resourceChanges, scale);
    // Confetti for scale 2 and 3
    if (scale >= 2) {
      const dotCount = scale === 3 ? 16 : 8;
      spawnConfetti(dotCount);
    }
  }

  // Mentor line
  const mentorEl = el('mentor-line');
  mentorEl.classList.remove('visible');
  const mentorText = getMentorLine(option.outcomeType, scale);
  mentorEl.textContent = mentorText;
  const mentorDelay = scale === 3 ? 500 : 500;
  setTimeout(() => mentorEl.classList.add('visible'), mentorDelay);

  // Decision body
  el('outcome-decision-body').textContent = option.body;

  // Outcome body
  el('outcome-body').textContent = option.outcomeBody;

  // Case study
  el('case-study-label').textContent = option.caseStudy.label;
  el('case-study-body').textContent = option.caseStudy.body;

  // Effect tags
  const tagsEl = el('outcome-tags');
  tagsEl.innerHTML = '';
  option.tags.forEach(tag => {
    tagsEl.appendChild(createTag(tag));
  });

  // Resource changes grid
  const gridEl = el('resource-changes-grid');
  gridEl.innerHTML = '';
  Object.keys(RESOURCE_LABELS).forEach(key => {
    const item = document.createElement('div');
    item.className = 'resource-change-item';

    const label = document.createElement('div');
    label.className = 'rc-label';
    label.textContent = RESOURCE_LABELS[key];

    const value = document.createElement('div');
    value.className = 'rc-value';
    if (key === 'capital') {
      value.textContent = `$${resources[key].toLocaleString()}`;
    } else if (key === 'customers') {
      value.textContent = `${resources[key]} / ${CAPS[key]}`;
    } else {
      value.textContent = `${resources[key]}%`;
    }

    const delta = document.createElement('div');
    delta.className = 'rc-delta';
    const diff = resources[key] - prevResources[key];
    if (diff > 0) {
      delta.textContent = key === 'capital' ? `+$${diff.toLocaleString()}` : `+${diff}${key !== 'customers' ? '%' : ''}`;
      delta.classList.add('positive');
    } else if (diff < 0) {
      delta.textContent = key === 'capital' ? `-$${Math.abs(diff).toLocaleString()}` : `${diff}${key !== 'customers' ? '%' : ''}`;
      delta.classList.add('negative');
    } else {
      delta.textContent = '—';
      delta.classList.add('neutral');
    }

    item.appendChild(label);
    item.appendChild(value);
    item.appendChild(delta);
    gridEl.appendChild(item);
  });

  // Update next button text
  const nextBtn = el('btn-next');
  if (currentSituation >= 4) {
    nextBtn.textContent = 'See my results →';
  } else {
    nextBtn.textContent = 'Next situation →';
  }

  showScreen('screen-outcome');
}

// ============================================================
// CELEBRATION SYSTEM
// ============================================================
function getCelebrationScale(option) {
  if (option.outcomeType !== 'clean') return 0;

  // Scale 3: exceptional flag
  if (option.exceptional) {
    return 3;
  }

  // Bump logic: weak position + clean call → bump up one
  const weakPosition = resources.capital < 8000 || resources.positioning < 40;

  // Scale based on difficulty
  if (option.difficulty >= 2 || weakPosition) {
    return weakPosition && option.difficulty >= 2 ? 3 : 2;
  }

  return 1;
}

function pulseResourceBars(changes, scale) {
  const pulseKeys = [];
  Object.keys(RESOURCE_LABELS).forEach(key => {
    const v = changes[key] || 0;
    if (v > 0) pulseKeys.push(key);
  });

  const pulseCount = Math.min(scale, 3);
  pulseKeys.forEach(key => {
    // Pulse both mobile and desktop bars
    const fills = [
      document.getElementById(`fill-${key}`),
      document.getElementById(`fill-${key}-2`)
    ].filter(Boolean);

    let i = 0;
    const doPulse = () => {
      fills.forEach(fill => {
        fill.classList.remove('pulse');
        void fill.offsetWidth;
        fill.classList.add('pulse');
      });
      i++;
      if (i < pulseCount) setTimeout(doPulse, 400);
    };
    doPulse();
  });
}

function spawnConfetti(count) {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';

  // Origin: center top of outcome card area
  const originX = window.innerWidth / 2;
  const originY = 160;

  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.className = 'confetti-dot';

    // Spread: wider arc for scale 3
    const angle = (Math.PI / count) * i + Math.PI * 0.1;
    const dist = 60 + Math.random() * 80;
    const dx = Math.cos(angle) * dist * (Math.random() > 0.5 ? 1 : -1);
    const dy = -Math.abs(Math.sin(angle) * dist) - 20;

    dot.style.left = `${originX}px`;
    dot.style.top = `${originY}px`;
    dot.style.setProperty('--dx', `${dx}px`);
    dot.style.setProperty('--dy', `${dy}px`);
    dot.style.animationDelay = `${Math.random() * 0.15}s`;

    container.appendChild(dot);
  }

  // Clean up after animation
  setTimeout(() => { container.innerHTML = ''; }, 1000);
}

function getMentorLine(outcomeType, scale) {
  const lines = situationsData.mentorLines;
  let pool;
  if (outcomeType === 'clean') {
    if (scale >= 3) pool = lines.scale3;
    else if (scale === 2) pool = lines.scale2;
    else pool = lines.scale1;
  } else if (outcomeType === 'partial') {
    pool = lines.partial;
  } else {
    pool = lines.missed;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ============================================================
// RESULTS SCREEN
// ============================================================
function showResults() {
  document.getElementById('resource-bar').classList.add('hidden');

  // Save final resource state to localStorage for dashboard
  try {
    const session = JSON.parse(localStorage.getItem('bridge_session')) || {};
    session.simulatorResources = { ...resources };
    localStorage.setItem('bridge_session', JSON.stringify(session));
  } catch (e) {}

  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';

  const items = [
    { label: 'Capital', value: `$${resources.capital.toLocaleString()}` },
    { label: 'Customers', value: `${resources.customers} / ${CAPS.customers}` },
    { label: 'Positioning', value: `${resources.positioning}%` },
    { label: 'Switching Costs', value: `${resources.switchingCosts}%` }
  ];

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'results-item';
    el.innerHTML = `
      <div class="results-item-label">${item.label}</div>
      <div class="results-item-value">${item.value}</div>
    `;
    grid.appendChild(el);
  });

  // Determine pattern
  const patterns = situationsData.resultPatterns;
  let analysis = patterns.mixed.body;
  if (resources.capital > 20000) {
    analysis = patterns.capitalFocused.body;
  } else if (resources.switchingCosts > 60) {
    analysis = patterns.relationshipFocused.body;
  } else if (resources.positioning > 75) {
    analysis = patterns.positioningFocused.body;
  }

  document.getElementById('results-analysis').textContent = analysis;

  // Show appropriate CTAs based on auth state
  const loggedInActions = document.getElementById('results-actions-logged-in');
  const anonActions = document.getElementById('results-actions-anonymous');
  if (isLoggedIn) {
    loggedInActions.classList.remove('hidden');
    anonActions.classList.add('hidden');
  } else {
    loggedInActions.classList.add('hidden');
    anonActions.classList.remove('hidden');
  }

  showScreen('screen-results');
}

// ============================================================
// TAGS + TOOLTIPS
// ============================================================
function createTag(tagData) {
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = tagData.text;

  if (tagData.lever && situationsData.leverTooltips[tagData.lever]) {
    const info = document.createElement('span');
    info.className = 'tag-info';
    info.textContent = '?';
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      openTooltip(tagData.lever);
    });
    tag.appendChild(info);
  }

  return tag;
}

let tooltipTimer = null;

function openTooltip(leverKey) {
  clearTimeout(tooltipTimer);

  const tooltips = situationsData.leverTooltips;
  const desc = tooltips[leverKey];
  if (!desc) return;

  // Lever display name
  const names = {
    capital: 'Capital',
    customers: 'Customers',
    positioning: 'Positioning Strength',
    switchingCosts: 'Switching Costs Strength',
    informationAsymmetry: 'Information Asymmetry',
    networkEffects: 'Network Effects',
    systems: 'Systems',
    habitDesign: 'Habit Design'
  };

  document.getElementById('tooltip-lever-name').textContent = names[leverKey] || leverKey;
  document.getElementById('tooltip-lever-desc').textContent = desc;
  document.getElementById('tooltip-overlay').classList.remove('hidden');

  tooltipTimer = setTimeout(closeTooltip, 4000);
}

function closeTooltip() {
  clearTimeout(tooltipTimer);
  document.getElementById('tooltip-overlay').classList.add('hidden');
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', init);
