// Classements : local (appareil) + facultatif mondial via Firebase Realtime Database (REST, gratuit, sans serveur à gérer).
import { CONFIG } from './config.js';

const KEY = 'tumblerush.scores.v1';
const MAX_LOCAL = 100;

export function cleanName(n) {
  return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Joueur';
}

function read() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter((e) => e && typeof e.score === 'number') : [];
  } catch { return []; }
}

export function loadScores() { return read().sort((a, b) => b.score - a.score || a.t - b.t); }

export function addLocalScore(entry) {
  const e = { name: cleanName(entry.name), score: Math.max(0, Math.floor(entry.score)), mode: entry.mode === 'multi' ? 'multi' : 'solo', players: entry.players | 0, t: Date.now() };
  const list = read();
  list.push(e);
  list.sort((a, b) => b.score - a.score || a.t - b.t);
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_LOCAL))); } catch { /* stockage indisponible */ }
  return e;
}

export function personalBest() {
  const l = loadScores();
  return l.length ? l[0].score : 0;
}

/* ---------- classement mondial (facultatif) ---------- */
const base = () => (CONFIG.firebaseUrl || '').replace(/\/+$/, '');
export const globalEnabled = () => !!base();

export async function submitGlobal(e) {
  if (!globalEnabled() || !(e.score > 0)) return false;
  try {
    const res = await fetch(base() + '/scores.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cleanName(e.name), score: Math.floor(e.score), mode: e.mode === 'multi' ? 'multi' : 'solo', t: Date.now() }),
    });
    return res.ok;
  } catch { return false; }
}

export async function fetchGlobal(limit = 50) {
  if (!globalEnabled()) return null;
  const tryUrl = async (q) => {
    const res = await fetch(base() + '/scores.json?' + q);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };
  let data;
  try { data = await tryUrl(`orderBy="score"&limitToLast=${limit}`); }
  catch {
    try { data = await tryUrl('orderBy="$key"&limitToLast=300'); } catch { return null; }
  }
  const list = Object.values(data || {}).filter((e) => e && typeof e.score === 'number').map((e) => ({ name: cleanName(e.name), score: e.score, mode: e.mode, t: e.t || 0 }));
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, limit);
}
