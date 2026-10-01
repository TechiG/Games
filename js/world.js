// Monde 3D : rendu, décor, plateformes (états dynamiques), bonus, barres rotatives, effets visuels.
import * as THREE from '../vendor/three.module.min.js';
import { clamp } from './rng.js';

const TAU = Math.PI * 2;
export const FALL_T = 1.5; // durée de chute visible
export const GONE_T = 3.2; // temps d'absence
export const POP_T = 0.35; // réapparition
export const SHAKE_T = 0.7;
export const SHAKE_QUAKE_T = 0.16;

const PALETTE = [0x4fc3f7, 0xff8fab, 0xb388ff, 0x7be07a, 0xffd166, 0xff9f68];

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeTopTextures() {
  const border = (x, s, col) => { x.strokeStyle = col; x.lineWidth = s * 0.06; x.strokeRect(s * 0.04, s * 0.04, s * 0.92, s * 0.92); };
  return {
    solid: (hex) => canvasTex(64, (x, s) => {
      x.fillStyle = hex; x.fillRect(0, 0, s, s);
      border(x, s, 'rgba(255,255,255,.75)');
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(s * 0.1, s * 0.1, s * 0.8, s * 0.32);
    }),
    fall: canvasTex(128, (x, s) => {
      x.fillStyle = '#ffb347'; x.fillRect(0, 0, s, s);
      x.fillStyle = '#ff7a2f';
      for (let i = -s; i < s * 2; i += s / 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s / 8, 0); x.lineTo(i + s / 8 + s, s); x.lineTo(i + s, s); x.fill(); }
      border(x, s, '#fff3d0');
      x.strokeStyle = 'rgba(90,30,0,.55)'; x.lineWidth = 3; x.beginPath(); x.moveTo(s * .3, s * .1); x.lineTo(s * .45, s * .4); x.lineTo(s * .35, s * .6); x.lineTo(s * .55, s * .9); x.stroke();
    }),
    move: canvasTex(128, (x, s) => {
      x.fillStyle = '#9b6bff'; x.fillRect(0, 0, s, s);
      border(x, s, '#e6dcff');
      x.fillStyle = '#ffffff'; x.font = `bold ${s * 0.6}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('↔', s / 2, s / 2 + 4);
    }),
    bounce: canvasTex(128, (x, s) => {
      x.fillStyle = '#4fd36a'; x.fillRect(0, 0, s, s);
      border(x, s, '#d6ffe0');
      x.fillStyle = '#1f8f3a'; x.beginPath(); x.arc(s / 2, s / 2, s * 0.32, 0, TAU); x.fill();
      x.fillStyle = '#b8ffc8'; x.beginPath(); x.arc(s / 2, s / 2, s * 0.2, 0, TAU); x.fill();
    }),
    ice: canvasTex(128, (x, s) => {
      x.fillStyle = '#c8f1ff'; x.fillRect(0, 0, s, s);
      border(x, s, '#ffffff');
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3;
      for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(s * (0.1 + i * 0.2), s * 0.9); x.lineTo(s * (0.3 + i * 0.2), s * 0.1); x.stroke(); }
    }),
    check: canvasTex(128, (x, s) => {
      const n = 8;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#ffffff' : '#ffcc33'; x.fillRect((i * s) / n, (j * s) / n, s / n + 1, s / n + 1); }
    }),
    start: canvasTex(128, (x, s) => {
      const n = 8;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#f2f6ff' : '#9fd0ff'; x.fillRect((i * s) / n, (j * s) / n, s / n + 1, s / n + 1); }
    }),
  };
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.quality = 'high';
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.horizon = new THREE.Color(0xd9f1ff);
    this.scene.background = this.horizon.clone();
    this.scene.fog = new THREE.Fog(this.horizon.getHex(), 70, 210);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);
    this.camera.position.set(0, 6, 10);

    this.hemi = new THREE.HemisphereLight(0xdff2ff, 0xffe3c8, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 130;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this._sky();
    this._clouds();
    this._particles();

    this.tops = makeTopTextures();
    this.bodyMats = {};
    this.topMats = {};
    this._materials();
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.unitPlane = new THREE.PlaneGeometry(1, 1);
    this.cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    this.padMat = new THREE.MeshLambertMaterial({ color: 0xb8ffc8 });

    this.rowViews = new Map();
    this.track = null;
    this.taken = new Set();
    this.rings = [];
    this.meteors = [];
    this.shake = 0;
    this.envTarget = { fogNear: 70, fogFar: 210, light: 1, tint: new THREE.Color(0xd9f1ff) };
    this.wind = { on: false, dir: [1, 0], amt: 0 };
    this._windStreaks();
    this.focus = new THREE.Vector3();
    this.time = 0;
    this.resize();
  }

  /* ---------- initialisation décor ---------- */
  _sky() {
    const geo = new THREE.SphereGeometry(450, 24, 14);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x4aa8ff) }, bottom: { value: new THREE.Color(0xd9f1ff) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h,0.8)), 1.0); }',
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  _clouds() {
    this.clouds = [];
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6b7a90, transparent: true, opacity: 0.95 });
    const g = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 34; i++) {
      const c = new THREE.Group();
      const n = 3 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) {
        const s = new THREE.Mesh(g, m);
        const r = 3 + Math.random() * 4;
        s.scale.set(r * 1.5, r * 0.8, r);
        s.position.set((k - n / 2) * 4.5 + Math.random() * 2, Math.random() * 1.5, Math.random() * 3);
        c.add(s);
      }
      c.userData.high = i % 4 === 0;
      this.clouds.push(c);
      this.scene.add(c);
      this._placeCloud(c, 0, true);
    }
  }

  _placeCloud(c, z, initial) {
    const high = c.userData.high;
    const side = Math.random() < 0.5 ? -1 : 1;
    c.position.x = high ? side * (40 + Math.random() * 60) : (Math.random() * 2 - 1) * 90;
    c.position.y = high ? 20 + Math.random() * 25 : -34 + Math.random() * 18;
    c.position.z = initial ? z + (Math.random() * 2 - 1) * 160 : z - 120 - Math.random() * 60;
  }

  _particles() {
    const N = 400;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pBase = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    const m = new THREE.PointsMaterial({ size: 0.34, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(geo, m);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.pCursor = 0;
  }

  burst(x, y, z, color, n = 12, speed = 4, up = 2) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.pCursor++ % this.pN;
      const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.8);
      this.pPos[k * 3] = x; this.pPos[k * 3 + 1] = y; this.pPos[k * 3 + 2] = z;
      this.pVel[k * 3] = Math.cos(a) * s; this.pVel[k * 3 + 1] = up * (0.3 + Math.random()) + Math.random() * speed * 0.3; this.pVel[k * 3 + 2] = Math.sin(a) * s;
      this.pBase[k * 3] = c.r; this.pBase[k * 3 + 1] = c.g; this.pBase[k * 3 + 2] = c.b;
      this.pLife[k] = this.pMax[k] = 0.5 + Math.random() * 0.5;
    }
  }

  _materials() {
    const side = (hex) => new THREE.MeshLambertMaterial({ color: hex });
    PALETTE.forEach((h, i) => {
      this.bodyMats['s' + i] = side(new THREE.Color(h).multiplyScalar(0.62));
      this.topMats['s' + i] = new THREE.MeshLambertMaterial({ map: this.tops.solid('#' + new THREE.Color(h).getHexString()) });
    });
    this.bodyMats.fall = side(0xc9621f);
    this.bodyMats.move = side(0x6a43c2);
    this.bodyMats.bounce = side(0x23964a);
    this.bodyMats.ice = new THREE.MeshLambertMaterial({ color: 0x8fd6ee, transparent: true, opacity: 0.92 });
    this.bodyMats.check = side(0xc99a1e);
    this.bodyMats.start = side(0x5d8fc7);
    for (const t of ['fall', 'move', 'bounce', 'ice', 'check', 'start']) {
      this.topMats[t] = new THREE.MeshLambertMaterial({ map: this.tops[t] });
    }
    this.topMats.warn = new THREE.MeshLambertMaterial({ color: 0xff4d3a, emissive: 0x7a1208 });
    this.barMat = new THREE.MeshLambertMaterial({ color: 0xff5a5f });
    this.barMat2 = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.hubMat = new THREE.MeshLambertMaterial({ color: 0x33384a });
    this.pickMat = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xb87a00 });
    this.pickTex = canvasTex(64, (x, s) => {
      x.fillStyle = '#ffd23f'; x.fillRect(0, 0, s, s);
      x.fillStyle = '#fff'; x.font = `bold ${s * 0.8}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', s / 2, s / 2 + 3);
    });
    this.pickMat = new THREE.MeshLambertMaterial({ map: this.pickTex, emissive: 0x8a5a00 });
    this.glowMat = new THREE.SpriteMaterial({
      map: canvasTex(64, (x, s) => {
        const g = x.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,230,120,.9)'); g.addColorStop(1, 'rgba(255,230,120,0)');
        x.fillStyle = g; x.fillRect(0, 0, s, s);
      }),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const bc = document.createElement('canvas');
    bc.width = 512; bc.height = 96;
    {
      const x = bc.getContext('2d');
      x.fillStyle = '#ffcc33'; x.fillRect(0, 0, 512, 96);
      x.fillStyle = '#fff'; for (let i = 0; i < 512; i += 64) x.fillRect(i, 0, 32, 10), x.fillRect(i + 32, 86, 32, 10);
      x.fillStyle = '#3a2a00'; x.font = 'bold 62px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('CHECKPOINT', 256, 50);
    }
    this.bannerTex = new THREE.CanvasTexture(bc);
    this.bannerTex.colorSpace = THREE.SRGBColorSpace;
    this.bannerMat = new THREE.MeshBasicMaterial({ map: this.bannerTex, side: THREE.DoubleSide });
  }

  _windStreaks() {
    const N = 70;
    this.wN = N;
    this.wPos = new Float32Array(N * 3);
    const arr = new Float32Array(N * 6);
    this.wGeo = new THREE.BufferGeometry();
    this.wGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    for (let i = 0; i < N; i++) {
      this.wPos[i * 3] = (Math.random() * 2 - 1) * 30;
      this.wPos[i * 3 + 1] = (Math.random() * 2 - 1) * 12 + 3;
      this.wPos[i * 3 + 2] = (Math.random() * 2 - 1) * 30;
    }
    this.wLines = new THREE.LineSegments(this.wGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    this.wLines.frustumCulled = false;
    this.wLines.visible = false;
    this.scene.add(this.wLines);
  }

  /* ---------- paramètres ---------- */
  setQuality(q) {
    this.quality = q;
    const low = q === 'low';
    this.renderer.shadowMap.enabled = !low;
    this.sun.castShadow = !low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.resize();
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------- piste ---------- */
  setTrack(track) {
    for (const v of this.rowViews.values()) this.scene.remove(v.group);
    this.rowViews.clear();
    this.track = track;
    this.taken.clear();
    for (const m of this.meteors) this.scene.remove(m.group);
    this.meteors.length = 0;
    this.pLife.fill(0);
  }

  syncRows(ranges) {
    // ranges : [[from, to], ...]
    const need = new Set();
    for (const [a, b] of ranges) for (let i = Math.max(0, a); i <= b; i++) need.add(i);
    for (const [i, v] of this.rowViews) {
      if (!need.has(i)) { this.scene.remove(v.group); this.rowViews.delete(i); }
    }
    for (const i of need) if (!this.rowViews.has(i)) this._buildRow(i);
  }

  _buildRow(i) {
    const row = this.track.row(i);
    const group = new THREE.Group();
    const v = { row, group, plats: [], pickups: [], bar: null };
    for (const p of row.plats) {
      const g = new THREE.Group();
      const ci = p.type === 'solid' || p.type === 'start' ? (row.i * 3 + parseInt(p.id.split('.')[1], 10)) % PALETTE.length : 0;
      const bodyKey = p.type === 'solid' ? 's' + ci : p.type;
      const body = new THREE.Mesh(this.unitBox, this.bodyMats[bodyKey]);
      body.scale.set(p.w, p.h, p.d);
      body.position.y = -p.h / 2;
      body.castShadow = true; body.receiveShadow = true;
      const top = new THREE.Mesh(this.unitPlane, this.topMats[p.type === 'solid' ? 's' + ci : p.type]);
      top.rotation.x = -Math.PI / 2;
      top.scale.set(p.w - 0.02, p.d - 0.02, 1);
      top.position.y = 0.012;
      top.receiveShadow = true;
      g.add(body, top);
      if (p.type === 'bounce') {
        const pad = new THREE.Mesh(this.cylGeo, this.padMat);
        const r = Math.min(p.w, p.d) * 0.28;
        pad.scale.set(r * 2, 0.18, r * 2);
        pad.position.y = 0.09;
        pad.castShadow = true;
        g.add(pad);
      }
      if (p.type === 'check') {
        const poleM = this.hubMat;
        for (const s of [-1, 1]) {
          const pole = new THREE.Mesh(this.unitBox, poleM);
          pole.scale.set(0.3, 5, 0.3);
          pole.position.set(s * (p.w / 2 - 0.4), 2.5, -p.d / 2 + 0.4);
          pole.castShadow = true;
          g.add(pole);
        }
        const ban = new THREE.Mesh(this.unitPlane, this.bannerMat);
        ban.scale.set(Math.min(p.w - 0.6, 8), (Math.min(p.w - 0.6, 8) * 96) / 512, 1);
        ban.position.set(0, 4.5, -p.d / 2 + 0.4);
        g.add(ban);
      }
      p._view = { g, top, body, topMat: top.material };
      g.position.set(p.cx, 0, p.z);
      g.userData.y = p.y;
      v.plats.push(p);
      group.add(g);
    }
    for (const pk of row.pickups) {
      const m = new THREE.Group();
      const cube = new THREE.Mesh(this.unitBox, this.pickMat);
      cube.scale.setScalar(0.75);
      cube.castShadow = true;
      const glow = new THREE.Sprite(this.glowMat);
      glow.scale.set(2.4, 2.4, 1);
      m.add(cube, glow);
      m.position.set(pk.x, pk.y, pk.z);
      m.visible = !this.taken.has(pk.id);
      v.pickups.push({ pk, m, cube });
      group.add(m);
    }
    if (row.bar) {
      const b = row.bar;
      const g = new THREE.Group();
      g.position.set(b.x, b.y, b.z);
      const len = b.r * 2;
      const seg = 6;
      for (let s = 0; s < seg; s++) {
        const part = new THREE.Mesh(this.unitBox, s % 2 ? this.barMat2 : this.barMat);
        part.scale.set(len / seg, 0.34, 0.34);
        part.position.x = -len / 2 + (s + 0.5) * (len / seg);
        part.castShadow = true;
        g.add(part);
      }
      const hub = new THREE.Mesh(this.cylGeo, this.hubMat);
      hub.scale.set(0.9, 1.0, 0.9);
      hub.position.y = -0.1;
      hub.castShadow = true;
      g.add(hub);
      v.bar = { b, g };
      group.add(g);
    }
    this.scene.add(group);
    this.rowViews.set(i, v);
    // état initial des plateformes (au cas où elles seraient déjà en cours de chute)
    for (const p of row.plats) this._applyPlat(p, this.time, this._lastRoundT || 0);
  }

  /* ---------- plateformes dynamiques ---------- */
  triggerPlat(p, now, quick = false, any = false) {
    if (!p || p.trigAt >= 0) return false;
    if (!any && p.type !== 'fall') return false;
    if (p.type === 'start' || p.type === 'check') return false;
    p.trigAt = now;
    p.shakeDur = quick ? SHAKE_QUAKE_T : SHAKE_T;
    return true;
  }

  // Fait tomber toutes les plateformes dans un rayon (pouvoir « séisme »)
  // `safe` : position d'un joueur à épargner (celui qui lance le pouvoir)
  triggerNear(x, z, r, now, safe = null) {
    if (!this.track) return;
    const i0 = this.track.rowAtZ(z, 0);
    for (let i = Math.max(0, i0 - 6); i <= i0 + 6; i++) {
      for (const p of this.track.row(i).plats) {
        if (Math.hypot(p.cx - x, p.z - z) >= r + Math.max(p.w, p.d) / 2) continue;
        if (safe && Math.abs(p.cx - safe.x) < p.w / 2 + 1 && Math.abs(p.z - safe.z) < p.d / 2 + 1) continue;
        this.triggerPlat(p, now, true, true);
      }
    }
  }

  _applyPlat(p, now, roundT) {
    // mouvement
    if (p.type === 'move') {
      const nx = p.x + p.amp * Math.sin((TAU * roundT) / p.per + p.ph);
      p.dx = nx - p.cx;
      p.cx = nx;
    } else p.dx = 0;
    let drop = 0, solid = true, vis = true, sc = 1, sx = 0, sz = 0, warn = false;
    if (p.trigAt >= 0) {
      const e = now - p.trigAt, sd = p.shakeDur || SHAKE_T;
      if (e < sd) {
        warn = true;
        sx = (Math.random() - 0.5) * 0.16; sz = (Math.random() - 0.5) * 0.16;
      } else if (e < sd + FALL_T) {
        const f = e - sd;
        solid = false; drop = -0.5 * 30 * f * f;
      } else if (e < sd + FALL_T + GONE_T) {
        solid = false; vis = false;
      } else if (e < sd + FALL_T + GONE_T + POP_T) {
        sc = clamp((e - sd - FALL_T - GONE_T) / POP_T, 0.05, 1);
      } else p.trigAt = -1;
    }
    p.solid = solid;
    p.top = p.y + drop;
    const v = p._view;
    if (v) {
      v.g.visible = vis;
      v.g.position.set(p.cx + sx, drop, p.z + sz);
      v.g.position.y = p.y + drop;
      v.g.scale.set(sc, sc, sc);
      v.top.material = warn ? this.topMats.warn : v.topMat;
      v.top.position.y = 0.012;
    }
  }

  update(dt, now, roundT, ev) {
    this.time = now;
    this._lastRoundT = roundT;
    for (const v of this.rowViews.values()) {
      for (const p of v.plats) this._applyPlat(p, now, roundT);
      for (const pk of v.pickups) {
        if (!pk.m.visible) continue;
        pk.cube.rotation.y = now * 1.8;
        pk.cube.rotation.x = Math.sin(now * 1.3) * 0.3;
        pk.m.position.y = pk.pk.y + Math.sin(now * 2.2 + pk.pk.x) * 0.15;
      }
      if (v.bar) v.bar.g.rotation.y = this.barAngle(v.bar.b, roundT);
    }
    this._updateFx(dt, now);
  }

  barAngle(b, roundT) { return b.phase + b.speed * roundT; }

  takePickup(id) {
    this.taken.add(id);
    const ri = parseInt(id, 10);
    const v = this.rowViews.get(ri);
    if (v) for (const pk of v.pickups) if (pk.pk.id === id) {
      if (pk.m.visible) this.burst(pk.pk.x, pk.pk.y, pk.pk.z, 0xffd23f, 16, 4, 3);
      pk.m.visible = false;
    }
  }

  /* ---------- effets ---------- */
  ring(x, y, z, color, radius = 10, dur = 0.7) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.3, z);
    this.scene.add(m);
    this.rings.push({ m, t: 0, dur, radius });
  }

  addMeteor(x, y, z, warn, onImpact) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 3.2, 32), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.05, z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, y + 0.05, z);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff8a2a }));
    ball.position.set(x, y + 60, z);
    ball.visible = false;
    group.add(ring, disc, ball);
    this.scene.add(group);
    this.meteors.push({ group, ring, ball, x, y, z, t: 0, warn, onImpact });
  }

  _updateFx(dt, now) {
    // particules
    const P = this.pPos, V = this.pVel, C = this.pCol;
    for (let k = 0; k < this.pN; k++) {
      if (this.pLife[k] <= 0) { C[k * 3] = C[k * 3 + 1] = C[k * 3 + 2] = 0; continue; }
      this.pLife[k] -= dt;
      V[k * 3 + 1] -= 9 * dt;
      P[k * 3] += V[k * 3] * dt; P[k * 3 + 1] += V[k * 3 + 1] * dt; P[k * 3 + 2] += V[k * 3 + 2] * dt;
      const f = clamp(this.pLife[k] / this.pMax[k], 0, 1);
      C[k * 3] = this.pBase[k * 3] * f; C[k * 3 + 1] = this.pBase[k * 3 + 1] * f; C[k * 3 + 2] = this.pBase[k * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    // anneaux
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = r.t / r.dur;
      if (f >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(1 + (r.radius - 1) * (1 - (1 - f) * (1 - f)));
      r.m.material.opacity = 0.8 * (1 - f);
    }
    // météores
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.t += dt;
      const pulse = 0.5 + 0.5 * Math.sin(m.t * 14);
      m.ring.material.opacity = 0.5 + 0.4 * pulse;
      const fallT = 0.5;
      if (m.t > m.warn - fallT) {
        m.ball.visible = true;
        const f = clamp((m.t - (m.warn - fallT)) / fallT, 0, 1);
        m.ball.position.y = m.y + 1 + (1 - f * f) * 60;
      }
      if (m.t >= m.warn) {
        this.burst(m.x, m.y + 0.5, m.z, 0xff8a2a, 40, 9, 6);
        this.ring(m.x, m.y, m.z, 0xff6a2a, 6, 0.5);
        this.shake = Math.max(this.shake, 0.25);
        if (m.onImpact) m.onImpact(m);
        this.scene.remove(m.group);
        m.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        this.meteors.splice(i, 1);
      }
    }
    // vent
    const w = this.wind;
    this.wind.amt += ((w.on ? 1 : 0) - w.amt) * Math.min(1, dt * 3);
    this.wLines.visible = w.amt > 0.02;
    if (this.wLines.visible) {
      this.wLines.material.opacity = 0.55 * w.amt;
      const a = this.wGeo.attributes.position.array;
      const cam = this.camera.position;
      const sp = 38;
      for (let i = 0; i < this.wN; i++) {
        let x = this.wPos[i * 3] + w.dir[0] * sp * dt, y = this.wPos[i * 3 + 1], z = this.wPos[i * 3 + 2] + w.dir[1] * sp * dt;
        if (x > 30) x -= 60; else if (x < -30) x += 60;
        if (z > 30) z -= 60; else if (z < -30) z += 60;
        this.wPos[i * 3] = x; this.wPos[i * 3 + 2] = z;
        a[i * 6] = cam.x + x; a[i * 6 + 1] = cam.y + y - 3; a[i * 6 + 2] = cam.z + z;
        a[i * 6 + 3] = cam.x + x - w.dir[0] * 2.4; a[i * 6 + 4] = cam.y + y - 3; a[i * 6 + 5] = cam.z + z - w.dir[1] * 2.4;
      }
      this.wGeo.attributes.position.needsUpdate = true;
    }
    // environnement (brouillard, lumière)
    const e = this.envTarget, f = this.scene.fog;
    const k = Math.min(1, dt * 2.5);
    f.near += (e.fogNear - f.near) * k;
    f.far += (e.fogFar - f.far) * k;
    this.hemi.intensity += (e.light - this.hemi.intensity) * k;
    this.horizon.lerp(e.tint, k);
    f.color.copy(this.horizon);
    this.scene.background.copy(this.horizon);
    this.skyMat.uniforms.bottom.value.copy(this.horizon);
    this.shake = Math.max(0, this.shake - dt * 1.2);
  }

  setEnv(ev) {
    const t = this.envTarget;
    t.fogNear = 70; t.fogFar = 210; t.light = 1; t.tint.setHex(0xd9f1ff);
    this.wind.on = false;
    if (ev && ev.phase === 'active') {
      if (ev.type === 'fog') { t.fogNear = 4; t.fogFar = 38; t.tint.setHex(0xe8eef4); }
      if (ev.type === 'wind') { this.wind.on = true; this.wind.dir = ev.dir; }
      if (ev.type === 'ice') { t.tint.setHex(0xcdeeff); }
      if (ev.type === 'meteor') { t.tint.setHex(0xffd0b8); t.light = 0.85; }
      if (ev.type === 'quake') { t.tint.setHex(0xe8d6c8); }
      if (ev.type === 'heavy') { t.tint.setHex(0xc9c4e8); t.light = 0.9; }
      if (ev.type === 'reverse') { t.tint.setHex(0xf0d0ff); }
    }
  }

  /* ---------- rendu ---------- */
  render(focus, camPos, camLook, dt) {
    this.focus.copy(focus);
    // soleil suit le joueur
    this.sun.position.set(focus.x + 22, focus.y + 38, focus.z + 14);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();
    // nuages
    for (const c of this.clouds) {
      if (c.position.z > focus.z + 70) this._placeCloud(c, focus.z, false);
      else if (c.position.z < focus.z - 260) { c.position.z = focus.z + 60 + Math.random() * 40; }
    }
    this.camera.position.copy(camPos);
    if (this.shake > 0) {
      const s = this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(camLook);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
