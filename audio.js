/**
 * Gentle optional WebAudio chimes (default off, zero external audio files).
 * Never uses harsh buzzers on wrong answers.
 */

let audioCtx = null;

function getCtx() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq, durationSec, startOffsetSec = 0, gainPeak = 0.08) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.02);
}

export function playCorrectChime(enabled) {
  if (!enabled) return;
  playTone(523.25, 0.14, 0, 0.07); // C5
  playTone(659.25, 0.2, 0.08, 0.07); // E5
}

export function playGentleHint(enabled) {
  if (!enabled) return;
  playTone(392.0, 0.18, 0, 0.05); // soft G4
}

export function playSessionCompleteChime(enabled) {
  if (!enabled) return;
  playTone(523.25, 0.16, 0, 0.07);
  playTone(659.25, 0.16, 0.1, 0.07);
  playTone(783.99, 0.28, 0.2, 0.08);
}
