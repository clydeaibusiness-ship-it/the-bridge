import { CONFIG } from '/config.js';

// ============================================================
// SHIP.JS — Owns the ship SVG and all visual updates.
// Only exports: initShip, updateShipVisuals, animate* functions
// Called on every power tap. Never called with game logic inside.
// ============================================================

const SHIP_SVG = `
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 120 180" id="enterprise"
     style="width:100%;height:100%;overflow:visible">
  <defs>
    <filter id="glow-soft">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="glow-strong">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="engine-trail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c8b89a" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#c8b89a" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="cockpit-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#d4a855" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#c8b89a" stop-opacity="0.3"/>
    </radialGradient>
  </defs>

  <!-- ENGINE TRAIL -->
  <rect id="zone-engines-trail"
        x="44" y="148" width="32" height="10"
        fill="url(#engine-trail)" opacity="0.4"/>

  <!-- MAIN HULL -->
  <path d="M60,8 L88,80 L76,148 L60,158 L44,148 L32,80 Z"
        fill="#e8e0d0" stroke="#c8b89a" stroke-width="0.5"/>

  <!-- CENTER SPINE -->
  <line x1="60" y1="12" x2="60" y2="155"
        stroke="#c8b89a" stroke-width="0.4" opacity="0.3"/>

  <!-- WEAPONS WINGS -->
  <path id="zone-weapons-left"
        d="M32,80 L8,100 L20,108 L44,92 Z"
        fill="#f5f0e8" opacity="0.1"
        filter="url(#glow-soft)"/>
  <path id="zone-weapons-right"
        d="M88,80 L112,100 L100,108 L76,92 Z"
        fill="#f5f0e8" opacity="0.1"
        filter="url(#glow-soft)"/>

  <!-- WEAPONS TARGETING LINES -->
  <line id="zone-weapons-target-left"
        x1="8" y1="100" x2="8" y2="20"
        stroke="#c8b89a" stroke-width="0.5" opacity="0"/>
  <line id="zone-weapons-target-right"
        x1="112" y1="100" x2="112" y2="20"
        stroke="#c8b89a" stroke-width="0.5" opacity="0"/>

  <!-- ENGINES REAR BODY -->
  <path id="zone-engines-body"
        d="M44,148 L60,158 L76,148 L80,168 L60,178 L40,168 Z"
        fill="#c8b89a" opacity="0.2"/>

  <!-- COMMUNICATIONS ANTENNAS -->
  <line id="zone-comms-left"
        x1="44" y1="148" x2="28" y2="162"
        stroke="#c8b89a" stroke-width="1.5"
        stroke-linecap="round" opacity="0.1"/>
  <line id="zone-comms-right"
        x1="76" y1="148" x2="92" y2="162"
        stroke="#c8b89a" stroke-width="1.5"
        stroke-linecap="round" opacity="0.1"/>

  <!-- LIFE SUPPORT COCKPIT -->
  <ellipse id="zone-lifesupport"
           cx="60" cy="88" rx="10" ry="14"
           fill="url(#cockpit-glow)" opacity="0.1"
           filter="url(#glow-soft)"/>

  <!-- SENSORS NOSE -->
  <path id="zone-sensors"
        d="M60,8 L68,28 L52,28 Z"
        fill="#f5f0e8" opacity="0.2"
        filter="url(#glow-strong)"/>

  <!-- SHIELD RING -->
  <circle id="zone-shields"
          cx="60" cy="90" r="72"
          fill="none" stroke="#c8b89a"
          stroke-width="0.5" opacity="0.05"
          filter="url(#glow-soft)"/>
</svg>`;

export function initShip(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = SHIP_SVG;

  // Idle animation — ship breathes gently
  const ship = document.getElementById('enterprise');
  if (ship) {
    ship.style.animation =
      'ship-idle 3s cubic-bezier(0.4,0,0.2,1) infinite alternate';
  }
}

