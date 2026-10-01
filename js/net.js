// Multijoueur pair-à-pair (WebRTC via PeerJS) : aucun serveur de jeu à héberger.
// Maillage complet : chaque joueur est relié à tous les autres.
// Le créateur de la salle est l'hôte initial ; si il part, le joueur arrivé le plus tôt prend le relais.
import { CONFIG } from './config.js';

const PREFIX = 'trush-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randStr = (n, chars = CODE_CHARS) => Array.from({ length: n }, () => chars[(Math.random() * chars.length) | 0]).join('');

export const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

function peerOptions() {
  const o = { debug: 1 };
  const p = CONFIG.peer || {};
  const q = new URLSearchParams(location.search);
  const host = q.get('peerhost') || p.host;
  if (host) {
    o.host = host;
    o.port = Number(q.get('peerport') || p.port || 443);
    o.path = q.get('peerpath') || p.path || '/';
    o.secure = q.has('peersecure') ? q.get('peersecure') === '1' : p.secure !== undefined ? p.secure : o.port === 443;
  }
  if (p.key) o.key = p.key;
  if (p.iceServers && p.iceServers.length) {
    o.config = { iceServers: p.iceServers, sdpSemantics: 'unified-plan' };
  }
  return o;
}

export class Net {
  // h : { onPeer(id, info), onLeave(id), onMsg(id, msg), onStatus(text), onHostChange(), getProfile(), getSync() }
  constructor(h) {
    this.h = h;
    this.peer = null;
    this.peers = new Map(); // id -> {conn, order, profile, lastSeen, rtt, ready}
    this.myId = null;
    this.myOrder = -1;
    this.code = '';
    this.nextOrder = 1;
    this.closed = false;
    this.wasHost = false;
    this._hb = null;
    this.pending = new Set(); // pairs annoncés dont la poignée de main n'est pas terminée
    this._unload = () => this.leave();
    window.addEventListener('pagehide', this._unload);
  }

  get count() { return this.peers.size; }
  get connectedIds() { return [...this.peers.keys()]; }

  isHost() {
    if (this.myOrder < 0 || this.pending.size > 0) return false;
    for (const p of this.peers.values()) if (p.ready && p.order >= 0 && p.order < this.myOrder) return false;
    return true;
  }

  rtt(id) { const p = this.peers.get(id); return p && p.rtt ? p.rtt : 80; }

