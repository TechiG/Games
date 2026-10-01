// Moteur de jeu : manches, joueurs locaux/distants, réseau, pouvoirs, événements, caméra, HUD.
import * as THREE from '../vendor/three.module.min.js';
import { World } from './world.js';
import { Track, distanceOf } from './track.js';
import { LocalPlayer, distPointSeg } from './player.js';
import { AvatarModel, sanitizeAvatar } from './avatar.js';
import { Net } from './net.js';
import { eventAt, EVENT_INFO } from './events.js';
import { POWERS, rollPower, ATTACK_RADIUS, TREMOR_RANGE, TREMOR_RADIUS } from './powers.js';
import { sfx } from './audio.js';
import { Input } from './input.js';
import { addLocalScore, personalBest, cleanName, submitGlobal, loadScores } from './scores.js';
import { clamp } from './rng.js';

const $ = (id) => document.getElementById(id);
const rnd32 = () => (Math.random() * 4294967296) >>> 0;
const START_LIVES = 3, MAX_LIVES = 5;
const COUNTDOWN_MS = 4000;
const OVER_AUTO_MS = 12000;
const OK_ID = /^\d{1,5}\.\d{1,2}$/;
const OK_PK = /^\d{1,5}p\d{1,2}$/;
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

class Remote {
  constructor(id, profile, world) {
    this.id = id;
    this.name = cleanName(profile && profile.name);
    this.avatar = sanitizeAvatar(profile && profile.avatar);
    this.model = new AvatarModel(this.avatar, this.name, true);
    this.model.root.visible = false;
    world.scene.add(this.model.root);
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.has = false;
    this.yaw = 0; this.flags = 0; this.score = 0; this.lives = START_LIVES; this.alive = true;
    this.speed = 0; this.vy = 0; this.lat = 0; this.row = 0; this.awaySince = 0;
    this.hitCd = 0;
  }
  dispose() { this.model.dispose(); }
}

