import { CONFIG } from '/config.js';

// ============================================================
// THREATS.JS — Threat generation, rendering, movement.
// Exports: initThreats, spawnThreat, advanceThreat, getThreatState,
//          clearThreats, destroyThreat, spawnNoise, advanceNoise,
//          checkNoiseCollision, releaseThreat
// ============================================================

let threatData   = null;
let activeThreat = null;
let noiseEvents  = [];
let canvas       = null;
let ctx          = null;

export async function initThreats(canvasEl) {
  canvas = canvasEl;
  ctx    = canvas.getContext('2d');

  // Load threat templates
  const res  = await fetch('/data/threats.json');
  threatData = await res.json();
}

export function spawnThreat(missionNumber, forceId = null) {
  if (!threatData) return null;

  // Select template
  const eligible = threatData.templates;
  const template = forceId
    ? eligible.find(t => t.id === forceId)
    : eligible[Math.floor(Math.random() * eligible.length)];

  if (!template) return null;

  // Fill variables
  const description = fillTemplate(
    template.template,
    template.variables
  );

  // Random strength within range
  const [min, max] = template.strengthRange;
  const strength   =
    Math.floor(Math.random() * (max - min + 1)) + min;

  activeThreat = {
    id:          template.id,
    system:      template.system,
    strength,
    statDamage:  template.statDamage,
    shape:       template.threatShape,
    description,
    diagnosis:   template.diagnosisTemplate,
    caseStudyId: template.caseStudyId,
    // Position
    x: canvas.width / 2,
    y: -40,
    targetY: canvas.height * CONFIG.threats.holdAtPercent,
    held: false,
    destroyed: false,
  };

  return activeThreat;
}

export function advanceThreat() {
  if (!activeThreat || activeThreat.held || activeThreat.destroyed)
    return;

  activeThreat.y += CONFIG.threats.driftSpeed * 2;

  if (activeThreat.y >= activeThreat.targetY) {
    activeThreat.y   = activeThreat.targetY;
    activeThreat.held = true;
  }

  renderThreats();
}

export function releaseThreat() {
  if (activeThreat) activeThreat.held = false;
}

export function getThreatState() {
  return activeThreat;
}

export function clearThreats() {
  activeThreat = null;
  noiseEvents  = [];
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function destroyThreat() {
  if (activeThreat) activeThreat.destroyed = true;
  setTimeout(() => {
    activeThreat = null;
    renderThreats();
  }, 400);
}

export function spawnNoise() {
  if (!threatData) return;
  const templates = threatData.noiseEvents;
  const template  =
    templates[Math.floor(Math.random() * templates.length)];

  const side = template.approach === 'random'
    ? (Math.random() > 0.5 ? 'left' : 'right')
    : template.approach;

  const noise = {
    id:    template.id,
    label: template.label,
    x:     side === 'left' ? -20
         : side === 'right' ? canvas.width + 20
         : Math.random() * canvas.width,
    y:     side === 'top' ? -20
         : Math.random() * canvas.height * 0.4,
    vx:    side === 'left' ? 1.5
         : side === 'right' ? -1.5
         : (Math.random() - 0.5) * 1,
    vy:    side === 'top' ? 1.2 : 0.8,
    size:  template.shape === 'wide' ? 28 : 16,
  };

  noiseEvents.push(noise);
}

export function advanceNoise() {
  noiseEvents = noiseEvents.filter(n => {
    n.x += n.vx;
    n.y += n.vy;
    // Remove if off screen
    return n.x > -50 && n.x < canvas.width + 50 &&
           n.y < canvas.height + 50;
  });
  renderThreats();
}

export function checkNoiseCollision(shipX) {
  // shipX: 'left' | 'center' | 'right'
  const zones = {
    left:   [0, canvas.width * 0.33],
    center: [canvas.width * 0.33, canvas.width * 0.67],
    right:  [canvas.width * 0.67, canvas.width],
  };
  const [zMin, zMax] = zones[shipX];

  return noiseEvents.some(n =>
    n.x >= zMin && n.x <= zMax &&
    n.y >= canvas.height * 0.55 &&
    n.y <= canvas.height * 0.75
  );
}

// ── RENDERING ──

function renderThreats() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (activeThreat && !activeThreat.destroyed) {
    drawThreat(activeThreat);
  }

  noiseEvents.forEach(n => drawNoise(n));
}

function drawThreat(threat) {
  ctx.save();
  ctx.translate(threat.x, threat.y);

  // Shape
  switch (threat.shape) {
    case 'precise':
      drawPrecise(ctx);
      break;
    case 'direct':
      drawDirect(ctx);
      break;
    case 'diffuse':
      drawDiffuse(ctx);
      break;
    default:
      drawDirect(ctx);
  }

  // Strength dots
  drawStrengthDots(ctx, threat.strength);

  // System indicator
  drawSystemIndicator(ctx, threat.system);

  // Description label
  ctx.font = `bold 10px 'Space Mono', monospace`;
  ctx.fillStyle = 'rgba(176, 144, 120, 0.9)';
  ctx.textAlign = 'center';
  const maxWidth = canvas.width * 0.7;
  ctx.fillText(threat.description.substring(0, 45), 0, 40, maxWidth);
  if (threat.description.length > 45) {
    ctx.fillText(threat.description.substring(45, 90), 0, 52, maxWidth);
  }

  ctx.restore();
}