  /* ---------- création / connexion ---------- */
  host() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        tries++;
        const code = randStr(5);
        this._newPeer(PREFIX + code, (err) => {
          if (!err) {
            this.code = code; this.myOrder = 0; this.nextOrder = 1;
            this.wasHost = true;
            this._startHb();
            resolve(code);
          } else if (err.type === 'unavailable-id' && tries < 6) { this._destroyPeer(); attempt(); }
          else { this._destroyPeer(); reject(this._explain(err)); }
        });
      };
      attempt();
    });
  }

  join(codeRaw) {
    const code = normalizeCode(codeRaw);
    return new Promise((resolve, reject) => {
      if (code.length < 4) { reject(new Error('Code de salle invalide')); return; }
      let done = false;
      const fail = (e) => { if (done) return; done = true; clearTimeout(timer); this._destroyPeer(); reject(e && e.type ? this._explain(e) : e instanceof Error ? e : this._explain(e)); };
      const ok = () => { if (done) return; done = true; clearTimeout(timer); resolve(code); };
      const timer = setTimeout(() => fail(new Error('Connexion impossible (délai dépassé). Vérifie le code et ta connexion.')), 20000);
      this._joinResolve = ok; this._joinFail = fail;
      this._newPeer(PREFIX + code + '-' + randStr(6, 'abcdefghjkmnpqrstuvwxyz23456789'), (err) => {
        if (err) { fail(err); return; }
        this.code = code;
        const conn = this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this._hookConn(conn, true);
      });
    });
  }

  _newPeer(id, cb) {
    const Peer = window.Peer;
    if (!Peer) { cb({ type: 'no-lib' }); return; }
    let called = false;
    const once = (e) => { if (called) return; called = true; cb(e); };
    try {
      this.peer = new Peer(id, peerOptions());
    } catch (e) { once({ type: 'init', message: String(e) }); return; }
    this.peer.on('open', (pid) => { this.myId = pid; once(null); });
    this.peer.on('connection', (conn) => this._hookConn(conn, false));
    this.peer.on('error', (e) => {
      if (!called) { once(e); return; }
      if (e.type === 'peer-unavailable') { if (this._joinFail) this._joinFail(e); return; }
      if (this.h.onStatus) this.h.onStatus('Réseau : ' + (e.message || e.type));
    });
    this.peer.on('disconnected', () => {
      // perte du serveur de signalisation : les connexions établies continuent de fonctionner
      if (!this.closed && this.peer && !this.peer.destroyed) { try { this.peer.reconnect(); } catch { /* ignore */ } }
    });
  }

  _explain(e) {
    const t = e && e.type;
    const map = {
      'peer-unavailable': 'Salle introuvable. Vérifie le code.',
      'network': 'Impossible de joindre le serveur de mise en relation (réseau).',
      'server-error': 'Le serveur de mise en relation ne répond pas.',
      'socket-error': 'Le serveur de mise en relation est injoignable.',
      'socket-closed': 'Connexion au serveur de mise en relation interrompue.',
      'browser-incompatible': 'Ton navigateur ne gère pas WebRTC.',
      'unavailable-id': 'Code de salle déjà utilisé.',
      'no-lib': 'La bibliothèque réseau n’est pas chargée.',
    };
    return new Error(map[t] || 'Erreur réseau' + (e && e.message ? ' : ' + e.message : ''));
  }

  _destroyPeer() {
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.peer = null;
  }

  /* ---------- connexions ---------- */
  _hookConn(conn, outgoingToHost) {
    let rec = null;
    const onOpen = () => {
      if (this.closed) { try { conn.close(); } catch { /* */ } return; }
      if (this.peers.has(conn.peer) && this.peers.get(conn.peer).conn !== conn) { try { conn.close(); } catch { /* */ } return; }
      rec = { conn, order: -1, profile: null, lastSeen: performance.now(), rtt: 0, ready: false, id: conn.peer };
      this.peers.set(conn.peer, rec);
      if (outgoingToHost && conn.peer === PREFIX + this.code) rec.isRoomHost = true;
      // un invité qui se connecte à l'hôte reçoit son ordre via « welcome »
      if (!outgoingToHost && this.myOrder === 0 && conn.peer.startsWith(PREFIX + this.code + '-')) {
        rec.order = this.nextOrder++;
        const list = [...this.peers.values()].filter((p) => p.ready && p !== rec).map((p) => ({ id: p.id, order: p.order }));
        this._send(conn, { t: 'welcome', order: rec.order, hostOrder: 0, peers: list, sync: this.h.getSync ? this.h.getSync() : null });
      }
      this._send(conn, { t: 'hi', order: this.myOrder, p: this.h.getProfile ? this.h.getProfile() : null });
    };
    conn.on('open', onOpen);
    conn.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      let r = rec || this.peers.get(conn.peer);
      if (!r) return;
      r.lastSeen = performance.now();
      this._onData(r, d);
    });
    const gone = () => { if (rec) this._drop(rec.id, rec.conn); else if (outgoingToHost && this._joinFail) this._joinFail(new Error('Connexion refusée')); };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  _send(conn, msg) { try { if (conn.open) conn.send(msg); } catch { /* ignore */ } }

  send(id, msg) { const p = this.peers.get(id); if (p && p.ready) this._send(p.conn, msg); }

  broadcast(msg) { for (const p of this.peers.values()) if (p.ready) this._send(p.conn, msg); }

  _onData(r, d) {
    switch (d.t) {
      case 'welcome': {
        if (this.myOrder >= 0) return; // une seule fois
        this.myOrder = d.order | 0;
        r.order = d.hostOrder | 0;
        // se relier à tous les autres joueurs déjà présents
        this.pending.add(r.id);
        for (const o of d.peers || []) {
          if (typeof o.id !== 'string' || !o.id.startsWith(PREFIX + this.code) || this.peers.has(o.id) || o.id === this.myId) continue;
          this.pending.add(o.id);
          const c = this.peer.connect(o.id, { reliable: true, serialization: 'json' });
          this._hookConn(c, false);
        }
        setTimeout(() => { if (this.pending.size) { this.pending.clear(); this._checkHost(); } }, 10000);
        this._startHb();
        this.wasHost = this.isHost();
        this._pendingSync = d.sync || null;
        if (this._joinResolve) { const f = this._joinResolve; this._joinResolve = null; f(); }
        if (this.h.onWelcome) this.h.onWelcome(d.sync || null);
        break;
      }
      case 'hi': {
        if (typeof d.order === 'number' && d.order >= 0) r.order = d.order; // ne jamais écraser un ordre déjà attribué par -1
        const first = !r.ready;
        r.ready = true;
        this.pending.delete(r.id);
        r.profile = d.p || null;
        if (first) {
          this._checkHost();
          if (this.h.onPeer) this.h.onPeer(r.id, { order: r.order, profile: r.profile });
        }
        break;
      }
      case 'ping': this._send(r.conn, { t: 'pong', c: d.c }); break;
      case 'pong': r.rtt = Math.max(1, performance.now() - d.c); break;
      case 'bye': this._drop(r.id, r.conn); break;
      default:
        if (r.ready && this.h.onMsg) this.h.onMsg(r.id, d);
    }
  }

  _drop(id, conn) {
    const r = this.peers.get(id);
    if (!r || (conn && r.conn !== conn)) return;
    this.peers.delete(id);
    this.pending.delete(id);
    try { r.conn.close(); } catch { /* */ }
    if (r.ready && this.h.onLeave) this.h.onLeave(id, r);
    this._checkHost();
  }

  _checkHost() {
    const now = this.isHost();
    if (now !== this.wasHost) {
      this.wasHost = now;
      if (this.h.onHostChange) this.h.onHostChange(now);
    }
  }

  _startHb() {
    if (this._hb) return;
    this._hb = setInterval(() => {
      const now = performance.now();
      for (const p of [...this.peers.values()]) {
        if (now - p.lastSeen > 10000) { this._drop(p.id, p.conn); continue; }
        this._send(p.conn, { t: 'ping', c: now });
      }
    }, 2000);
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('pagehide', this._unload);
    clearInterval(this._hb);
    for (const p of this.peers.values()) {
      try { this._send(p.conn, { t: 'bye' }); } catch { /* */ }
    }
    const peer = this.peer;
    setTimeout(() => { try { peer && peer.destroy(); } catch { /* */ } }, 120);
    this.peers.clear();
    this.peer = null;
  }
}
