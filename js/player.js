// Joueur local : physique maison (AABB contre plateformes), effets, pouvoirs actifs.
import * as THREE from '../vendor/three.module.min.js';
import { clamp } from './rng.js';

export const BODY = { hw: 0.32, h: 1.5 };
const G = 26;
const JUMP_V = 9.6;
const RUN = 7.5;
const BOUNCE_V = 16;
const STEP = 0.3;
const TERMINAL = -42;

export class LocalPlayer {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.reset(new THREE.Vector3(0, 0.01, 0));
  }

  reset(p) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.standing = null;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.stun = 0;
    this.frozenT = 0;
    this.confusedT = 0;
    this.diveT = 0;
    this.diveCd = 0;
    this.invuln = 0;
    this.moveYaw = 0;
    this.speedH = 0;
    this.effects = {}; // nom -> temps restant (jump, speed, fly, shield)
    this.rowHint = 0;
    this.justLanded = false;
    this.impact = 0;
    this.jumpHeldPrev = false;
    this.lastGroundY = p.y;
  }

  has(k) { return (this.effects[k] || 0) > 0; }
  addEffect(k, t) { this.effects[k] = t; }
  clearEffect(k) { delete this.effects[k]; }

  knock(dx, dz, h, up) {
    this.vel.x = dx * h; this.vel.z = dz * h;
    this.vel.y = Math.max(this.vel.y, up);
    this.grounded = false; this.standing = null; this.coyote = 0;
    this.stun = 0.45;
  }

  freeze(t) { this.frozenT = t; this.vel.x *= 0.3; this.vel.z *= 0.3; }

  // in: {mx, mz (monde, norme<=1), jump, jumpHeld, dive, descend}
  // ctx: {plats (collidables), fx: {iceAll, windX, windZ, gravMul, jumpMul, reverse}, onLand, onJump, onBounce, onDive, frozenBlock}
  update(dt, inp, ctx) {
    dt = Math.min(dt, 0.05);
    const steps = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / steps;
    // décomptes
    for (const k of Object.keys(this.effects)) {
      this.effects[k] -= dt;
      if (this.effects[k] <= 0) delete this.effects[k];
    }
    this.stun = Math.max(0, this.stun - dt);
    this.frozenT = Math.max(0, this.frozenT - dt);
    this.confusedT = Math.max(0, this.confusedT - dt);
    this.diveCd = Math.max(0, this.diveCd - dt);
    this.diveT = Math.max(0, this.diveT - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    const frozen = this.frozenT > 0;
    let mx = inp.mx, mz = inp.mz;
    if (frozen) { mx = 0; mz = 0; }
    if (this.confusedT > 0 || (ctx.fx && ctx.fx.reverse)) { mx = -mx; mz = -mz; }
    const flying = this.has('fly');
    const speedMul = this.has('speed') ? 1.6 : 1;
    const jumpMul = (this.has('jump') ? 1.75 : 1) * ((ctx.fx && ctx.fx.jumpMul) || 1);
    const gMul = (ctx.fx && ctx.fx.gravMul) || 1;
    const iceAll = !!(ctx.fx && ctx.fx.iceAll);

    // saut mis en mémoire (tampon) et temps de coyote
    if (inp.jump && !frozen) this.jumpBuf = 0.14;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // plongeon
    if (inp.dive && !frozen && this.diveCd <= 0 && !flying) {
      const len = Math.hypot(mx, mz);
      const dx = len > 0.1 ? mx / len : Math.sin(this.moveYaw);
      const dz = len > 0.1 ? mz / len : Math.cos(this.moveYaw);
      this.vel.x = dx * 13; this.vel.z = dz * 13;
      if (this.grounded) this.vel.y = 4.5;
      this.diveT = 0.38; this.diveCd = 1.1;
      this.grounded = false; this.standing = null; this.coyote = 0;
      this.moveYaw = Math.atan2(dx, dz);
      if (ctx.onDive) ctx.onDive();
    }

    // porté par la plateforme sur laquelle on se tient
    if (this.standing && this.standing.solid) this.pos.x += this.standing.dx;
    this._depenetrate(ctx.plats);
    const wasGrounded = this.grounded;
    const vyBefore = this.vel.y;

    // --- vitesse horizontale ---
    const onIce = this.grounded && this.standing && (this.standing.type === 'ice' || iceAll);
    const wantX = mx * RUN * speedMul, wantZ = mz * RUN * speedMul;
    const hasInput = Math.abs(mx) + Math.abs(mz) > 0.05;
    let acc;
    if (this.diveT > 0) acc = 3;
    else if (this.stun > 0) acc = 5;
    else if (this.grounded) acc = onIce ? 7 : 62;
    else acc = 24;
    if (frozen) acc = this.grounded ? 2 : 0;
    if (hasInput || (this.grounded && !this.diveT)) {
      // en l'air sans entrée : on conserve l'élan ; au sol : on freine
      const brake = !hasInput && this.grounded ? (onIce ? 2 : 55) : acc;
      this.vel.x = approach(this.vel.x, wantX, brake * dt);
      this.vel.z = approach(this.vel.z, wantZ, brake * dt);
    } else if (!this.grounded && !frozen) {
      this.vel.x *= 1 - Math.min(1, 0.4 * dt);
      this.vel.z *= 1 - Math.min(1, 0.4 * dt);
    }
    // --- vertical ---
    if (flying) {
      const target = inp.jumpHeld ? 7 : inp.descend ? -7 : 0;
      this.vel.y = approach(this.vel.y, target, 32 * dt);
      this.grounded = false; this.standing = null;
      this.jumpBuf = 0;
    } else {
      let g = G * gMul;
      if (this.vel.y > 0 && !inp.jumpHeld && this.diveT <= 0) g *= 2.1; // saut variable
      this.vel.y = Math.max(TERMINAL, this.vel.y - g * dt);
      // saut
      if (this.jumpBuf > 0 && this.coyote > 0 && !frozen) {
        this.vel.y = JUMP_V * jumpMul;
        this.jumpBuf = 0; this.coyote = 0;
        this.grounded = false; this.standing = null;
        if (ctx.onJump) ctx.onJump();
      }
    }

    // --- déplacement avec collisions ---
    let landed = null;
    // le vent est une dérive constante (non annulée par le contrôle du joueur)
    const wx = ctx.fx && !frozen ? (ctx.fx.windX || 0) * 3.4 : 0;
    const wz = ctx.fx && !frozen ? (ctx.fx.windZ || 0) * 3.4 : 0;
    for (let s = 0; s < steps; s++) {
      this._moveX((this.vel.x + wx) * h, ctx.plats);
      this._moveZ((this.vel.z + wz) * h, ctx.plats);
      const l = this._moveY(this.vel.y * h, ctx.plats);
      if (l) landed = l;
    }
    this.justLanded = false;
    if (landed) {
      this.justLanded = !wasGrounded;
      this.impact = Math.max(0, -vyBefore);
      this.grounded = true;
      this.standing = landed;
      this.coyote = 0.12;
      this.lastGroundY = this.pos.y;
      if (landed.type === 'bounce') {
        this.vel.y = BOUNCE_V * (this.has('jump') ? 1.1 : 1);
        this.grounded = false; this.standing = null;
        if (ctx.onBounce) ctx.onBounce(landed);
      } else if (ctx.onLand) ctx.onLand(landed);
    } else {
      this.grounded = false;
      this.standing = null;
      this.coyote = Math.max(0, this.coyote - dt);
    }
    if (this.grounded && this.diveT > 0 && this.diveT < 0.3) this.diveT = 0;

    // orientation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speedH = sp;
    if (sp > 0.8 && !frozen) this.moveYaw = Math.atan2(this.vel.x, this.vel.z);
    this.jumpHeldPrev = inp.jumpHeld;
  }

  // Une plateforme mobile qui rentre dans un joueur immobile le repousse sur le côté.
  _depenetrate(plats) {
    const hw = BODY.hw;
    for (const p of plats) {
      if (!p.solid || p.type !== 'move' || p === this.standing) continue;
      if (!this._overlapXZ(p, hw)) continue;
      const fy = this.pos.y, top = p.top, bottom = top - p.h;
      if (fy + BODY.h <= bottom + 0.02 || fy >= top - STEP) continue;
      this.pos.x = this.pos.x >= p.cx ? p.cx + p.w / 2 + hw : p.cx - p.w / 2 - hw;
    }
  }

  _overlapXZ(p, hw) {
    const px = this.pos.x, pz = this.pos.z;
    return px + hw > p.cx - p.w / 2 && px - hw < p.cx + p.w / 2 && pz + hw > p.z - p.d / 2 && pz - hw < p.z + p.d / 2;
  }

  _moveX(a, plats) {
    if (a === 0) return;
    this.pos.x += a;
    this._side(plats, a, 0);
  }

  _moveZ(a, plats) {
    if (a === 0) return;
    this.pos.z += a;
    this._side(plats, 0, a);
  }

  _side(plats, ax, az) {
    const hw = BODY.hw;
    for (const p of plats) {
      if (!p.solid) continue;
      if (!this._overlapXZ(p, hw)) continue;
      const fy = this.pos.y, top = p.top, bottom = top - p.h;
      if (fy + BODY.h <= bottom + 0.02 || fy >= top) continue; // au-dessus / en-dessous
      if (top - fy <= STEP) { this.pos.y = top; if (this.vel.y < 0) this.vel.y = 0; continue; } // marche
      // collision latérale : on ressort du côté d'où l'on vient
      if (ax !== 0) {
        this.pos.x = ax > 0 ? p.cx - p.w / 2 - hw : p.cx + p.w / 2 + hw;
        this.vel.x = 0;
      } else {
        this.pos.z = az > 0 ? p.z - p.d / 2 - hw : p.z + p.d / 2 + hw;
        this.vel.z = 0;
      }
    }
  }

  _moveY(a, plats) {
    const prev = this.pos.y;
    this.pos.y += a;
    const hw = BODY.hw * 0.92;
    let land = null;
    for (const p of plats) {
      if (!p.solid) continue;
      if (!this._overlapXZ(p, hw)) continue;
      const top = p.top, bottom = top - p.h;
      if (this.vel.y <= 0) {
        if (prev >= top - 0.06 && this.pos.y < top + 0.0005 && (!land || p.top > land.top)) land = p;
      } else if (prev + BODY.h <= bottom + 0.06 && this.pos.y + BODY.h > bottom) {
        this.pos.y = bottom - BODY.h;
        this.vel.y = 0;
      }
    }
    if (land) {
      this.pos.y = land.top;
      this.vel.y = 0;
    }
    return land;
  }
}

function approach(v, target, d) {
  if (v < target) return Math.min(target, v + d);
  if (v > target) return Math.max(target, v - d);
  return v;
}

// Distance point-segment 2D (barres rotatives)
export function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}
