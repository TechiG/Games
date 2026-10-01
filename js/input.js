// Entrées : clavier (touches physiques : ZQSD/WASD/flèches), souris, tactile, manette.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false; // le jeu consomme les entrées
    this.keys = new Set();
    this.look = { x: 0, y: 0 };
    this.edge = { jump: false, dive: false, power: false, cycle: false };
    this.zoom = 0;
    this.touchMove = { x: 0, y: 0 };
    this.touchHeld = { jump: false, dive: false };
    this.scoreHeld = false;
    this.lastLookT = 0;
    this.dragging = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.onPause = null;
    this.onScore = null;
    this._bind();
  }

  _typing(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (this._typing(e)) return;
      if (e.code === 'Escape') { if (this.onPause) this.onPause(); return; }
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') { this.edge.jump = true; this.edge.cycle = true; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyF') this.edge.dive = true;
      if (e.code === 'KeyE' || e.code === 'Enter') this.edge.power = true;
      if (e.code === 'Tab') { this.scoreHeld = true; if (this.onScore) this.onScore(true); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') { this.scoreHeld = false; if (this.onScore) this.onScore(false); }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.touchHeld.jump = false; });

    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button > 2) return;
      this.dragging = true;
      if (!this.isTouch && document.pointerLockElement !== c && c.requestPointerLock) {
        try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* */ }
      }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      const locked = document.pointerLockElement === c;
      if (locked || this.dragging) {
        this.look.x += e.movementX || 0;
        this.look.y += e.movementY || 0;
        this.lastLookT = performance.now();
      }
    });
    c.addEventListener('wheel', (e) => { if (this.enabled) { this.zoom += Math.sign(e.deltaY); e.preventDefault(); } }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    if (this.isTouch) this._bindTouch();
  }

  releasePointer() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    this.dragging = false;
  }

  _bindTouch() {
    const joy = document.getElementById('joy');
    const knob = document.getElementById('joy-knob');
    let joyId = null, lookId = null, jx = 0, jy = 0, lx = 0, ly = 0;
    const R = 55;
    const area = document.getElementById('touch');
    area.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.target.closest && t.target.closest('.tbtn')) continue;
        if (t.clientX < window.innerWidth * 0.5 && joyId === null) {
          joyId = t.identifier; jx = t.clientX; jy = t.clientY;
          joy.style.display = 'block';
          joy.style.left = jx - 70 + 'px'; joy.style.top = jy - 70 + 'px';
          knob.style.transform = 'translate(0px,0px)';
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    area.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) {
          let dx = t.clientX - jx, dy = t.clientY - jy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
          knob.style.transform = `translate(${dx}px,${dy}px)`;
          this.touchMove.x = dx / R; this.touchMove.y = -dy / R;
        } else if (t.identifier === lookId) {
          this.look.x += (t.clientX - lx) * 1.4; this.look.y += (t.clientY - ly) * 1.4;
          lx = t.clientX; ly = t.clientY;
          this.lastLookT = performance.now();
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) { joyId = null; this.touchMove.x = 0; this.touchMove.y = 0; joy.style.display = 'none'; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    area.addEventListener('touchend', end);
    area.addEventListener('touchcancel', end);

    const bind = (id, down, up) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { down(); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      el.addEventListener('touchend', (e) => { if (up) up(); e.preventDefault(); e.stopPropagation(); }, { passive: false });
      el.addEventListener('touchcancel', () => { if (up) up(); });
    };
    bind('btn-jump', () => { this.edge.jump = true; this.edge.cycle = true; this.touchHeld.jump = true; }, () => { this.touchHeld.jump = false; });
    bind('btn-dive', () => { this.edge.dive = true; this.touchHeld.dive = true; }, () => { this.touchHeld.dive = false; });
    bind('btn-power', () => { this.edge.power = true; });
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected) return p;
    }
    return null;
  }

  // Retourne l'état d'entrée de cette image. Les « edge » sont consommés.
  poll() {
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let jumpHeld = k.has('Space') || this.touchHeld.jump;
    let descend = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyF') || this.touchHeld.dive;
    mx += this.touchMove.x; my += this.touchMove.y;
    const pad = this._pad();
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      mx += dz(pad.axes[0] || 0); my += -dz(pad.axes[1] || 0);
      this.look.x += dz(pad.axes[2] || 0) * 14; this.look.y += dz(pad.axes[3] || 0) * 10;
      const b = (i) => pad.buttons[i] && pad.buttons[i].pressed;
      const pj = b(0), pd = b(2) || b(5), pp = b(1) || b(3) || b(7);
      if (pj && !this._pj) { this.edge.jump = true; this.edge.cycle = true; }
      if (pd && !this._pd) this.edge.dive = true;
      if (pp && !this._pp) this.edge.power = true;
      this._pj = pj; this._pd = pd; this._pp = pp;
      jumpHeld = jumpHeld || pj; descend = descend || pd;
    }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const out = { mx, my, jump: this.edge.jump, jumpHeld, dive: this.edge.dive, power: this.edge.power, cycle: this.edge.cycle, descend };
    this.edge.jump = this.edge.dive = this.edge.power = this.edge.cycle = false;
    return out;
  }

  takeLook() { const l = { x: this.look.x, y: this.look.y }; this.look.x = this.look.y = 0; return l; }
  takeZoom() { const z = this.zoom; this.zoom = 0; return z; }
  clearEdges() { this.edge.jump = this.edge.dive = this.edge.power = this.edge.cycle = false; }
}
