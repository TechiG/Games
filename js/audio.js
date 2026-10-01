// Effets sonores synthétisés (aucun fichier audio à charger).
let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('tumblerush.muted') === '1'; } catch { /* */ }

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.28;
    master.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

function tone(freq, freq2, dur, type = 'sine', vol = 0.5, delay = 0) {
  if (!ensure() || muted) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (freq2 !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.4, delay = 0) {
  if (!ensure() || muted) return;
  const t0 = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource();
  const g = ctx.createGain();
  s.buffer = buf; g.gain.value = vol;
  s.connect(g); g.connect(master); s.start(t0);
}

export const sfx = {
  unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); },
  isMuted: () => muted,
  setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('tumblerush.muted', muted ? '1' : '0'); } catch { /* */ }
    if (master) master.gain.value = muted ? 0 : 0.28;
  },
  play(name) {
    switch (name) {
      case 'jump': tone(280, 560, 0.12, 'square', 0.22); break;
      case 'land': tone(140, 60, 0.09, 'sine', 0.35); break;
      case 'bounce': tone(200, 900, 0.25, 'triangle', 0.4); break;
      case 'pickup': tone(660, 660, 0.08, 'triangle', 0.35); tone(880, 880, 0.08, 'triangle', 0.35, 0.07); tone(1320, 1320, 0.14, 'triangle', 0.35, 0.14); break;
      case 'fall': tone(520, 70, 0.7, 'sine', 0.4); break;
      case 'respawn': tone(300, 900, 0.3, 'triangle', 0.3); break;
      case 'power': noise(0.25, 0.35); tone(200, 700, 0.3, 'sawtooth', 0.25); break;
      case 'hit': tone(220, 50, 0.25, 'sawtooth', 0.4); noise(0.12, 0.3); break;
      case 'shield': tone(500, 800, 0.2, 'sine', 0.3); tone(800, 500, 0.2, 'sine', 0.3, 0.12); break;
      case 'beep': tone(520, 520, 0.18, 'square', 0.25); break;
      case 'go': tone(880, 880, 0.4, 'square', 0.28); break;
      case 'warn': tone(440, 440, 0.12, 'square', 0.22); tone(330, 330, 0.18, 'square', 0.22, 0.14); break;
      case 'check': tone(523, 523, 0.1, 'triangle', 0.35); tone(659, 659, 0.1, 'triangle', 0.35, 0.09); tone(784, 784, 0.1, 'triangle', 0.35, 0.18); tone(1047, 1047, 0.25, 'triangle', 0.35, 0.27); break;
      case 'out': tone(400, 100, 0.5, 'sawtooth', 0.3); tone(300, 60, 0.6, 'sawtooth', 0.3, 0.3); break;
      case 'meteor': tone(900, 60, 0.45, 'sawtooth', 0.15); break;
      default: break;
    }
  },
  impact() { noise(0.35, 0.5); tone(90, 40, 0.3, 'sine', 0.5); },
};
