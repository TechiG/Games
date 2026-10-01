// Interface : écrans, éditeur de personnage, salon, résultats, scores.
import * as THREE from '../vendor/three.module.min.js';
import {
  AvatarModel, sanitizeAvatar, avatarFromText, randomAvatar, imageToVoxel, fetchAIImage,
  DEFAULT_BLOCKY, HAIR_STYLES, HATS, ACCS, FACES, BODIES, LABELS,
} from './avatar.js';
import { loadScores, cleanName, fetchGlobal, globalEnabled } from './scores.js';
import { sfx } from './audio.js';
import { esc } from './game.js';
import { normalizeCode } from './net.js';

const $ = (id) => document.getElementById(id);
const PROFILE_KEY = 'tumblerush.profile.v1';

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && typeof p === 'object') return { name: cleanName(p.name), avatar: sanitizeAvatar(p.avatar) };
  } catch { /* profil absent ou corrompu */ }
  return { name: 'Joueur' + (10 + Math.floor(Math.random() * 90)), avatar: sanitizeAvatar({ ...DEFAULT_BLOCKY, ...randomAvatar() }) };
}

function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* */ }
}

export const ui = {
  game: null,
  current: null,
  prev: 'main',

  isOpen() { return this.current !== null; },

  screen(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    const wrap = $('screens');
    if (!name) { wrap.classList.add('hidden'); this.current = null; this._stopPreview(); return; }
    wrap.classList.remove('hidden');
    $('scr-' + name).classList.remove('hidden');
    if (name !== 'avatar') this._stopPreview();
    this.current = name;
    if (name === 'main') $('in-name').value = this.game.profile.name;
  },

  netStatus(s) { const el = $('lobby-msg'); if (el && this.current === 'lobby') { el.className = 'status err'; el.textContent = s; } },

  /* ---------------- salon ---------------- */
  refreshLobby() {
    if (this.current !== 'lobby') return;
    const g = this.game;
    $('lobby-code').textContent = g.net ? g.net.code : '-----';
    const list = g.lobbyPlayers();
    const hostId = list.length ? list[0].id : null;
    $('lobby-players').innerHTML = list.map((p) => `<div class="pl ${p.me ? 'me' : ''}"><span>${p.id === hostId ? '👑' : '🏃'}</span><span class="nm">${esc(p.name)}${p.me ? ' (toi)' : ''}</span><span class="ping">${p.me ? '' : p.ping + ' ms'}</span></div>`).join('');
    const host = g.isHost();
    $('lobby-start').classList.toggle('hidden', !host);
    const msg = $('lobby-msg');
    msg.className = 'status';
    msg.textContent = host ? `${list.length} joueur${list.length > 1 ? 's' : ''} dans la salle — lance la course quand tout le monde est là !` : 'En attente du lancement par l’hôte…';
  },

  /* ---------------- résultats ---------------- */
  showResults(d) {
    this.screen('results');
    const solo = d.mode === 'solo';
    $('res-title').textContent = solo ? 'Course terminée !' : 'Fin de la manche';
    let h = '';
    if (solo) {
      const rec = d.score >= d.best && d.score > 0;
      h += `<div style="text-align:center;font-size:54px;font-weight:900;color:#2f8cff">${d.score} <small style="font-size:24px">m</small></div>`;
      h += `<div class="status ${rec ? 'ok' : ''}">${rec ? '🏆 Nouveau record !' : 'Record : ' + d.best + ' m'}</div>`;
      const top = loadScores().slice(0, 5);
      h += '<table class="tbl"><tr><th></th><th>Meilleurs scores</th><th class="num">Distance</th></tr>' + top.map((s, i) => `<tr><td><span class="medal">${medal(i)}</span></td><td>${esc(s.name)}</td><td class="num">${s.score} m</td></tr>`).join('') + '</table>';
    } else {
      h += '<table class="tbl"><tr><th></th><th>Joueur</th><th class="num">Distance</th></tr>' + d.res.map((e, i) => `<tr class="${e.me ? 'me' : ''}"><td><span class="medal">${medal(i)}</span></td><td>${esc(e.n)}${e.me ? ' (toi)' : ''}</td><td class="num">${e.s} m</td></tr>`).join('') + '</table>';
    }
    $('res-body').innerHTML = h;
    const again = $('res-again');
    if (solo) { again.classList.remove('hidden'); again.textContent = '↻ Rejouer'; $('res-msg').textContent = ''; }
    else {
      const host = this.game.isHost();
      again.classList.toggle('hidden', !host);
      again.textContent = '▶ Manche suivante';
      $('res-msg').className = 'status';
    }
  },

  setResultsCountdown(sec) {
    if (this.current !== 'results') return;
    const host = this.game.isHost();
    $('res-again').classList.toggle('hidden', !host);
    $('res-msg').textContent = `Prochaine manche dans ${sec} s…`;
  },

  /* ---------------- pause ---------------- */
  openPause(mode) {
    this.screen('pause');
    $('pause-note').textContent = mode === 'multi' ? 'En ligne, la partie continue pendant la pause !' : 'La partie est en pause.';
    $('sel-quality').value = this.game.world.quality;
    this.game.refreshMuteUI();
  },

  /* ---------------- scores ---------------- */
  async renderScores(tab) {
    for (const b of document.querySelectorAll('#score-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    const body = $('score-body');
    const g = this.game;
    if (tab === 'local') {
      const l = loadScores().slice(0, 30);
      body.innerHTML = l.length
        ? '<table class="tbl"><tr><th></th><th>Joueur</th><th>Mode</th><th class="num">Distance</th></tr>' + l.map((s, i) => `<tr><td><span class="medal">${medal(i)}</span></td><td>${esc(s.name)}</td><td>${s.mode === 'multi' ? '🌐' : '👤'} <small>${new Date(s.t).toLocaleDateString()}</small></td><td class="num">${s.score} m</td></tr>`).join('') + '</table>'
        : '<p class="status">Aucun score pour l’instant. Lance une course !</p>';
    } else if (tab === 'room') {
      const l = [...g.session.entries()].sort((a, b) => b[1].total - a[1].total);
      body.innerHTML = g.mode === 'multi' && l.length
        ? '<table class="tbl"><tr><th></th><th>Joueur</th><th class="num">Manches</th><th class="num">Meilleur</th><th class="num">Total</th></tr>' + l.map(([n, s], i) => `<tr><td><span class="medal">${medal(i)}</span></td><td>${esc(n)}</td><td class="num">${s.rounds}</td><td class="num">${s.best} m</td><td class="num">${s.total} m</td></tr>`).join('') + '</table>'
        : '<p class="status">Rejoins une salle et termine une manche pour voir le classement de la salle.</p>';
    } else {
      if (!globalEnabled()) { body.innerHTML = '<p class="status">Le classement mondial n’est pas configuré. Voir le README (section « Classement mondial ») : une base Firebase gratuite suffit, sans serveur.</p>'; return; }
      body.innerHTML = '<p class="status">Chargement…</p>';
      const l = await fetchGlobal(50);
      if (this.current !== 'scores') return;
      body.innerHTML = l
        ? '<table class="tbl"><tr><th></th><th>Joueur</th><th class="num">Distance</th></tr>' + l.map((s, i) => `<tr><td><span class="medal">${medal(i)}</span></td><td>${esc(s.name)}</td><td class="num">${s.score} m</td></tr>`).join('') + '</table>'
        : '<p class="status err">Impossible de charger le classement mondial.</p>';
    }
  },

  /* ---------------- aperçu 3D ---------------- */
  _startPreview() {
    if (!this._pv) {
      const canvas = $('preview');
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(300, 350, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd8ff, 1.15));
      const sun = new THREE.DirectionalLight(0xffffff, 1.2);
      sun.position.set(3, 6, 5);
      scene.add(sun);
      const cam = new THREE.PerspectiveCamera(32, 300 / 350, 0.1, 50);
      cam.position.set(0, 1.35, 5.4);
      cam.lookAt(0, 0.85, 0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 32), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      base.position.y = -0.06;
      scene.add(base);
      this._pv = { r, scene, cam, model: null, angle: 0.5, drag: false, last: performance.now(), raf: 0 };
      canvas.addEventListener('pointerdown', (e) => { this._pv.drag = true; this._pv.lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', (e) => { if (this._pv.drag) { this._pv.angle += (e.clientX - this._pv.lastX) * 0.015; this._pv.lastX = e.clientX; } });
      canvas.addEventListener('pointerup', () => { this._pv.drag = false; });
    }
    this._pv.running = true;
    this._rebuildPreview();
    const loop = () => {
      const p = this._pv;
      if (!p.running) return;
      p.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - p.last) / 1000);
      p.last = now;
      if (!p.drag) p.angle += dt * 0.6;
      if (p.model) {
        if (!p.model.isVoxel) p.model.root.rotation.y = p.angle;
        p.model.update(dt, { speed: 0, vy: 0, grounded: true, flying: false, frozen: false, shield: false }, p.angle);
      }
      p.r.render(p.scene, p.cam);
    };
    cancelAnimationFrame(this._pv.raf);
    loop();
  },

  _stopPreview() { if (this._pv) { this._pv.running = false; cancelAnimationFrame(this._pv.raf); } },

  _rebuildPreview() {
    const p = this._pv;
    if (!p) return;
    if (p.model) { p.scene.remove(p.model.root); p.model.dispose(); }
    p.model = new AvatarModel(this.draft, '', false);
    p.scene.add(p.model.root);
  },
};

function medal(i) { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1; }

/* ====================================================================== */
export function initUI(game) {
  ui.game = game;
  ui.draft = sanitizeAvatar(game.profile.avatar);
  ui.blocky = ui.draft.kind === 'blocky' ? { ...ui.draft } : { ...DEFAULT_BLOCKY };

  const fill = (id, list, labels) => { $(id).innerHTML = list.map((k) => `<option value="${k}">${labels[k]}</option>`).join(''); };
  fill('s-hair', HAIR_STYLES, LABELS.hair); fill('s-hat', HATS, LABELS.hat); fill('s-acc', ACCS, LABELS.acc);
  fill('s-face', FACES, LABELS.face); fill('s-body', BODIES, LABELS.body);

  const MAP = { 'c-skin': 'skin', 'c-shirt': 'shirt', 'c-pants': 'pants', 'c-shoes': 'shoes', 'c-hair': 'hair', 'c-trim': 'trim', 'c-hat': 'hatColor', 'c-acc': 'accColor', 's-hair': 'hairStyle', 's-hat': 'hat', 's-acc': 'acc', 's-face': 'face', 's-body': 'body' };
  const syncControls = () => {
    const d = ui.draft;
    const vox = d.kind === 'voxel';
    $('av-custom').classList.toggle('hidden', vox);
    $('av-back').classList.toggle('hidden', !vox);
    if (!vox) for (const [id, k] of Object.entries(MAP)) $(id).value = d[k];
  };
  const status = (msg, cls = '') => { const el = $('av-status'); el.textContent = msg; el.className = 'status ' + cls; };
  const rebuild = () => { ui._rebuildPreview(); };
  const setDraft = (d) => { ui.draft = sanitizeAvatar(d); if (ui.draft.kind === 'blocky') ui.blocky = { ...ui.draft }; syncControls(); rebuild(); };

  for (const [id, k] of Object.entries(MAP)) {
    $(id).addEventListener('input', () => {
      if (ui.draft.kind !== 'blocky') return;
      ui.draft = sanitizeAvatar({ ...ui.draft, [k]: $(id).value });
      ui.blocky = { ...ui.draft };
      rebuild();
    });
  }

  const openAvatar = (from) => {
    ui.prev = from || 'main';
    ui.draft = sanitizeAvatar(game.profile.avatar);
    if (ui.draft.kind === 'blocky') ui.blocky = { ...ui.draft };
    $('av-text').value = ui.draft.label || '';
    status('');
    ui.screen('avatar');
    syncControls();
    ui._startPreview();
  };

  /* ----- boutons du menu principal ----- */
  const commitName = () => {
    const n = cleanName($('in-name').value);
    game.profile.name = n;
    $('in-name').value = n;
    saveProfile(game.profile);
    game.rebuildLocalModel();
    return n;
  };
  $('in-name').addEventListener('change', commitName);
  $('btn-solo').onclick = () => { sfx.unlock(); commitName(); game.startSolo(); };
  $('btn-multi').onclick = () => { sfx.unlock(); commitName(); $('multi-status').textContent = ''; ui.screen('multi'); };
  $('btn-avatar').onclick = () => { sfx.unlock(); commitName(); openAvatar('main'); };
  $('btn-scores').onclick = () => { ui.prev = 'main'; ui.screen('scores'); ui.renderScores('local'); };
  $('btn-help').onclick = () => { ui.prev = 'main'; ui.screen('help'); };
  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => ui.screen(game.phase === 'menu' ? 'main' : ui.prev);
  for (const b of document.querySelectorAll('#score-tabs button')) b.onclick = () => ui.renderScores(b.dataset.tab);

  /* ----- avatar ----- */
  $('av-gen').onclick = () => {
    const text = $('av-text').value.trim();
    if (!text) { status('Écris d’abord ce que tu veux être (ex : Goku, pirate, chat…)', 'err'); return; }
    const { avatar, known } = avatarFromText(text);
    setDraft(avatar);
    status(known ? `✨ « ${text} » : personnage créé !` : `✨ « ${text} » n’est pas dans ma bibliothèque : voici un personnage inventé. Pour une version vraiment fidèle, essaie « 🎨 Image IA → 3D ».`, 'ok');
  };
  $('av-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('av-gen').click(); });
  $('av-random').onclick = () => { setDraft(randomAvatar()); status(''); };
  $('av-reset').onclick = () => { setDraft({ ...DEFAULT_BLOCKY }); status(''); };
  $('av-back').onclick = () => { setDraft(ui.blocky); status('Retour au personnage en blocs.'); };

  $('av-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { status('Ce fichier n’est pas une image.', 'err'); return; }
    status('Transformation de l’image en 3D…');
    try {
      const bmp = await createImageBitmap(f);
      setDraft(imageToVoxel(bmp, f.name.replace(/\.[^.]+$/, '').slice(0, 20)));
      status('✅ Image transformée en personnage 3D (voxels) !', 'ok');
    } catch (err) {
      status('Impossible de transformer cette image : ' + (err && err.message ? err.message : 'format non géré'), 'err');
    }
  });

  let aiAbort = null;
  $('av-ai').onclick = async () => {
    const text = $('av-text').value.trim();
    if (!text) { status('Écris d’abord ce que tu veux être pour que l’IA le dessine.', 'err'); return; }
    if (aiAbort) { aiAbort.abort(); return; }
    aiAbort = new AbortController();
    const timer = setTimeout(() => aiAbort && aiAbort.abort(), 70000);
    const btn = $('av-ai');
    btn.textContent = '⏳ Génération… (clic = annuler)';
    status('L’IA dessine « ' + text + ' »… (10 à 40 s)');
    try {
      const bmp = await fetchAIImage(text, aiAbort.signal);
      setDraft(imageToVoxel(bmp, text));
      status('✅ Personnage généré par IA et converti en 3D !', 'ok');
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      status(aborted ? 'Génération annulée.' : 'Génération impossible (service d’images IA indisponible ou hors ligne). Utilise « ✨ Générer » ou « 📷 Image → 3D » avec ta propre image.', 'err');
    } finally {
      clearTimeout(timer);
      aiAbort = null;
      btn.textContent = '🎨 Image IA → 3D';
    }
  };

  $('av-done').onclick = () => {
    game.setProfile(game.profile.name, ui.draft);
    saveProfile(game.profile);
    ui.screen(game.phase === 'menu' ? 'main' : ui.prev);
  };

  /* ----- multijoueur ----- */
  const mstatus = (m, cls = '') => { const el = $('multi-status'); el.textContent = m; el.className = 'status ' + cls; };
  let busy = false;
  $('btn-create').onclick = async () => {
    if (busy) return;
    busy = true; mstatus('Création de la salle…');
    try { await game.createRoom(); }
    catch (e) { mstatus(e.message || 'Erreur', 'err'); }
    busy = false;
  };
  const doJoin = async (codeRaw) => {
    if (busy) return;
    const code = normalizeCode(codeRaw);
    if (code.length < 4) { mstatus('Entre le code à 5 caractères de la salle.', 'err'); return; }
    busy = true; mstatus('Connexion à la salle ' + code + '…');
    try { await game.joinRoom(code); mstatus(''); }
    catch (e) { mstatus(e.message || 'Erreur', 'err'); }
    busy = false;
  };
  $('btn-join').onclick = () => doJoin($('in-code').value);
  $('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin($('in-code').value); });
  $('in-code').addEventListener('input', () => { $('in-code').value = normalizeCode($('in-code').value); });

  /* ----- salon ----- */
  $('lobby-start').onclick = () => game.hostStart();
  $('lobby-leave').onclick = () => game.toMenu();
  $('lobby-copy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?room=${game.net ? game.net.code : ''}`;
    try { await navigator.clipboard.writeText(url); $('lobby-copy').textContent = '✔ Lien copié !'; }
    catch { window.prompt('Copie ce lien :', url); }
    setTimeout(() => { $('lobby-copy').textContent = '📋 Copier le lien'; }, 1800);
  };

  /* ----- résultats ----- */
  $('res-again').onclick = () => { if (game.mode === 'solo') game.startSolo(); else game.hostStart(); };
  $('res-menu').onclick = () => game.toMenu();

  /* ----- pause ----- */
  $('pause-resume').onclick = () => game.resume();
  $('pause-quit').onclick = () => game.toMenu();
  $('pause-mute').onclick = () => game.toggleMute();
  $('sel-quality').onchange = () => { game.world.setQuality($('sel-quality').value); try { localStorage.setItem('tumblerush.quality', $('sel-quality').value); } catch { /* */ } };

  // premier clic = déblocage audio
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

  // lien d'invitation ?room=CODE
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    ui.screen('multi');
    $('in-code').value = normalizeCode(room);
    setTimeout(() => doJoin(room), 400);
  } else ui.screen('main');
}
