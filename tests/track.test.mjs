// Vérifie que la piste infinie est (1) identique pour tous les joueurs et (2) toujours franchissable.
// Utilisation : node tests/track.test.mjs [nbSeeds] [nbRangs]
import * as THREE from '../vendor/three.module.min.js';
import { Track } from '../js/track.js';
import { LocalPlayer } from '../js/player.js';

const TAU = Math.PI * 2, G = 26;
const seeds = +process.argv[2] || 12;
const rowsN = +process.argv[3] || 200;

function setMove(p, t) {
  if (p.type === 'move') { const nx = p.x + p.amp * Math.sin((TAU * t) / p.per + p.ph); p.dx = nx - p.cx; p.cx = nx; }
  else { p.dx = 0; p.cx = p.x; }
  p.solid = true; p.top = p.y;
}

// Pour chaque point de décollage possible sur A, saute vers B avec un contrôle aérien parfait.
function feasibility(A, B) {
  let ok = 0, total = 0;
  const phases = A.type === 'move' || B.type === 'move' ? [0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9] : [0];
  for (const t0 of phases) for (let u = 0; u <= 10; u++) {
    setMove(A, t0); setMove(B, t0);
    const fx = A.cx - A.w / 2 + 0.3 + ((A.w - 0.6) * u) / 10;
    const L = new LocalPlayer();
    L.reset(new THREE.Vector3(fx, A.y + 0.001, A.z));
    const ctx = { plats: [A, B], fx: { iceAll: false, windX: 0, windZ: 0, gravMul: 1, jumpMul: 1, reverse: false } };
    let t = t0, jumped = false, landed = false;
    ctx.onBounce = (p) => { if (p === B) landed = true; };
    if (A.type === 'bounce') {
      const dxb = B.cx - fx, dzb = B.z - A.z, l = Math.hypot(dxb, dzb) || 1;
      L.vel.set((dxb / l) * 7.5, 16, (dzb / l) * 7.5); L.pos.y = A.y + 0.05; L.grounded = false; jumped = true;
    }
    for (let s = 0; s < 600 && !landed; s++) {
      setMove(A, t); setMove(B, t);
      let mx = 0, mz = 0, jump = false;
      if (!jumped) {
        const dxb = B.cx - L.pos.x, dzb = B.z - L.pos.z, l = Math.hypot(dxb, dzb) || 1;
        mx = dxb / l; mz = dzb / l;
        const sx = mx > 0.01 ? (A.cx + A.w / 2 - L.pos.x) / mx : mx < -0.01 ? (A.cx - A.w / 2 - L.pos.x) / mx : 1e9;
        const sz = mz > 0.01 ? (A.z + A.d / 2 - L.pos.z) / mz : mz < -0.01 ? (A.z - A.d / 2 - L.pos.z) / mz : 1e9;
        if (Math.min(sx, sz) < 0.15 && L.grounded) { jump = true; jumped = true; }
      } else {
        const vy = L.vel.y, dy = L.pos.y - B.y;
        const tl = Math.max(0.05, (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * dy))) / G);
        const ttx = B.type === 'move' ? B.x + B.amp * Math.sin((TAU * (t + tl)) / B.per + B.ph) : B.x;
        const vx = (ttx - L.pos.x) / tl, vz = (B.z - L.pos.z) / tl;
        const l2 = Math.hypot(vx, vz), k = l2 > 7.5 ? 7.5 / l2 : 1;
        mx = (vx * k) / 7.5; mz = (vz * k) / 7.5;
      }
      L.update(1 / 60, { mx, mz, jump, jumpHeld: true, dive: false, descend: false }, ctx);
      t += 1 / 60;
      if (jumped && L.grounded && L.standing === B) landed = true;
      if (jumped && L.pos.y < Math.min(A.y, B.y) - 6) break;
    }
    total++; if (landed) ok++;
  }
  return ok / total;
}

let failures = 0, transitions = 0, worst = 1;
for (let s = 1; s <= seeds; s++) {
  const a = new Track(s * 7919), b = new Track(s * 7919);
  a.row(rowsN + 1); b.row(rowsN + 1);
  if (JSON.stringify(a.rows.map((r) => r.plats.map((p) => [p.x, p.y, p.z, p.w, p.d, p.type])))
    !== JSON.stringify(b.rows.map((r) => r.plats.map((p) => [p.x, p.y, p.z, p.w, p.d, p.type])))) {
    console.error('✗ piste non déterministe, graine', s); failures++;
  }
  for (let i = 1; i <= rowsN; i++) {
    const f = feasibility(a.rows[i - 1].main, a.rows[i].main);
    transitions++; worst = Math.min(worst, f);
    if (f === 0) { failures++; console.error(`✗ transition impossible : graine ${s * 7919}, rang ${i} (${a.rows[i - 1].main.type} → ${a.rows[i].main.type})`); }
  }
}
console.log(`${transitions} transitions testées, plus mauvais taux de réussite : ${(worst * 100).toFixed(0)} %`);
if (failures) { console.error(failures + ' échec(s)'); process.exit(1); }
console.log('✓ pistes déterministes et franchissables');
