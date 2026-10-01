// Événements de course : calendrier déterministe à partir de la graine de la manche.
// Chaque client calcule le même événement au même instant (horloge de manche partagée),
// aucun message réseau n'est nécessaire.
import { mulberry32 } from './rng.js';

export const EVENT_INFO = {
  wind: { icon: '🌪️', name: 'Vent violent', desc: 'Le vent te pousse sur le côté !' },
  meteor: { icon: '☄️', name: 'Pluie de météores', desc: 'Évite les cercles rouges !' },
  ice: { icon: '🧊', name: 'Verglas', desc: 'Tout glisse !' },
  fog: { icon: '🌫️', name: 'Brouillard épais', desc: 'On n’y voit plus rien…' },
  reverse: { icon: '🔄', name: 'Contrôles inversés', desc: 'Gauche ↔ droite, avant ↔ arrière !' },
  quake: { icon: '⚡', name: 'Tremblement de terre', desc: 'Les plateformes s’effondrent plus vite !' },
  heavy: { icon: '🪨', name: 'Gravité lourde', desc: 'Tes sauts sont plus faibles.' },
};

const TYPES = Object.keys(EVENT_INFO);
const FIRST = 22; // 1er événement (s)
const WARN = 3; // préavis (s)
const CYCLE = 28; // un événement toutes les 28 s

function order(seed) {
  const r = mulberry32(seed ^ 0x9e3779b9);
  const a = TYPES.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cache = new Map();

// t = temps de manche (s). Retourne null si aucun événement.
export function eventAt(seed, t) {
  if (t < FIRST) return null;
  const k = Math.floor((t - FIRST) / CYCLE);
  const tt = t - (FIRST + k * CYCLE);
  const dur = 11 + Math.min(5, Math.floor(k / 2));
  if (tt >= WARN + dur) return null;
  let ord = cache.get(seed);
  if (!ord) { ord = order(seed); if (cache.size > 8) cache.clear(); cache.set(seed, ord); }
  const r = mulberry32((seed + k * 7919) >>> 0);
  const ang = r() * Math.PI * 2;
  return {
    k,
    type: ord[k % ord.length],
    phase: tt < WARN ? 'warn' : 'active',
    tLeft: tt < WARN ? WARN - tt : WARN + dur - tt,
    dir: [Math.cos(ang), Math.sin(ang)],
  };
}