// Called on every power tap. Updates ship visual instantly.
export function updateShipVisuals(systems) {
  const p = (val) => val / 10; // power ratio 0-1
  const o = CONFIG.ship.opacity;
  const lerp = (min, max, ratio) => min + (max - min) * ratio;

  // Sensors
  setOpacity('zone-sensors',
    lerp(o.sensorsMin, o.sensorsMax, p(systems.sensors)));

  // Weapons — wings
  const wOpacity = lerp(o.weaponsMin, o.weaponsMax, p(systems.weapons));
  setOpacity('zone-weapons-left', wOpacity);
  setOpacity('zone-weapons-right', wOpacity);
  // Targeting lines — appear above threshold
  const targetOpacity = p(systems.weapons) > o.weaponsTargetAt
    ? (p(systems.weapons) - o.weaponsTargetAt) /
      (1 - o.weaponsTargetAt)
    : 0;
  setOpacity('zone-weapons-target-left', targetOpacity);
  setOpacity('zone-weapons-target-right', targetOpacity);

  // Shields — ring thickness and opacity
  const sEl = document.getElementById('zone-shields');
  if (sEl) {
    sEl.style.opacity =
      lerp(o.shieldsMin, o.shieldsMax, p(systems.shields));
    sEl.style.strokeWidth =
      lerp(
        CONFIG.ship.shieldRing.strokeWidthMin,
        CONFIG.ship.shieldRing.strokeWidthMax,
        p(systems.shields)
      );
  }

  // Engines — trail and body
  const trailEl = document.getElementById('zone-engines-trail');
  if (trailEl) {
    const trailHeight = lerp(
      CONFIG.ship.engineTrail.minHeight,
      CONFIG.ship.engineTrail.maxHeight,
      p(systems.engines)
    );
    trailEl.setAttribute('height', trailHeight);
    trailEl.setAttribute('y', 148 - (trailHeight - 10));
  }
  setOpacity('zone-engines-body',
    lerp(o.enginesMin, o.enginesMax, p(systems.engines)));

  // Life Support — cockpit warmth
  setOpacity('zone-lifesupport',
    lerp(o.lifesupportMin, o.lifesupportMax, p(systems.lifesupport)));

  // Communications — antennas
  const cOpacity =
    lerp(o.commsMin, o.commsMax, p(systems.communications));
  setOpacity('zone-comms-left', cOpacity);
  setOpacity('zone-comms-right', cOpacity);
}

function setOpacity(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.opacity = Math.max(0, Math.min(1, value));
}

// Resolution animations — called by game.js after GO
export function animateWeapons(onComplete) {
  const svg = document.getElementById('enterprise');
  if (!svg) { onComplete?.(); return; }

  const beam = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  beam.setAttribute('x1', '60');
  beam.setAttribute('y1', '8');
  beam.setAttribute('x2', '60');
  beam.setAttribute('y2', '-200');
  beam.setAttribute('stroke', '#f0ebe0');
  beam.setAttribute('stroke-width', '1.5');
  beam.setAttribute('opacity', '0.9');
  svg.appendChild(beam);

  setTimeout(() => {
    beam.style.transition = 'opacity 0.2s';
    beam.style.opacity = '0';
    setTimeout(() => { beam.remove(); onComplete?.(); }, 200);
  }, 150);
}

export function animateShields(onComplete) {
  const ring = document.getElementById('zone-shields');
  if (!ring) { onComplete?.(); return; }

  const originalOpacity = ring.style.opacity;
  ring.style.transition = 'opacity 0.1s, stroke-width 0.1s';
  ring.style.opacity = '1';
  ring.style.strokeWidth = '4';

  setTimeout(() => {
    ring.style.opacity = originalOpacity;
    ring.style.strokeWidth =
      CONFIG.ship.shieldRing.strokeWidthMin.toString();
    setTimeout(() => { onComplete?.(); },
      CONFIG.timing.stateChange);
  }, 200);
}

export function animateEngines(direction, onComplete) {
  const container = document.getElementById('ship-container');
  if (!container) { onComplete?.(); return; }

  const dist = CONFIG.ship.slideDistance;
  const dur  = CONFIG.ship.slideDuration;
  const sign = direction === 'left' ? -1 : 1;

  container.style.transition = `transform ${dur}ms var(--ease-smooth)`;
  container.style.transform =
    `translateX(calc(-50% + ${sign * dist}px))`;

  setTimeout(() => {
    container.style.transform = 'translateX(-50%)';
    setTimeout(() => { onComplete?.(); }, dur);
  }, dur);
}

export function animateShipHit() {
  const container = document.getElementById('ship-container');
  if (!container) return;
  container.style.animation = 'ship-hit 0.3s var(--ease-quick)';
  setTimeout(() => { container.style.animation = ''; }, 300);
}

export function animateShipFlash() {
  const container = document.getElementById('ship-container');
  if (!container) return;
  const flash = document.createElement('div');
  flash.style.cssText = `
    position:absolute;inset:0;
    background:white;opacity:1;
    pointer-events:none;z-index:10;
    border-radius:2px;
  `;
  container.appendChild(flash);
  setTimeout(() => {
    flash.style.transition =
      `opacity ${CONFIG.timing.shipFlash}ms var(--ease-smooth)`;
    flash.style.opacity = '0';
    setTimeout(() => flash.remove(), CONFIG.timing.shipFlash);
  }, CONFIG.timing.shipFlashPeak);
}

export function animateShipDestroyed(onComplete) {
  const container = document.getElementById('ship-container');
  if (!container) { onComplete?.(); return; }
  container.style.transition = 'opacity 1.5s var(--ease-smooth)';
  container.style.opacity = '0';

  // Fragment burst from center
  spawnDestructionFragments(
    window.innerWidth / 2,
    window.innerHeight * 0.4,
    16
  );

  setTimeout(() => { onComplete?.(); }, 1600);
}

function spawnDestructionFragments(x, y, count) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist  = Math.random() * 80 + 30;
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
      duration: 600,
      easing: 'cubic-bezier(0.2,0,0.4,1)',
      fill: 'forwards',
    }).onfinish = () => frag.remove();
  }
}
