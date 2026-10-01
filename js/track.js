// Générateur de piste infinie et déterministe.
// Convention : on avance vers -Z. `y` d'une plateforme = hauteur de sa surface.
// Seules les opérations IEEE exactes (+ - * / sqrt) sont utilisées pour que
// tous les navigateurs obtiennent exactement la même piste à partir de la même graine.
import { mulberry32, lerp } from './rng.js';

export const CHECK_EVERY = 25; // un checkpoint tous les 25 rangs
export const PLAT_H = 0.8; // épaisseur visuelle/collision

export class Track {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.rows = [];
    this._gen(0);
  }

  row(i) {
    while (this.rows.length <= i) this._gen(this.rows.length);
    return this.rows[i];
  }

  // Index du rang le plus proche de z, en partant d'un indice de départ (recherche incrémentale).
  rowAtZ(z, hint = 0) {
    let i = Math.max(0, Math.min(hint, this.rows.length - 1));
    for (;;) {
      const a = this.row(i);
      const b = this.row(i + 1);
      const boundary = (a.zMin + b.zMax) / 2;
      if (z < boundary) i++;
      else break;
    }
    while (i > 0) {
      const prev = this.row(i - 1);
      const cur = this.row(i);
      const boundary = (prev.zMin + cur.zMax) / 2;
      if (z > boundary) i--;
      else break;
    }
    return i;
  }

  platformById(id) {
    const [ri, k] = id.split('.');
    const row = this.row(parseInt(ri, 10));
    return row.plats[parseInt(k, 10)] || null;
  }

  _gen(i) {
    const R = this.rng;
    const prev = i > 0 ? this.rows[i - 1] : null;
    const d = Math.min(1, i / 160); // difficulté 0..1
    const row = { i, plats: [], pickups: [], bar: null, z: 0, y: 0, zMin: 0, zMax: 0 };

    if (i === 0) {
      const p = this._plat(row, 0, { x: 0, y: 0, z: 0, w: 16, d: 16, type: 'start', main: true });
      row.z = 0; row.y = 0; row.zMax = 8; row.zMin = -8; row.main = p;
      this.rows.push(row);
      return;
    }

    const pm = prev.main;
    const isCheck = i % CHECK_EVERY === 0;
    let type = 'solid';
    let w, dp;
    if (isCheck) {
      type = 'check'; w = 12; dp = 9;
    } else {
      w = lerp(6.8, 2.9, d) * (0.85 + 0.3 * R());
      dp = lerp(5.8, 2.7, d) * (0.85 + 0.3 * R());
      type = this._pickType(i, d, R, pm);
    }

    // plateforme à barre rotative : décidée avant le placement (elle est plus grande)
    let bar = null;
    if (type === 'solid' && i >= 18 && R() < 0.08 + 0.1 * d) {
      w = Math.max(w, 7.5); dp = Math.max(dp, 6.5);
      bar = true;
    }
    // pas de rebond juste avant un checkpoint (qui est plat)
    if (type === 'bounce' && (i + 1) % CHECK_EVERY === 0) type = 'solid';

    const prevMoving = pm.type === 'move';
    const prevBounce = pm.type === 'bounce';
    const prevFlat = pm.type === 'check' || pm.type === 'start';

    // Hauteur
    let dy;
    if (isCheck || prevFlat) dy = (R() * 2 - 1) * 0.25;
    else if (prevBounce) dy = 1.6 + R() * 1.4;
    else dy = Math.min(0.95, (R() * 2 - 1) * (0.55 + 0.45 * d) + 0.05);
    if (!prevBounce) {
      if (pm.y > 10) dy = -Math.abs(dy) - 0.2;
      else if (pm.y < -6) dy = Math.min(0.95, Math.abs(dy) + 0.2);
    }
    if (type === 'bounce' && dy > 0.3) dy = 0.3;

    // Écart (bord à bord) vers l'avant
    let gap = lerp(1.6, 4.0, d) * (0.8 + 0.4 * R());
    if (prevFlat || isCheck) gap = 1.8 + R() * 0.8;
    const reach = prevBounce ? 3.6 : Math.min(4.3, 4.6 - 1.4 * Math.max(0, dy));
    gap = Math.max(1.2, Math.min(gap, reach));
    const movingPair = prevMoving || type === 'move';
    if (movingPair) gap = Math.min(gap, 3.3);

    // Décalage latéral (toujours atteignable)
    const halfSum = (pm.w + w) / 2;
    const latAllow = Math.sqrt(Math.max(0, reach * reach - gap * gap)) * 0.8;
    let dx = (R() * 2 - 1) * (halfSum * 0.55 + latAllow);
    if (movingPair) dx = 0;
    if (Math.abs(pm.x + dx) > 14) dx = -Math.sign(pm.x) * Math.abs(dx);

    const zNear = pm.z - pm.d / 2 - gap;
    const z = zNear - dp / 2;
    const x = pm.x + dx;
    const y = pm.y + dy;

    const main = this._plat(row, 0, { x: x + 0, y, z: z, w, d: dp, type, main: true });
    if (type === 'move') {
      main.amp = Math.max(0.8, Math.min(3, 0.45 * Math.min(w, pm.w)));
      main.per = 3.2 + R() * 2.4;
      main.ph = R() * 6.2831853;
    }
    row.z = z; row.y = y; row.zMax = z + dp / 2; row.zMin = z - dp / 2; row.main = main;

    if (bar) {
      row.bar = {
        x, y: y + 0.55, z,
        r: Math.min(w, dp) / 2 + 0.6,
        speed: (1.1 + 1.0 * d) * (R() < 0.5 ? -1 : 1),
        phase: R() * 6.2831853,
      };
    }

    // Plateformes secondaires (leurres, bonus, raccourcis)
    if (!isCheck && !bar && i >= 4) {
      let n = 0;
      const r = R();
      if (r < 0.12 + 0.1 * d) n = 2; else if (r < 0.45) n = 1;
      const side0 = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < n; k++) {
        const side = k % 2 === 0 ? side0 : -side0;
        const w2 = 2.4 + R() * 2.2;
        const d2 = Math.min(dp, 2.4 + R() * 2.2);
        const ex = x + side * (w / 2 + w2 / 2 + 1.0 + R() * 1.6);
        const zRange = Math.max(0, dp - d2);
        const ez = z + (R() * 2 - 1) * zRange / 2;
        const ey = y + (R() * 2 - 1) * 0.7;
        const rt = R();
        const t2 = rt < 0.45 ? 'fall' : rt < 0.8 ? 'solid' : rt < 0.9 ? 'bounce' : 'ice';
        this._plat(row, k + 1, { x: ex, y: ey, z: ez, w: w2, d: d2, type: t2, main: false });
      }
    }

    // Bonus (boîtes mystère)
    if (isCheck) {
      row.pickups.push({ id: i + 'p0', x: x - 3, y: y + 1.1, z });
      row.pickups.push({ id: i + 'p1', x: x + 3, y: y + 1.1, z });
    } else if (i >= 3 && R() < 0.2) {
      const cand = row.plats.filter((p) => p.type !== 'bounce');
      const p = cand[Math.floor(R() * cand.length)] || main;
      row.pickups.push({ id: i + 'p0', x: p.x, y: p.y + 1.1, z: p.z });
    }

    this.rows.push(row);
  }

  _plat(row, k, o) {
    const p = {
      id: row.i + '.' + k,
      row: row.i,
      x: o.x, y: o.y, z: o.z, w: o.w, d: o.d, h: PLAT_H,
      type: o.type, main: o.main,
      amp: 0, per: 1, ph: 0,
      // état dynamique (géré par le monde)
      cx: o.x, dx: 0, top: o.y, solid: true, trigAt: -1, color: 0,
    };
    row.plats.push(p);
    return p;
  }

  _pickType(i, d, R, pm) {
    if (i < 5) return 'solid';
    const r = R();
    const pf = 0.1 + 0.38 * d;
    const pmv = i >= 8 ? 0.06 + 0.2 * d : 0;
    const pb = i >= 10 ? 0.05 : 0;
    const pi = i >= 12 ? 0.04 + 0.14 * d : 0;
    let t = 'solid';
    let acc = pf;
    if (r < acc) t = 'fall';
    else if (r < (acc += pmv)) t = 'move';
    else if (r < (acc += pb)) t = 'bounce';
    else if (r < (acc += pi)) t = 'ice';
    // évite l'enchaînement de deux plateformes mobiles / rebondissantes
    if ((t === 'bounce' && pm.type === 'bounce') || (t === 'move' && pm.type === 'move')) t = 'solid';
    return t;
  }
}

// Distance (m) correspondant à une position z
export const distanceOf = (z) => Math.max(0, Math.floor(-z));