function drawPrecise(ctx) {
  // Thin dart — Positioning/Weapons threats
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(5, 10);
  ctx.lineTo(0, 6);
  ctx.lineTo(-5, 10);
  ctx.closePath();
  ctx.fillStyle = 'rgba(107, 42, 42, 0.85)';
  ctx.fill();
  ctx.strokeStyle = '#9a5050';
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawDirect(ctx) {
  // Forward-pointing form — Capital/Shields threats
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(14, 8);
  ctx.lineTo(6, 4);
  ctx.lineTo(8, 20);
  ctx.lineTo(0, 12);
  ctx.lineTo(-8, 20);
  ctx.lineTo(-6, 4);
  ctx.lineTo(-14, 8);
  ctx.closePath();
  ctx.fillStyle = 'rgba(107, 42, 42, 0.75)';
  ctx.fill();
  ctx.strokeStyle = '#8a3a3a';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawDiffuse(ctx) {
  // Irregular blob — People/Systems threats
  ctx.beginPath();
  const pts = 8;
  for (let i = 0; i < pts; i++) {
    const angle = (i / pts) * Math.PI * 2;
    const r = 14 + Math.sin(i * 2.3 + 1) * 6;
    if (i === 0) ctx.moveTo(Math.cos(angle)*r, Math.sin(angle)*r);
    else         ctx.lineTo(Math.cos(angle)*r, Math.sin(angle)*r);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(107, 42, 42, 0.65)';
  ctx.fill();
  ctx.strokeStyle = '#8a3a3a';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawStrengthDots(ctx, strength) {
  for (let i = 0; i < strength; i++) {
    ctx.beginPath();
    ctx.arc(
      -((strength - 1) * 5) + (i * 10),
      30, 2.5, 0, Math.PI * 2
    );
    ctx.fillStyle = '#8a3a3a';
    ctx.fill();
  }
}

function drawSystemIndicator(ctx, system) {
  const indicators = {
    sensors:        () => { ctx.beginPath(); ctx.arc(22, -22, 4, 0, Math.PI*2); ctx.strokeStyle='#9a7a5a'; ctx.lineWidth=1; ctx.stroke(); },
    shields:        () => { ctx.beginPath(); ctx.moveTo(22,-26); ctx.lineTo(26,-16); ctx.lineTo(18,-16); ctx.closePath(); ctx.strokeStyle='#9a7a5a'; ctx.lineWidth=1; ctx.stroke(); },
    weapons:        () => { ctx.beginPath(); ctx.moveTo(22,-26); ctx.lineTo(22,-16); ctx.moveTo(19,-20); ctx.lineTo(25,-20); ctx.strokeStyle='#9a7a5a'; ctx.lineWidth=1; ctx.stroke(); },
    engines:        () => { ctx.beginPath(); ctx.arc(22,-22,3,0,Math.PI*2); ctx.fillStyle='rgba(154,122,90,0.4)'; ctx.fill(); },
    lifesupport:    () => { ctx.beginPath(); ctx.arc(22,-26,3,0,Math.PI*2); ctx.moveTo(19,-22); ctx.lineTo(25,-22); ctx.strokeStyle='#9a7a5a'; ctx.lineWidth=1; ctx.stroke(); },
    communications: () => { ctx.beginPath(); ctx.arc(22,-18,5,Math.PI,0); ctx.arc(22,-18,8,Math.PI,0); ctx.strokeStyle='#9a7a5a'; ctx.lineWidth=1; ctx.stroke(); },
  };
  if (indicators[system]) indicators[system]();
}

function drawNoise(noise) {
  ctx.save();
  ctx.translate(noise.x, noise.y);
  ctx.globalAlpha = 0.6;

  // Irregular fragment shape
  ctx.beginPath();
  ctx.moveTo(0, -noise.size * 0.6);
  ctx.lineTo(noise.size * 0.4, -noise.size * 0.2);
  ctx.lineTo(noise.size * 0.5, noise.size * 0.3);
  ctx.lineTo(-noise.size * 0.1, noise.size * 0.5);
  ctx.lineTo(-noise.size * 0.4, noise.size * 0.1);
  ctx.closePath();
  ctx.fillStyle = 'rgba(100, 94, 80, 0.5)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(176, 167, 140, 0.4)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // Label
  ctx.font = `8px 'Space Mono', monospace`;
  ctx.fillStyle = 'rgba(176, 167, 140, 0.6)';
  ctx.textAlign = 'center';
  ctx.fillText(noise.label, 0, noise.size + 8);

  ctx.restore();
}

// ── UTILITIES ──

function fillTemplate(template, variables) {
  let result = template;
  Object.entries(variables).forEach(([key, options]) => {
    const value = options[Math.floor(Math.random() * options.length)];
    result = result.replace(`{${key}}`, value);
  });
  return result;
}