export class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.world = new World(canvas);
    this.input = new Input(canvas);
    this.local = new LocalPlayer();
    this.profile = { name: 'Joueur', avatar: sanitizeAvatar(null) };
    this.phase = 'menu'; // menu | lobby | countdown | run | over
    this.mode = 'solo';
    this.net = null;
    this.remotes = new Map();
    this.round = { no: 0, seed: 1, startMs: performance.now() };
    this.track = null;
    this.cam = { yaw: 0, pitch: 0.4, dist: 8.5, ty: 0, orbit: 0 };
    this.localModel = null;
    this.paused = false;
    this.pauseStart = 0;
    this.session = new Map(); // nom -> {best,total,rounds}
    this.taken = new Set();
    this.cpRow = 0; this.lives = START_LIVES; this.score = 0; this.alive = true; this.deadT = 0;
    this.inv = null;
    this.ev = null; this.evKey = '';
    this.meteorT = 1;
    this.overAt = 0;
    this.specId = null;
    this.best = personalBest();
    this.plats = [];
    this.ctx = { plats: this.plats, fx: { iceAll: false, windX: 0, windZ: 0, gravMul: 1, jumpMul: 1, reverse: false } };
    this.hudAcc = 0; this.sendAcc = 0; this.endAcc = 0; this.liveAcc = 0;
    this.liveOpen = false;
    this.lastCount = null;
    this.barCd = 0;
    this.runAcc = 0;
    this._last = performance.now();
    this._tmp = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._focus = new THREE.Vector3();

    this.input.onPause = () => this.togglePause();
    this.input.onScore = (on) => this.setLive(on);
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !(e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) this.toggleMute();
    });
    document.addEventListener('pointerlockchange', () => {
      // Échap pendant le jeu : le navigateur libère la souris -> on ouvre la pause
      if (!document.pointerLockElement && this.input.enabled && (this.phase === 'run' || this.phase === 'countdown') && !this.paused && !this.ui.isOpen()) {
        this.openPause();
      }
    });
    document.addEventListener('visibilitychange', () => { this.sendPos(true); });
    window.addEventListener('resize', () => this.world.resize());

    // les boutons du HUD ne doivent jamais garder le focus (Espace/Entrée les redéclencheraient en plein jeu)
    for (const id of ['power-slot', 'btn-sb', 'btn-mute', 'btn-pause']) {
      const el = $(id);
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => el.blur());
    }
    $('power-slot').addEventListener('click', () => this.usePower());
    $('btn-sb').addEventListener('click', () => this.setLive(!this.liveOpen));
    $('btn-mute').addEventListener('click', () => this.toggleMute());
    $('btn-pause').addEventListener('click', () => this.togglePause());
    this.refreshMuteUI();

    this.rebuildLocalModel();
    this.enterMenuScene();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
    this._sendTimer = setInterval(() => this.sendPos(), 100);
  }

  /* ------------------------------------------------------------------ */
  /*  Profil / personnage                                                 */
  /* ------------------------------------------------------------------ */
  setProfile(name, avatar) {
    this.profile.name = cleanName(name);
    this.profile.avatar = sanitizeAvatar(avatar);
    this.rebuildLocalModel();
    if (this.net) this.net.broadcast({ t: 'prof', p: { name: this.profile.name, avatar: this.profile.avatar } });
  }

  rebuildLocalModel() {
    if (this.localModel) this.localModel.dispose();
    this.localModel = new AvatarModel(this.profile.avatar, this.profile.name, false);
    this.world.scene.add(this.localModel.root);
  }

  /* ------------------------------------------------------------------ */
  /*  Scènes / manches                                                    */
  /* ------------------------------------------------------------------ */
  enterMenuScene() {
    this.phase = 'menu';
    this.mode = 'solo';
    this.track = new Track(7);
    this.world.setTrack(this.track);
    this.round = { no: 0, seed: 7, startMs: performance.now() };
    this.local.reset(new THREE.Vector3(0, 0.02, 2));
    this.ev = null; this.evKey = '';
    this.world.setEnv(null);
    this.alive = true; this.deadT = 0;
    this._showHud(false);
    this.input.enabled = false;
    this.cam.orbit = 0;
  }

  _showHud(on) {
    $('hud').classList.toggle('hidden', !on);
    $('touch').classList.toggle('hidden', !(on && this.input.isTouch));
  }

  startSolo() {
    this.leaveNet();
    this.mode = 'solo';
    this.startRound(rnd32(), 3500, this.round.no + 1);
  }

  startRound(seed, inMs, n) {
    sfx.unlock();
    this.round = { no: n, seed, startMs: performance.now() + inMs };
    this.track = new Track(seed);
    this.world.setTrack(this.track);
    this.taken.clear();
    this.cpRow = 0; this.lives = START_LIVES; this.score = 0; this.alive = true; this.deadT = 0;
    this.inv = null; this.evKey = ''; this.ev = null; this.meteorT = 2;
    this.world.setEnv(null);
    for (const r of this.remotes.values()) { r.alive = true; r.score = 0; r.lives = START_LIVES; }
    this.specId = null;
    this.overAt = 0;
    this.lastCount = null;
    this.paused = false;
    this._spawnLocal(0);
    this.phase = inMs > 0 ? 'countdown' : 'run';
    this.ui.screen(null);
    this._showHud(true);
    this.input.enabled = true;
    this.input.clearEdges();
    this.cam.yaw = 0; this.cam.pitch = 0.4;
    $('hud-center').textContent = '';
    this.best = personalBest();
    this.hudAcc = 1;
    this.sendPos(true);
  }

  enterLobby() {
    this.phase = 'lobby';
    this.round = { no: this.round.no, seed: 7, startMs: performance.now() };
    this.track = new Track(7);
    this.world.setTrack(this.track);
    this.taken.clear();
    this.alive = true; this.deadT = 0; this.lives = START_LIVES; this.score = 0; this.inv = null;
    this.ev = null; this.evKey = ''; this.world.setEnv(null);
    this._spawnLocal(0);
    this._showHud(false);
    this.input.enabled = false;
    this.input.releasePointer();
    this.ui.screen('lobby');
    this.ui.refreshLobby();
  }

  _slotIndex() {
    const ids = [this.net ? this.net.myId : 'me', ...this.remotes.keys()].sort();
    return Math.max(0, ids.indexOf(this.net ? this.net.myId : 'me'));
  }

  _spawnLocal(rowIdx) {
    const row = this.track.row(rowIdx);
    const m = row.main;
    let x = m.x, z = m.z;
    if (rowIdx === 0) {
      const s = this._slotIndex();
      const perRow = Math.min(5, this.remotes.size + 1);
      x = ((s % 5) - (perRow - 1) / 2) * 2.4;
      z = 2 + Math.floor(s / 5) * 2.2;
    } else {
      x += (Math.random() * 2 - 1) * 3.2;
      z += (Math.random() * 2 - 1) * 2;
    }
    this.local.reset(new THREE.Vector3(x, m.y + 0.02, z));
    this.local.rowHint = rowIdx;
    this.local.invuln = rowIdx === 0 ? 0 : 2;
    this.local.moveYaw = Math.PI; // regarde vers -Z (devant)
    this.localModel.root.rotation.y = Math.PI;
    this.cam.ty = m.y + 1;
  }

  _roundT() { return (performance.now() - this.round.startMs) / 1000; }

  /* ------------------------------------------------------------------ */
  /*  Boucle principale                                                   */
  /* ------------------------------------------------------------------ */
  _frame() {
    requestAnimationFrame(this._frame);
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    dt = Math.min(Math.max(dt, 0), 0.05);
    try {
      if (this.phase === 'menu' || this.phase === 'lobby' || this.phase === 'over') this._idleTick(dt, now);
      else this._playTick(dt, now);
    } catch (e) {
      console.error(e);
      if (!this._errShown) { this._errShown = true; this.toast('Erreur interne : ' + (e && e.message), 'bad'); }
    }
  }

  // Menu / salon / résultats : décor animé avec caméra en orbite
  _idleTick(dt, now) {
    const t = this._roundT();
    this.cam.orbit += dt * 0.22;
    const L = this.local;
    this.track.rowAtZ(L.pos.z, 0);
    this.world.syncRows([[0, 22]]);
    this.world.update(dt, now / 1000, t, null);
    this.ctx.fx.iceAll = false; this.ctx.fx.windX = this.ctx.fx.windZ = 0; this.ctx.fx.reverse = false;
    this._collect(0);
    L.update(dt, { mx: 0, mz: 0, jump: false, jumpHeld: false, dive: false, descend: false }, this.ctx);
    // les joueurs restent sur la plateforme de départ
    this._updateLocalModel(dt, true, this.cam.orbit);
    this._updateRemotes(dt, now, this.cam.orbit, true);
    const cx = this.phase === 'over' ? L.pos.x : 0, cz = this.phase === 'over' ? L.pos.z : 2;
    const cy = this.phase === 'over' ? L.pos.y : 0;
    const a = this.cam.orbit;
    const rad = this.phase === 'menu' ? 9 : 10;
    this._camPos.set(cx + Math.sin(a) * rad, cy + 3.6, cz + Math.cos(a) * rad);
    this._look.set(cx, cy + 1.1, cz);
    this._focus.set(cx, cy, cz);
    this.world.render(this._focus, this._camPos, this._look, dt);
    if (this.phase === 'over' && this.mode === 'multi') this._overTick(now);
  }

  _overTick(now) {
    const left = Math.max(0, Math.ceil((OVER_AUTO_MS - (now - this.overAt)) / 1000));
    this.ui.setResultsCountdown(left);
    if (this.net && this.net.isHost() && now - this.overAt > OVER_AUTO_MS) this.hostStart();
  }

  _collect(rowIdx) {
    this.plats.length = 0;
    for (let i = Math.max(0, rowIdx - 3); i <= rowIdx + 4; i++) for (const p of this.track.row(i).plats) this.plats.push(p);
  }

  _playTick(dt, now) {
    const nowS = now / 1000;
    const L = this.local;
    if (this.paused && this.mode === 'solo') {
      this.world.render(this._focus, this._camPos, this._look, 0);
      return;
    }
    let t = this._roundT();

    // ---- transitions de phase ----
    if (this.phase === 'countdown') {
      const c = Math.ceil(-t);
      if (c !== this.lastCount && t < 0) {
        this.lastCount = c;
        if (c <= 3 && c >= 1) { this._center(String(c)); sfx.play('beep'); }
      }
      if (t >= 0) { this.phase = 'run'; this._center('GO !'); sfx.play('go'); setTimeout(() => { if (this.phase === 'run') this._center(''); }, 900); if (!this.input.isTouch) this.toast('Espace : sauter · Maj : plonger · E : pouvoir', ''); }
    }
    const running = this.phase === 'run';

    // ---- événements de course ----
    const ev = running ? eventAt(this.round.seed, t) : null;
    this._handleEvent(ev, dt);

    // ---- fenêtre de rangs visibles ----
    const r = this.track.rowAtZ(L.pos.z, L.rowHint);
    L.rowHint = r;
    const ranges = [[r - 7, r + 26]];
    for (const rm of this.remotes.values()) {
      if (!rm.has) continue;
      rm.row = this.track.rowAtZ(rm.pos.z, rm.row);
      ranges.push([rm.row - 4, rm.row + 14]);
    }
    this.world.syncRows(ranges);
    this.world.update(dt, nowS, t, ev);
    this._collect(r);

    // ---- contrôle du joueur local ----
    const inp = this.input.poll();
    const look = this.input.takeLook();
    const cam = this.cam;
    cam.yaw -= look.x * 0.0032;
    cam.pitch = clamp(cam.pitch + look.y * 0.0032, 0.05, 1.25);
    cam.dist = clamp(cam.dist + this.input.takeZoom() * 0.8, 5, 15);
    if (inp.power) this.usePower();

    const canAct = this.alive && this.deadT <= 0;
    if (canAct) {
      const fx = this.ctx.fx;
      const act = ev && ev.phase === 'active' ? ev.type : '';
      fx.iceAll = act === 'ice';
      fx.windX = act === 'wind' ? ev.dir[0] : 0;
      fx.windZ = act === 'wind' ? ev.dir[1] : 0;
      fx.gravMul = act === 'heavy' ? 1.3 : 1;
      fx.jumpMul = act === 'heavy' ? 0.8 : 1;
      fx.reverse = act === 'reverse';
      const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
      const move = this.phase === 'run';
      const mx = move ? -sy * inp.my + cy * inp.mx : 0;
      const mz = move ? -cy * inp.my - sy * inp.mx : 0;
      this.ctx.onLand = (p) => this._stand(p, nowS);
      this.ctx.onBounce = (p) => { this._stand(p, nowS); sfx.play('bounce'); this.world.burst(L.pos.x, L.pos.y, L.pos.z, 0x7be07a, 14, 3, 3); };
      this.ctx.onJump = () => { sfx.play('jump'); this.world.burst(L.pos.x, L.pos.y + 0.1, L.pos.z, 0xffffff, 6, 1.5, 1); };
      this.ctx.onDive = () => { sfx.play('jump'); };
      L.update(dt, { mx, mz, jump: move && inp.jump, jumpHeld: move && inp.jumpHeld, dive: move && inp.dive, descend: inp.descend }, this.ctx);
      if (L.justLanded && L.impact > 6) { sfx.play('land'); this.world.burst(L.pos.x, L.pos.y + 0.05, L.pos.z, 0xffffff, 5, 2, 0.8); }
      if (running) {
        this._hazards(dt, nowS, t, r);
        this._checkPickups(r);
        this._diveHits(now);
      }
      this._bumps();
      // mort dans le vide
      let minY = 1e9;
      for (let i = Math.max(0, r - 6); i <= r + 8; i++) minY = Math.min(minY, this.track.row(i).y);
      if (L.pos.y < minY - 18 || L.pos.y < -80) this._onFall();
    } else if (this.alive && this.deadT > 0) {
      this.deadT -= dt;
      if (this.deadT <= 0) this._respawn();
    }

    // ---- caméra ----
    this._updateCamera(dt, now, inp);
    this._updateLocalModel(dt, false, cam.yaw);
    this._updateRemotes(dt, now, cam.yaw);

    // ---- réseau / fin de manche ----
    if (this.mode === 'multi' && running) {
      this.endAcc += dt;
      if (this.endAcc > 0.5) { this.endAcc = 0; this._hostCheckEnd(now); }
    }

    // ---- HUD ----
    this.hudAcc += dt;
    if (this.hudAcc > 0.1) { this.hudAcc = 0; this._updateHud(ev, t); }
    this.liveAcc += dt;
    if (this.liveOpen && this.liveAcc > 0.4) { this.liveAcc = 0; this._renderLive(); }

    // ---- rendu ----
    this.world.render(this._focus, this._camPos, this._look, dt);
  }

  /* ------------------------------------------------------------------ */
  /*  Gameplay local                                                      */
  /* ------------------------------------------------------------------ */
  _stand(p, nowS) {
    if (this.phase !== 'run') return;
    const dist = distanceOf(p.z);
    if (dist > this.score) this.score = dist;
    if (p.type === 'fall') {
      const quake = this.ev && this.ev.type === 'quake' && this.ev.phase === 'active';
      if (this.world.triggerPlat(p, nowS, !!quake) && this.net) this.net.broadcast({ t: 'tg', id: p.id, q: quake ? 1 : 0 });
    }
    if (p.type === 'check' && p.row > this.cpRow) {
      this.cpRow = p.row;
      sfx.play('check');
      this.world.burst(p.cx, p.top + 0.5, p.z, 0xffcc33, 30, 6, 4);
      if (this.lives < MAX_LIVES) { this.lives++; this.toast('📍 Checkpoint ! +1 ❤️', 'good'); }
      else this.toast('📍 Checkpoint !', 'good');
    }
  }

  _onFall() {
    if (this.phase !== 'run') { this._spawnLocal(0); return; }
    if (!this.alive || this.deadT > 0) return;
    sfx.play('fall');
    this.lives--;
    this.local.effects = {};
    if (this.lives <= 0) { this._eliminate(); return; }
    this.deadT = 1.2;
    this.toast('💥 Tombé ! Il te reste ' + this.lives + ' ❤️', 'bad');
    this.sendPos(true);
  }

  _respawn() {
    this._spawnLocal(this.cpRow);
    this.world.ring(this.local.pos.x, this.local.pos.y, this.local.pos.z, 0x7be07a, 4, 0.6);
    sfx.play('respawn');
    this.sendPos(true);
  }

  _eliminate() {
    this.alive = false;
    this.deadT = 0;
    this.inv = null;
    sfx.play('out');
    const entry = addLocalScore({ name: this.profile.name, score: this.score, mode: this.mode, players: this.remotes.size + 1 });
    submitGlobal(entry);
    const was = this.best;
    this.best = personalBest();
    this.toast(this.score > was ? `🏆 Nouveau record : ${this.score} m !` : `Éliminé ! Score : ${this.score} m`, this.score > was ? 'good' : 'bad');
    this.sendPos(true);
    if (this.mode === 'solo') {
      setTimeout(() => { if (this.phase === 'run' && !this.alive && this.mode === 'solo') this._endSolo(); }, 1300);
    }
  }

  _endSolo() {
    this.phase = 'over';
    this.overAt = performance.now();
    this.input.enabled = false;
    this.input.releasePointer();
    this._showHud(false);
    this._spawnLocal(0);
    this.ui.showResults({ mode: 'solo', score: this.score, best: personalBest(), res: [{ n: this.profile.name, s: this.score, me: true }] });
  }

  _hitLocal(dx, dz, h, up, who) {
    const L = this.local;
    if (!this.alive || this.deadT > 0 || L.invuln > 0 || this.phase !== 'run') return false;
    if (L.has('shield')) {
      L.clearEffect('shield');
      sfx.play('shield');
      this.world.ring(L.pos.x, L.pos.y + 0.8, L.pos.z, 0x6fd0ff, 3, 0.4);
      this.toast('🛡️ Bouclier brisé !', 'good');
      return false;
    }
    const l = Math.hypot(dx, dz) || 1;
    L.knock(dx / l, dz / l, h, up);
    sfx.play('hit');
    this.world.burst(L.pos.x, L.pos.y + 0.8, L.pos.z, 0xffffff, 14, 4, 3);
    if (who) this.toast(`💥 ${who} t’a envoyé valser !`, 'bad');
    return true;
  }

  _hazards(dt, nowS, t, r) {
    const L = this.local;
    this.barCd = Math.max(0, this.barCd - dt);
    // barres rotatives
    for (let i = Math.max(0, r - 1); i <= r + 3; i++) {
      const b = this.track.row(i).bar;
      if (!b || this.barCd > 0 || L.invuln > 0) continue;
      const th = this.world.barAngle(b, t);
      const ex = Math.cos(th) * b.r, ez = -Math.sin(th) * b.r;
      const y0 = b.y - 0.55;
      if (L.pos.y < y0 + 0.75 && L.pos.y + 1.5 > y0 + 0.3) {
        const d = distPointSeg(L.pos.x, L.pos.z, b.x - ex, b.z - ez, b.x + ex, b.z + ez);
        if (d < 0.6) {
          const rx = L.pos.x - b.x, rz = L.pos.z - b.z;
          const s = Math.sign(b.speed) || 1;
          if (this._hitLocal(rz * s, -rx * s, 11, 6, null)) this.barCd = 0.7;
          else this.barCd = 0.5;
        }
      }
    }
    // météores
    const ev = this.ev;
    if (ev && ev.type === 'meteor' && ev.phase === 'active' && this.alive && this.deadT <= 0) {
      this.meteorT -= dt;
      if (this.meteorT <= 0) {
        this.meteorT = 0.7 - 0.25 * Math.min(1, t / 200);
        this._spawnMeteor();
      }
    }
  }

  _spawnMeteor() {
    const L = this.local;
    let x, z, y;
    if (Math.random() < 0.55) {
      x = L.pos.x + L.vel.x * 0.9 + (Math.random() - 0.5) * 3;
      z = L.pos.z + L.vel.z * 0.9 + (Math.random() - 0.5) * 3;
      y = L.standing ? L.standing.top : L.pos.y;
    } else {
      const c = this.plats.filter((p) => p.solid && Math.abs(p.z - L.pos.z) < 16);
      if (!c.length) return;
      const p = c[(Math.random() * c.length) | 0];
      x = p.cx + (Math.random() - 0.5) * p.w * 0.8;
      z = p.z + (Math.random() - 0.5) * p.d * 0.8;
      y = p.top;
    }
    sfx.play('meteor');
    this.world.addMeteor(x, y, z, 1.25, (m) => {
      const d = Math.hypot(L.pos.x - m.x, L.pos.z - m.z);
      if (d < 3.4 && Math.abs(L.pos.y - m.y) < 2.6) this._hitLocal(L.pos.x - m.x + 0.001, L.pos.z - m.z, 13, 8, null);
    });
  }

  _checkPickups(r) {
    const L = this.local;
    if (this.inv || !this.alive || this.deadT > 0) return;
    for (let i = Math.max(0, r - 1); i <= r + 3; i++) {
      for (const pk of this.track.row(i).pickups) {
        if (this.taken.has(pk.id)) continue;
        const d = Math.hypot(L.pos.x - pk.x, L.pos.z - pk.z, L.pos.y + 0.75 - pk.y);
        if (d < 1.4) {
          this.taken.add(pk.id);
          this.world.takePickup(pk.id);
          if (this.net) this.net.broadcast({ t: 'pk', id: pk.id });
          const k = rollPower(this.remotes.size > 0);
          this.inv = k;
          sfx.play('pickup');
          this.toast(`🎁 ${POWERS[k].icon} ${POWERS[k].name} — ${this.input.isTouch ? 'touche ⚡' : 'appuie sur E'}`, 'good');
          return;
        }
      }
    }
  }

  _diveHits(now) {
    const L = this.local;
    if (L.diveT <= 0) return;
    for (const rm of this.remotes.values()) {
      if (!rm.has || !rm.alive || (rm.flags & 16) || now < rm.hitCd) continue;
      const dx = rm.pos.x - L.pos.x, dz = rm.pos.z - L.pos.z, dy = rm.pos.y - L.pos.y;
      if (Math.hypot(dx, dz) < 1.05 && Math.abs(dy) < 1.4) {
        rm.hitCd = now + 700;
        this.net.send(rm.id, { t: 'hit', dx, dz });
        L.vel.x *= 0.35; L.vel.z *= 0.35;
        this.world.burst(rm.pos.x, rm.pos.y + 0.8, rm.pos.z, 0xffffff, 10, 3, 2);
        sfx.play('hit');
      }
    }
  }

  _bumps() {
    const L = this.local;
    for (const rm of this.remotes.values()) {
      if (!rm.has || (rm.flags & 16) || !rm.alive) continue;
      const dx = L.pos.x - rm.pos.x, dz = L.pos.z - rm.pos.z;
      if (Math.abs(L.pos.y - rm.pos.y) > 1.3) continue;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 && d > 0.0001) {
        const push = (0.7 - d) * 0.5;
        L.pos.x += (dx / d) * push; L.pos.z += (dz / d) * push;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Événements                                                          */
  /* ------------------------------------------------------------------ */
  _handleEvent(ev, dt) {
    const key = ev ? ev.k + ev.phase : '';
    if (key !== this.evKey) {
      this.evKey = key;
      this.world.setEnv(ev);
      if (ev) {
        const info = EVENT_INFO[ev.type];
        if (ev.phase === 'warn') { this.toast(`⚠️ ${info.icon} ${info.name} dans 3 s !`, 'bad'); sfx.play('warn'); }
        else { this.toast(`${info.icon} ${info.name} ! ${info.desc}`, 'bad'); this.meteorT = 0.5; }
      }
    }
    this.ev = ev;
    if (ev && ev.type === 'quake' && ev.phase === 'active') {
      this.quakeAcc = (this.quakeAcc || 0) + dt;
      if (this.quakeAcc > 1.2) { this.quakeAcc = 0; this.world.shake = Math.max(this.world.shake, 0.3); }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Pouvoirs                                                            */
  /* ------------------------------------------------------------------ */
  usePower() {
    const k = this.inv;
    const L = this.local;
    if (!k || this.phase !== 'run' || !this.alive || this.deadT > 0) return;
    const P = POWERS[k];
    const nowS = performance.now() / 1000;
    if (P.kind === 'buff') {
      L.addEffect(k, P.dur);
      if (k === 'fly') { L.vel.y = Math.max(L.vel.y, 4); L.grounded = false; L.standing = null; }
      this.inv = null;
      sfx.play('power');
      this.world.ring(L.pos.x, L.pos.y, L.pos.z, 0xffd23f, 3, 0.5);
      this.toast(`${P.icon} ${P.name} activé !`, 'good');
      return;
    }
    const msg = { t: 'pw', k, x: +L.pos.x.toFixed(2), y: +L.pos.y.toFixed(2), z: +L.pos.z.toFixed(2) };
    if (k === 'tremor') {
      let best = null, bd = TREMOR_RANGE;
      for (const rm of this.remotes.values()) {
        if (!rm.has || !rm.alive || (rm.flags & 16)) continue;
        const d = Math.hypot(rm.pos.x - L.pos.x, rm.pos.z - L.pos.z);
        if (d < bd) { bd = d; best = rm; }
      }
      if (!best) { this.toast('Aucun adversaire à portée', 'bad'); return; }
      msg.tx = +best.pos.x.toFixed(2); msg.tz = +best.pos.z.toFixed(2);
      this.world.triggerNear(msg.tx, msg.tz, TREMOR_RADIUS, nowS, { x: L.pos.x, z: L.pos.z });
    }
    this.inv = null;
    if (this.net) this.net.broadcast(msg);
    this._attackVfx(msg);
    sfx.play('power');
    this.toast(`${P.icon} ${P.name} !`, 'good');
  }

  _attackVfx(m) {
    const col = { shock: 0xff7a3d, freeze: 0x7fd8ff, confuse: 0xc77dff, tremor: 0xb5651d }[m.k] || 0xffffff;
    const rad = m.k === 'tremor' ? TREMOR_RADIUS : ATTACK_RADIUS[m.k] || 8;
    if (m.k === 'tremor') this.world.ring(m.tx, m.y, m.tz, col, rad, 0.8);
    else this.world.ring(m.x, m.y, m.z, col, rad, 0.7);
    this.world.burst(m.x, m.y + 0.8, m.z, col, 24, 7, 4);
  }

  _onAttack(from, m) {
    const rm = this.remotes.get(from);
    const who = rm ? rm.name : 'Un joueur';
    const k = m.k;
    if (!POWERS[k] || POWERS[k].kind !== 'attack') return;
    const x = num(m.x), y = num(m.y), z = num(m.z);
    this._attackVfx({ k, x, y, z, tx: num(m.tx), tz: num(m.tz) });
    sfx.play('power');
    if (this.phase !== 'run') return;
    const L = this.local;
    if (k === 'tremor') {
      this.world.triggerNear(num(m.tx), num(m.tz), TREMOR_RADIUS, performance.now() / 1000);
      return;
    }
    if (!this.alive || this.deadT > 0 || L.invuln > 0) return;
    const d = Math.hypot(L.pos.x - x, L.pos.z - z, (L.pos.y - y) * 0.5);
    if (d > ATTACK_RADIUS[k]) return;
    if (k === 'shock') {
      this._hitLocal(L.pos.x - x + (Math.random() - 0.5) * 0.01, L.pos.z - z, 15, 10, who);
    } else if (L.has('shield')) {
      L.clearEffect('shield'); sfx.play('shield'); this.toast('🛡️ Bouclier brisé !', 'good');
    } else if (k === 'freeze') {
      L.freeze(2.5); sfx.play('hit'); this.toast(`🧊 ${who} t’a gelé !`, 'bad');
    } else if (k === 'confuse') {
      L.confusedT = 6; sfx.play('hit'); this.toast(`🌀 ${who} a inversé tes commandes !`, 'bad');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Caméra & modèles                                                    */
  /* ------------------------------------------------------------------ */
  _specTarget() {
    if (this.alive) return null;
    let rm = this.specId ? this.remotes.get(this.specId) : null;
    if (!rm || !rm.alive || !rm.has) {
      rm = null;
      for (const r of this.remotes.values()) if (r.alive && r.has && (!rm || r.score > rm.score)) rm = r;
      this.specId = rm ? rm.id : null;
    }
    return rm;
  }

  _updateCamera(dt, now, inp) {
    const c = this.cam, L = this.local;
    let fx = L.pos.x, fy = L.pos.y, fz = L.pos.z;
    const spec = this.mode === 'multi' ? this._specTarget() : null;
    if (inp.cycle && !this.alive && this.mode === 'multi') {
      const list = [...this.remotes.values()].filter((r) => r.alive && r.has);
      if (list.length) {
        const i = list.findIndex((r) => r.id === this.specId);
        this.specId = list[(i + 1) % list.length].id;
      }
    }
    if (spec) { fx = spec.pos.x; fy = spec.pos.y; fz = spec.pos.z; }
    else if (!this.alive || this.deadT > 0) { fy = Math.max(fy, L.lastGroundY - 5); }
    // recentrage automatique si le joueur ne touche plus à la caméra
    if (now - this.input.lastLookT > 2500 && (L.speedH > 2 || spec)) {
      const diff = Math.atan2(Math.sin(-c.yaw), Math.cos(-c.yaw));
      c.yaw += diff * Math.min(1, dt * 0.7);
    }
    c.ty += (fy + 1.1 - c.ty) * Math.min(1, dt * 6);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    this._look.set(fx, c.ty, fz);
    this._camPos.set(fx + Math.sin(c.yaw) * cp * c.dist, c.ty + sp * c.dist, fz + Math.cos(c.yaw) * cp * c.dist);
    this._focus.set(fx, fy, fz);
  }

  _updateLocalModel(dt, idle, camYaw) {
    const L = this.local, m = this.localModel;
    const visible = idle ? true : this.alive && this.deadT <= 0;
    const blink = L.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0 && this.phase === 'run';
    m.root.visible = visible && !blink;
    m.root.position.copy(L.pos);
    const lat = L.vel.x * Math.cos(camYaw) - L.vel.z * Math.sin(camYaw);
    if (idle && !m.isVoxel) m.root.rotation.y = camYaw; // au menu, le personnage fait face à la caméra
    m.update(dt, {
      speed: L.speedH, vy: L.vel.y, grounded: L.grounded || idle, flying: L.has('fly'), frozen: L.frozenT > 0,
      shield: L.has('shield'), moveYaw: L.moveYaw, lateral: lat,
    }, camYaw);
    if (L.has('fly') && Math.random() < 0.5) this.world.burst(L.pos.x, L.pos.y + 0.1, L.pos.z, 0xbfe9ff, 1, 1, -1);
    if (L.has('speed') && L.speedH > 4 && Math.random() < 0.5) this.world.burst(L.pos.x, L.pos.y + 0.2, L.pos.z, 0xffe36e, 1, 1, 0.5);
  }

  _updateRemotes(dt, now, camYaw, idle = false) {
    for (const rm of this.remotes.values()) {
      if (!rm.has) continue;
      const k = 1 - Math.exp(-dt * 14);
      rm.prev.copy(rm.pos);
      if (rm.pos.distanceTo(rm.target) > 14) rm.pos.copy(rm.target);
      else rm.pos.lerp(rm.target, k);
      const hx = (rm.pos.x - rm.prev.x) / Math.max(dt, 0.001), hz = (rm.pos.z - rm.prev.z) / Math.max(dt, 0.001);
      const sp = Math.hypot(hx, hz);
      rm.speed += (Math.min(sp, 14) - rm.speed) * Math.min(1, dt * 8);
      rm.vy += ((rm.pos.y - rm.prev.y) / Math.max(dt, 0.001) - rm.vy) * Math.min(1, dt * 8);
      const hidden = (rm.flags & 16) || (this.phase === 'run' && !rm.alive);
      rm.model.root.visible = !hidden;
      rm.model.root.position.copy(rm.pos);
      if (!hidden) {
        if (idle && !rm.model.isVoxel) rm.model.root.rotation.y = camYaw;
        rm.model.update(dt, {
          speed: rm.speed, vy: rm.vy, grounded: !!(rm.flags & 8), flying: !!(rm.flags & 4), frozen: !!(rm.flags & 2),
          shield: !!(rm.flags & 1), moveYaw: rm.yaw, lateral: hx * Math.cos(camYaw) - hz * Math.sin(camYaw),
        }, camYaw);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  HUD                                                                 */
  /* ------------------------------------------------------------------ */
  _center(txt) {
    const el = $('hud-center');
    el.innerHTML = txt ? `<span class="pop">${txt}</span>` : '';
  }

  toast(msg, cls = '') {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 3200);
  }

  _setText(id, v) { const el = $(id); if (el.textContent !== v) el.textContent = v; }

  _updateHud(ev, t) {
    const L = this.local;
    this._setText('dist', String(this.score));
    this._setText('hud-lives', '❤️'.repeat(Math.max(0, this.lives)) + '🖤'.repeat(Math.max(0, MAX_LIVES - this.lives)));
    this._setText('best', String(Math.max(this.best, this.score)));
    // pouvoir
    const slot = $('power-slot');
    if (this.inv) {
      const P = POWERS[this.inv];
      slot.classList.remove('empty');
      this._setText('power-icon', P.icon);
      this._setText('power-name', P.name);
    } else {
      slot.classList.add('empty');
      this._setText('power-icon', '·');
      this._setText('power-name', 'Aucun pouvoir');
    }
    $('power-key').style.display = this.input.isTouch ? 'none' : '';
    // bonus actifs
    const parts = [];
    for (const [k, v] of Object.entries(L.effects)) if (POWERS[k]) parts.push(`<div class="buff">${POWERS[k].icon} ${Math.ceil(v)}s</div>`);
    if (L.frozenT > 0) parts.push('<div class="buff">🧊 Gelé</div>');
    if (L.confusedT > 0) parts.push('<div class="buff">🌀 Confus</div>');
    const bh = parts.join('');
    const bEl = $('hud-buffs');
    if (bEl.innerHTML !== bh) bEl.innerHTML = bh;
    // événement
    const evEl = $('hud-event');
    if (ev) {
      const info = EVENT_INFO[ev.type];
      evEl.classList.remove('hidden');
      evEl.classList.toggle('warn', ev.phase === 'warn');
      const h = ev.phase === 'warn' ? `⚠️ ${info.icon} ${info.name} dans ${Math.ceil(ev.tLeft)}…` : `${info.icon} ${info.name} · ${Math.ceil(ev.tLeft)}s<small>${info.desc}</small>`;
      if (evEl.innerHTML !== h) evEl.innerHTML = h;
    } else evEl.classList.add('hidden');
    // classement en direct
    const rankEl = $('hud-rank');
    if (this.mode === 'multi') {
      const list = this._standings();
      const top = list.slice(0, 5);
      if (!top.some((p) => p.me)) { const me = list.find((p) => p.me); if (me) top.push(me); }
      const h = top.map((p) => `<div class="rk ${p.me ? 'me' : ''} ${p.alive ? '' : 'out'}"><span>${p.rank}. ${esc(p.name)}</span><span>${p.score} m</span></div>`).join('');
      if (rankEl.innerHTML !== h) rankEl.innerHTML = h;
    } else if (rankEl.innerHTML) rankEl.innerHTML = '';
    // spectateur
    const sp = $('hud-spec');
    const spec = this.mode === 'multi' && !this.alive && this.phase === 'run' ? this._specTarget() : null;
    if (!this.alive && this.mode === 'multi' && this.phase === 'run') {
      sp.classList.remove('hidden');
      sp.textContent = spec ? `👁 Tu regardes ${spec.name} — ${this.input.isTouch ? 'saut' : 'Espace'} : changer` : 'En attente de la fin de la manche…';
    } else sp.classList.add('hidden');
    void t;
  }

  _standings() {
    const list = [{ id: 'me', name: this.profile.name, score: this.score, alive: this.alive, me: true }];
    for (const r of this.remotes.values()) list.push({ id: r.id, name: r.name, score: r.score, alive: r.alive, me: false });
    list.sort((a, b) => b.score - a.score || (b.alive ? 1 : 0) - (a.alive ? 1 : 0));
    list.forEach((p, i) => { p.rank = i + 1; });
    return list;
  }

  setLive(on) {
    this.liveOpen = !!on;
    $('live-board').classList.toggle('hidden', !on);
    if (on) { this.liveAcc = 1; this._renderLive(); }
  }

  _renderLive() {
    const el = $('live-board');
    let h = '<h4>Course en cours</h4>';
    h += this._standings().map((p) => `<div class="rk ${p.me ? 'me' : ''}"><span>${p.rank}. ${esc(p.name)}${p.alive ? '' : ' 💀'}</span><span>${p.score} m</span></div>`).join('');
    if (this.mode === 'multi' && this.session.size) {
      h += '<h4>Salle — cumul des manches</h4>';
      h += [...this.session.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([n, s]) => `<div class="rk"><span>${esc(n)} <small>(${s.rounds} manche${s.rounds > 1 ? 's' : ''})</small></span><span>${s.total} m · max ${s.best}</span></div>`).join('');
    }
    h += '<h4>Meilleurs scores (cet appareil)</h4>';
    h += loadScores().slice(0, 5).map((s, i) => `<div class="rk"><span>${i + 1}. ${esc(s.name)}</span><span>${s.score} m</span></div>`).join('') || '<div class="rk"><span>—</span></div>';
    el.innerHTML = h;
  }

  /* ------------------------------------------------------------------ */
  /*  Pause / sons                                                        */
  /* ------------------------------------------------------------------ */
  togglePause() {
    if (this.phase !== 'run' && this.phase !== 'countdown') return;
    if (this.paused || this.ui.current === 'pause') this.resume(); else this.openPause();
  }

  openPause() {
    if (this.paused) return;
    this.paused = true;
    this.pauseStart = performance.now();
    this.input.enabled = false;
    this.input.releasePointer();
    this.ui.openPause(this.mode);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.mode === 'solo') this.round.startMs += performance.now() - this.pauseStart; // le temps de manche est gelé en solo
    this.input.enabled = true;
    this.input.clearEdges();
    this.ui.screen(null);
  }

  toggleMute() { sfx.unlock(); sfx.setMuted(!sfx.isMuted()); this.refreshMuteUI(); }
  refreshMuteUI() {
    $('btn-mute').textContent = sfx.isMuted() ? '🔇' : '🔊';
    const pm = $('pause-mute');
    if (pm) pm.textContent = sfx.isMuted() ? '🔇 Son coupé' : '🔊 Son activé';
  }

  toMenu() {
    this.leaveNet();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.paused = false;
    this.setLive(false);
    this.input.releasePointer();
    this.enterMenuScene();
    this.ui.screen('main');
  }

  /* ------------------------------------------------------------------ */
  /*  Réseau                                                              */
  /* ------------------------------------------------------------------ */
  _makeNet() {
    const g = this;
    return new Net({
      getProfile: () => ({ name: g.profile.name, avatar: g.profile.avatar }),
      getSync: () => g._getSync(),
      onWelcome: (sync) => g._onWelcome(sync),
      onPeer: (id, info) => g._onPeer(id, info),
      onLeave: (id, rec) => g._onLeave(id, rec),
      onMsg: (id, m) => g._onMsg(id, m),
      onHostChange: (isHost) => g._onHostChange(isHost),
      onStatus: (s) => g.ui.netStatus(s),
    });
  }

  async createRoom() {
    this.leaveNet();
    const net = this._makeNet();
    this.net = net;
    this.mode = 'multi';
    try {
      const code = await net.host();
      this._clearRemotes();
      this.round.no = 0;
      this.session.clear();
      this.enterLobby();
      return code;
    } catch (e) {
      this.leaveNet();
      throw e;
    }
  }

  async joinRoom(code) {
    this.leaveNet();
    const net = this._makeNet();
    this.net = net;
    this.mode = 'multi';
    this._clearRemotes();
    this.session.clear();
    try {
      await net.join(code);
      this.ui.refreshLobby();
    } catch (e) {
      this.leaveNet();
      this.mode = 'solo';
      throw e;
    }
  }

  leaveNet() {
    if (this.net) { this.net.leave(); this.net = null; }
    this._clearRemotes();
    this.mode = 'solo';
  }

  _clearRemotes() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }

  _getSync() {
    return {
      phase: this.phase,
      seed: this.round.seed,
      n: this.round.no,
      elapsed: Math.round(performance.now() - this.round.startMs),
      taken: [...this.taken].slice(-300),
    };
  }

  _onWelcome(sync) {
    this.round.no = sync && typeof sync.n === 'number' ? sync.n : 0;
    if (sync && (sync.phase === 'run' || sync.phase === 'countdown') && Number.isFinite(sync.seed) && Number.isFinite(sync.elapsed)) {
      this.startRound(sync.seed >>> 0, -sync.elapsed - this.net.rtt(this.net.connectedIds[0]) / 2, this.round.no);
      for (const id of sync.taken || []) if (typeof id === 'string' && OK_PK.test(id)) { this.taken.add(id); this.world.takePickup(id); }
      this.toast('Course en cours : tu rejoins la partie !', 'good');
    } else {
      this.enterLobby();
    }
  }

  _onPeer(id, info) {
    if (this.remotes.has(id)) return;
    const rm = new Remote(id, info.profile, this.world);
    this.remotes.set(id, rm);
    this.toast(`👋 ${rm.name} a rejoint la salle`, 'good');
    if (this.phase === 'lobby' || this.phase === 'over') {
      if (this.phase === 'lobby') this._spawnLocal(0);
      this.ui.refreshLobby();
    }
    this.sendPos(true);
  }

  _onLeave(id) {
    const rm = this.remotes.get(id);
    if (!rm) return;
    rm.dispose();
    this.remotes.delete(id);
    this.toast(`${rm.name} a quitté la salle`, '');
    if (this.specId === id) this.specId = null;
    this.ui.refreshLobby();
  }

  _onHostChange(isHost) {
    if (isHost) this.toast('👑 Tu es maintenant l’hôte de la salle', 'good');
    this.ui.refreshLobby();
  }

  sendPos(force) {
    if (!this.net || this.phase === 'menu') return;
    void force;
    const L = this.local;
    let f = 0;
    if (L.has('shield')) f |= 1;
    if (L.frozenT > 0) f |= 2;
    if (L.has('fly')) f |= 4;
    if (L.grounded) f |= 8;
    if (!this.alive || this.deadT > 0) f |= 16;
    if (document.hidden) f |= 32;
    this.net.broadcast({
      t: 'p', n: this.round.no,
      x: +L.pos.x.toFixed(2), y: +L.pos.y.toFixed(2), z: +L.pos.z.toFixed(2),
      r: +L.moveYaw.toFixed(2), f, s: this.score, l: this.lives, a: this.alive ? 1 : 0,
    });
  }

  _onMsg(from, m) {
    const rm = this.remotes.get(from);
    const nowS = performance.now() / 1000;
    switch (m.t) {
      case 'p': {
        if (!rm) return;
        const x = num(m.x), y = num(m.y), z = num(m.z);
        rm.target.set(x, y, z);
        if (!rm.has) { rm.pos.copy(rm.target); rm.has = true; }
        rm.yaw = num(m.r); rm.flags = num(m.f) | 0;
        if (m.n === this.round.no) {
          rm.score = clamp(num(m.s) | 0, 0, 1e7); rm.lives = clamp(num(m.l) | 0, 0, 9); rm.alive = !!m.a;
        }
        rm.awaySince = rm.flags & 32 ? rm.awaySince || performance.now() : 0;
        break;
      }
      case 'prof':
        if (rm && m.p) {
          rm.name = cleanName(m.p.name);
          rm.avatar = sanitizeAvatar(m.p.avatar);
          const old = rm.model;
          rm.model = new AvatarModel(rm.avatar, rm.name, true);
          this.world.scene.add(rm.model.root);
          old.dispose();
          this.ui.refreshLobby();
        }
        break;
      case 'tg': {
        if (typeof m.id !== 'string' || !OK_ID.test(m.id) || !this.track) return;
        if (parseInt(m.id, 10) > 50000) return;
        const p = this.track.platformById(m.id);
        if (p) this.world.triggerPlat(p, nowS, !!m.q);
        break;
      }
      case 'pk':
        if (typeof m.id === 'string' && OK_PK.test(m.id)) { this.taken.add(m.id); this.world.takePickup(m.id); }
        break;
      case 'pw': this._onAttack(from, m); break;
      case 'hit':
        if (rm) this._hitLocal(num(m.dx), num(m.dz), 11, 6.5, rm.name);
        break;
      case 'start': {
        const n = m.n | 0;
        if (n <= this.round.no || !Number.isFinite(m.seed)) return;
        this.startRound(m.seed >>> 0, num(m.in, COUNTDOWN_MS) - this.net.rtt(from) / 2, n);
        break;
      }
      case 'over': {
        if ((m.n | 0) !== this.round.no || (this.phase !== 'run' && this.phase !== 'countdown')) return;
        this._enterOver(Array.isArray(m.res) ? m.res : []);
        break;
      }
      default: break;
    }
  }

  /* ---- fin de manche multi ---- */
  _hostCheckEnd(now) {
    if (!this.net || !this.net.isHost() || this.phase !== 'run') return;
    if (this.alive) return;
    for (const r of this.remotes.values()) {
      const away = r.awaySince && now - r.awaySince > 20000;
      if (r.alive && !away) return;
    }
    const res = this._collectResults();
    this.net.broadcast({ t: 'over', n: this.round.no, res });
    this._enterOver(res);
  }

  _collectResults() {
    const res = [{ n: this.profile.name, s: this.score }];
    for (const r of this.remotes.values()) res.push({ n: r.name, s: r.score });
    res.sort((a, b) => b.s - a.s);
    return res.slice(0, 16);
  }

  _enterOver(resIn) {
    // les entrées reçues sont du texte non fiable : on les nettoie
    const res = resIn.slice(0, 16).map((e) => ({ n: cleanName(e && e.n), s: clamp(num(e && e.s) | 0, 0, 1e7) })).sort((a, b) => b.s - a.s);
    if (this.alive) {
      // je n'avais pas fini : mon score compte quand même
      this.alive = false;
      const entry = addLocalScore({ name: this.profile.name, score: this.score, mode: 'multi', players: this.remotes.size + 1 });
      submitGlobal(entry);
    }
    for (const e of res) {
      const s = this.session.get(e.n) || { best: 0, total: 0, rounds: 0 };
      s.best = Math.max(s.best, e.s); s.total += e.s; s.rounds++;
      this.session.set(e.n, s);
    }
    this.phase = 'over';
    this.overAt = performance.now();
    this.input.enabled = false;
    this.input.releasePointer();
    this._showHud(false);
    this.best = personalBest();
    // mon rang
    res.forEach((e, i) => { e.rank = i + 1; });
    const mine = res.findIndex((e) => e.n === this.profile.name && e.s === this.score);
    if (mine >= 0) res[mine].me = true;
    this._spawnLocal(0);
    this.ui.showResults({ mode: 'multi', score: this.score, best: this.best, res });
  }

  hostStart() {
    if (!this.net || !this.net.isHost()) return;
    if (this.phase !== 'lobby' && this.phase !== 'over') return;
    const n = this.round.no + 1;
    const seed = rnd32();
    this.net.broadcast({ t: 'start', seed, in: COUNTDOWN_MS, n });
    this.startRound(seed, COUNTDOWN_MS, n);
  }

  isHost() { return !!(this.net && this.net.isHost()); }

  lobbyPlayers() {
    const list = [{ id: 'me', name: this.profile.name, me: true, order: this.net ? this.net.myOrder : 0, ping: 0 }];
    if (this.net) for (const [id, r] of this.remotes) { const p = this.net.peers.get(id); list.push({ id, name: r.name, me: false, order: p ? p.order : 99, ping: Math.round(this.net.rtt(id)) }); }
    list.sort((a, b) => a.order - b.order);
    return list;
  }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
