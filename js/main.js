import { Game } from './game.js';
import { ui, initUI, loadProfile } from './ui.js';

function fail(msg) {
  const l = document.getElementById('loading');
  l.innerHTML = '<div style="max-width:420px;text-align:center;line-height:1.4">😵 ' + msg + '</div>';
  l.style.display = 'grid';
}

try {
  const canvas = document.getElementById('gl');
  // WebGL disponible ?
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) throw new Error('Ton navigateur ou ton appareil ne gère pas WebGL, nécessaire pour la 3D.');
  const profile = loadProfile();
  const game = new Game(canvas, ui);
  game.profile.name = profile.name;
  game.profile.avatar = profile.avatar;
  game.rebuildLocalModel();
  try {
    const q = localStorage.getItem('tumblerush.quality');
    if (q === 'low') game.world.setQuality('low');
  } catch { /* */ }
  initUI(game);
  window.__game = game; // utile pour le débogage
  document.getElementById('loading').style.display = 'none';
} catch (e) {
  console.error(e);
  fail(e && e.message ? e.message : 'Erreur au démarrage.');
}
