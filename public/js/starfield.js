import { CONFIG } from '/config.js';

// Color presets
const THEMES = {
  dark: {
    bg: '#08080f',
    wispCenter: 'rgba(46, 42, 64, 0.5)',
    wispEdge: 'rgba(8, 8, 15, 0)',
    starFill: '#2e2a40',
    dustColor: (op) => `rgba(46, 42, 64, ${op})`,
  },
  light: {
    bg: '#f5f0e8',
    wispCenter: 'rgba(180, 172, 160, 0.38)',
    wispEdge: 'rgba(245, 240, 232, 0)',
    starFill: '#b8b0a0',
    dustColor: (op) => `rgba(168, 160, 148, ${op * 1.5 + 0.1})`,
  }
};

/**
 * @param {string} canvasId
 * @param {object} [opts]
 * @param {'dark'|'light'} [opts.theme='dark']
 */
export function renderStarfield(canvasId, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const theme = THEMES[opts.theme] || THEMES.dark;

  // Size canvas to parent or full screen
  canvas.width = canvas.parentElement?.offsetWidth || window.innerWidth;
  canvas.height = canvas.parentElement?.offsetHeight || window.innerHeight;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Base fill
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Wisp formations
  const wisps = [
    { x: W * 0.15, y: H * 0.20, rx: W * 0.30, ry: H * 0.08 },
    { x: W * 0.80, y: H * 0.65, rx: W * 0.35, ry: H * 0.10 },
    { x: W * 0.50, y: H * 0.45, rx: W * 0.20, ry: H * 0.06 },
  ];

  wisps.forEach(w => {
    ctx.save();
    const maxR = Math.max(w.rx, w.ry);
    const scaleX = w.rx / maxR;
    const scaleY = w.ry / maxR;
    ctx.scale(scaleX, scaleY);
    const grad = ctx.createRadialGradient(
      w.x / scaleX, w.y / scaleY, 0,
      w.x / scaleX, w.y / scaleY, maxR
    );
    grad.addColorStop(0, theme.wispCenter);
    grad.addColorStop(1, theme.wispEdge);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(w.x / scaleX, w.y / scaleY, maxR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // Four-pointed star formations
  function drawStar(x, y, size, opacity) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = theme.starFill;
    ctx.beginPath();
    ctx.moveTo(x,          y - size);
    ctx.lineTo(x + size * 0.15, y - size * 0.15);
    ctx.lineTo(x + size,   y);
    ctx.lineTo(x + size * 0.15, y + size * 0.15);
    ctx.lineTo(x,          y + size);
    ctx.lineTo(x - size * 0.15, y + size * 0.15);
    ctx.lineTo(x - size,   y);
    ctx.lineTo(x - size * 0.15, y - size * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawStar(W * 0.12, H * 0.15, 12, 0.9);
  drawStar(W * 0.85, H * 0.70, 14, 0.8);
  drawStar(W * 0.45, H * 0.42,  8, 0.7);
  drawStar(W * 0.22, H * 0.55,  6, 0.6);
  drawStar(W * 0.75, H * 0.28,  5, 0.7);
  drawStar(W * 0.60, H * 0.80,  7, 0.5);

  // Fine dust
  for (let i = 0; i < 70; i++) {
    const x  = Math.random() * W;
    const y  = Math.random() * H;
    const r  = Math.random() * 1.2 + 0.3;
    const op = Math.random() * 0.3 + 0.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = theme.dustColor(op);
    ctx.fill();
  }
}
