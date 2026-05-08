import { CONFIG } from '/config.js';

// ============================================================
// AUDIO.JS — All Web Audio API sound generation.
// No audio files. All tones generated procedurally.
// Exports: playCleanCounter, playPartialHit, playFullHit,
//          playMissionComplete, playUnlock, playSystemTone,
//          playNoise, playStagnationWarning, haptic*
// ============================================================

let audioCtx = null;

function getCtx() {
  if (!CONFIG.audio.enabled) return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (mobile autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playTone(freq, duration, delay = 0, type = 'sine') {
  const ctx = getCtx();
  if (!ctx) return;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type      = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

  const vol = CONFIG.audio.volume;
  gain.gain.setValueAtTime(0, ctx.currentTime + delay);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.01);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + delay + duration
  );

  osc.start(ctx.currentTime + delay);
  osc.stop(ctx.currentTime + delay + duration + 0.01);
}

function playSequence(tones, startDelay = 0) {
  let t = startDelay;
  tones.forEach(tone => {
    playTone(tone.freq, tone.duration, t, tone.type || 'sine');
    t += tone.duration;
  });
}

export function playCleanCounter() {
  const c = CONFIG.audio.cleanCounter;
  playSequence([c.tone1, c.tone2]);
}

export function playPartialHit() {
  const c = CONFIG.audio.partialHit;
  playTone(c.tone1.freq, c.tone1.duration, 0, 'triangle');
}

export function playFullHit() {
  const c = CONFIG.audio.fullHit;
  playSequence([
    { ...c.tone1, type: 'sawtooth' },
    { ...c.tone2, type: 'sawtooth' },
    { ...c.tone3, type: 'triangle' },
  ]);
}

export function playMissionComplete() {
  const c = CONFIG.audio.missionComplete;
  playSequence([c.tone1, c.tone2, c.tone3, c.tone4]);
}

export function playUnlock() {
  const c = CONFIG.audio.unlock;
  playSequence([c.tone1, c.tone2, c.tone3]);
}

export function playSystemTone(system) {
  const tone = CONFIG.audio.systemTones[system];
  if (!tone) return;
  playTone(tone.freq, tone.duration, 0, 'sine');
}

export function playNoise() {
  const tone = CONFIG.audio.noiseEvent;
  playTone(tone.freq, tone.duration, 0, 'triangle');
}

export function playStagnationWarning() {
  const tone = CONFIG.audio.stagnationWarning;
  playTone(tone.freq, tone.duration, 0, 'sine');
  playTone(tone.freq, tone.duration, tone.duration + 0.1, 'sine');
}

// ── HAPTIC FEEDBACK ──

export function hapticTap() {
  if (navigator.vibrate) navigator.vibrate(10);
}

export function hapticHit() {
  if (navigator.vibrate) navigator.vibrate([30, 10, 20]);
}

export function hapticCleanCounter() {
  if (navigator.vibrate) navigator.vibrate([10, 5, 10]);
}

export function hapticMissionComplete() {
  if (navigator.vibrate) navigator.vibrate([10, 5, 10, 5, 30]);
}

export function hapticUnlock() {
  if (navigator.vibrate) navigator.vibrate([8, 4, 8, 4, 8]);
}
