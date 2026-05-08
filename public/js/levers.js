import { CONFIG } from '/config.js';
import { updateShipVisuals } from './ship.js';

// ============================================================
// LEVERS.JS — Owns power allocation math and panel UI.
// Exports: initLevers(), allocatePower(system, dir), getSystemValues()
// ============================================================

// System definitions — label, info popup content, icon key
const SYSTEM_DEFS = {
  sensors: {
    label: 'SENSORS',
    game: 'Reveals threat type and weakness before it reaches you. More power = earlier warning.',
    framework: 'Information Asymmetry — knowing what competitors don\'t is the edge that makes every move precise.',
    iconKey: 'sensors',
  },
  shields: {
    label: 'SHIELDS',
    game: 'Reduces damage when threats land. High shields mean hits cost less.',
    framework: 'Switching Costs + Capital — your runway and customer lock-in determine how much punishment you absorb.',
    iconKey: 'shields',
  },
  weapons: {
    label: 'WEAPONS',
    game: 'Damages or destroys threats before they reach the ship.',
    framework: 'Positioning + Differentiation — a clearly positioned business competes directly and wins.',
    iconKey: 'weapons',
  },
  engines: {
    label: 'ENGINES',
    game: 'Moves the ship out of a threat\'s path entirely.',
    framework: 'Positioning + Time — knowing where you compete and protecting high-leverage time means some problems simply miss you.',
    iconKey: 'engines',
  },
  lifesupport: {
    label: 'CREW',
    game: 'Keeps all systems performing at full capacity. Neglect this and everything costs more.',
    framework: 'People + Systems — the ceiling of your team determines how effectively every other lever operates.',
    iconKey: 'lifesupport',
  },
  communications: {
    label: 'COMMS',
    game: 'Generates reach and occasionally produces allied assistance.',
    framework: 'Network Effects + Habit Design — each customer makes the next one more likely.',
    iconKey: 'communications',
  },
};

const SYSTEM_ICONS = {
  sensors: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--cream-dim)">
    <circle cx="12" cy="12" r="2" fill="currentColor"/>
    <circle cx="12" cy="12" r="6" opacity="0.6"/>
    <circle cx="12" cy="12" r="10" opacity="0.3"/>
    <line x1="12" y1="2" x2="12" y2="5"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="2" y1="12" x2="5" y2="12"/>
    <line x1="19" y1="12" x2="22" y2="12"/>
  </svg>`,
  shields: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--cream-dim)">
    <path d="M12 2 L20 6 L20 13 C20 17.4 16.4 21 12 22 C7.6 21 4 17.4 4 13 L4 6 Z"/>
    <path d="M12 6 L16 8 L16 13 C16 15.2 14.2 17 12 17.6 C9.8 17 8 15.2 8 13 L8 8 Z" opacity="0.5"/>
  </svg>`,
  weapons: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--cream-dim)">
    <line x1="12" y1="22" x2="12" y2="8"/>
    <path d="M8 12 L12 2 L16 12"/>
    <line x1="6" y1="18" x2="18" y2="18"/>
    <line x1="4" y1="22" x2="8" y2="18"/>
    <line x1="20" y1="22" x2="16" y2="18"/>
  </svg>`,
  engines: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--cream-dim)">
    <ellipse cx="12" cy="10" rx="6" ry="8"/>
    <path d="M8 16 L6 22" opacity="0.6"/>
    <path d="M16 16 L18 22" opacity="0.6"/>
    <path d="M10 18 L10 22" opacity="0.4"/>
    <path d="M14 18 L14 22" opacity="0.4"/>
    <circle cx="12" cy="9" r="2" fill="currentColor" opacity="0.4"/>
  </svg>`,
  lifesupport: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--cream-dim)">
    <circle cx="12" cy="8" r="4"/>
    <path d="M6 20 C6 16.7 8.7 14 12 14 C15.3 14 18 16.7 18 20"/>
    <line x1="9" y1="20" x2="15" y2="20"/>
    <line x1="12" y1="17" x2="12" y2="23"/>
  </svg>`,
  communications: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--cream-dim)">
    <line x1="12" y1="22" x2="12" y2="12"/>
    <path d="M5 15 C5 10 8 7 12 7 C16 7 19 10 19 15" opacity="0.9"/>
    <path d="M2 18 C2 9 6.5 4 12 4 C17.5 4 22 9 22 18" opacity="0.5"/>
    <circle cx="12" cy="22" r="1.5" fill="currentColor"/>
  </svg>`,
};

// Internal state
let systems = {};
let adjustmentsUsed = 0;
let lockedSystems = new Set();
let activePopup = null;

export function initLevers(missionNumber) {
  // Set starting values from config
  systems = { ...CONFIG.power.startingAllocation };

  // Lock systems not yet unlocked
  lockedSystems = new Set();
  Object.entries(CONFIG.progression.systemUnlockSchedule).forEach(
    ([sys, unlockAt]) => {
      if (missionNumber < unlockAt) {
        lockedSystems.add(sys);
        systems[sys] = 0;
      }
    }
  );

  adjustmentsUsed = 0;
  renderPanel();
  updateShipVisuals(systems);
  updateBudgetBar();
  updateAdjustmentDots();
}

export function allocatePower(system, direction) {
  // direction: 'up' | 'down'
  if (lockedSystems.has(system)) return false;
  if (adjustmentsUsed >= CONFIG.power.adjustmentsPerTurn) return false;
  if (direction === 'up' && getUsedPower() >= CONFIG.power.totalBudget) return false;
  if (direction === 'down' && systems[system] <= 0) return false;

  // Apply change
  systems[system] += direction === 'up' ? 1 : -1;
  systems[system] = Math.max(0, Math.min(10, systems[system]));

  adjustmentsUsed++;

  // Update all visuals immediately
  updateShipVisuals(systems);
  updateBudgetBar();
  updateAdjustmentDots();
  updateSystemCell(system);
  updateNeglectStates();

  // Play system tone (lazy import to avoid circular deps)
  import('./audio.js').then(a => a.playSystemTone(system)).catch(() => {});

  // Haptic
  import('./audio.js').then(a => a.hapticTap()).catch(() => {});

  // Lock plus buttons if budget exhausted
  if (getUsedPower() >= CONFIG.power.totalBudget) {
    disableAllPlusButtons();
  }

  // Lock all if adjustments exhausted
  if (adjustmentsUsed >= CONFIG.power.adjustmentsPerTurn) {
    disableAllButtons();
    document.getElementById('btn-go')?.classList.add('pulse');
  }

  return true;
}

export function getSystemValues() {
  return { ...systems };
}

export function setSystemValues(newValues) {
  systems = { ...newValues };
  renderPanel();
  updateShipVisuals(systems);
  updateBudgetBar();
}

export function resetAdjustments() {
  adjustmentsUsed = 0;
  updateAdjustmentDots();
  enableAllButtons();
  document.getElementById('btn-go')?.classList.remove('pulse');
}

export function unlockSystem(systemName) {
  lockedSystems.delete(systemName);
  // Distribute power from budget to new system
  systems[systemName] = 3;
  renderPanel();
  updateShipVisuals(systems);
  updateBudgetBar();
}

export function applyPassiveRegeneration() {
  // Called between turns from game.js
  Object.keys(systems).forEach(sys => {
    if (!lockedSystems.has(sys)) {
      const target = CONFIG.power.startingAllocation[sys] || 0;
      if (systems[sys] < target) {
        systems[sys] = Math.min(
          target,
          systems[sys] + CONFIG.power.regenerationRate
        );
      }
    }
  });
  updateShipVisuals(systems);
  updateBudgetBar();
}

// ── INTERNAL RENDERING ──

function renderPanel() {
  const grid = document.getElementById('systems-grid');
  if (!grid) return;
  grid.innerHTML = '';

  Object.entries(SYSTEM_DEFS).forEach(([key, def]) => {
    const isLocked = lockedSystems.has(key);
    const cell = document.createElement('div');
    cell.className = `system-cell${isLocked ? ' locked' : ''}`;
    cell.id = `cell-${key}`;

    if (isLocked) {
      cell.innerHTML = `
        <div class="system-icon" style="opacity:0.3">
          ${SYSTEM_ICONS[def.iconKey]}
        </div>
        <span class="system-label" style="opacity:0.3">
          ${def.label}
        </span>
        <span class="system-value" style="opacity:0.3">—</span>
      `;
    } else {
      cell.innerHTML = `
        <button class="btn-info" data-system="${key}"
                aria-label="Info: ${def.label}">i</button>
        <div class="system-icon">${SYSTEM_ICONS[def.iconKey]}</div>
        <span class="system-label">${def.label}</span>
        <span class="system-value" id="val-sys-${key}">
          ${systems[key]}
        </span>
        <div class="system-controls">
          <button class="btn-power btn-minus"
                  data-system="${key}" data-dir="down"
                  aria-label="Decrease ${def.label}">−</button>
          <button class="btn-power btn-plus"
                  data-system="${key}" data-dir="up"
                  aria-label="Increase ${def.label}">+</button>
        </div>
      `;
    }

    grid.appendChild(cell);
  });

  // Wire power buttons
  grid.querySelectorAll('.btn-power').forEach(btn => {
    btn.addEventListener('click', () => {
      const sys = btn.dataset.system;
      const dir = btn.dataset.dir;
      allocatePower(sys, dir);
    });
  });

  // Wire info buttons
  grid.querySelectorAll('.btn-info').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showInfoPopup(btn.dataset.system, btn);
    });
  });

  // Close popup on outside tap
  document.addEventListener('click', closeInfoPopup);
}

function updateSystemCell(system) {
  const valEl = document.getElementById(`val-sys-${system}`);
  if (valEl) valEl.textContent = systems[system];
}

function updateNeglectStates() {
  Object.keys(systems).forEach(sys => {
    const cell = document.getElementById(`cell-${sys}`);
    if (!cell) return;
    if (systems[sys] <= 3 && !lockedSystems.has(sys)) {
      cell.classList.add('neglected');
    } else {
      cell.classList.remove('neglected');
    }
  });
}

function updateBudgetBar() {
  const used  = getUsedPower();
  const total = CONFIG.power.totalBudget;
  const pct   = (used / total) * 100;
  const fill  = document.getElementById('budget-fill');
  const val   = document.getElementById('budget-value');
  if (fill) fill.style.width = `${pct}%`;
  if (val)  val.textContent  = total - used;
}

function updateAdjustmentDots() {
  for (let i = 1; i <= CONFIG.power.adjustmentsPerTurn; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (dot) {
      dot.classList.toggle('used', i <= adjustmentsUsed);
    }
  }
}

function getUsedPower() {
  return Object.values(systems).reduce((sum, v) => sum + v, 0);
}

function disableAllPlusButtons() {
  document.querySelectorAll('.btn-plus').forEach(b => b.disabled = true);
}

function disableAllButtons() {
  document.querySelectorAll('.btn-power').forEach(b => b.disabled = true);
}

function enableAllButtons() {
  document.querySelectorAll('.btn-power').forEach(b => {
    b.disabled = false;
  });
}

function showInfoPopup(system, anchor) {
  closeInfoPopup();
  const def = SYSTEM_DEFS[system];
  if (!def) return;

  const popup = document.createElement('div');
  popup.className = 'info-popup visible';
  popup.id = 'active-info-popup';
  popup.innerHTML = `
    <div class="info-popup-title">${def.label}</div>
    <div class="info-popup-game">${def.game}</div>
    <div class="info-popup-framework">${def.framework}</div>
  `;

  // Position above the anchor
  document.body.appendChild(popup);
  const rect = anchor.getBoundingClientRect();
  const popupW = 240;
  let left = rect.left + rect.width / 2 - popupW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popupW - 8));
  popup.style.left = `${left}px`;
  popup.style.top  = `${rect.top - popup.offsetHeight - 8}px`;

  activePopup = popup;
}

function closeInfoPopup() {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}
