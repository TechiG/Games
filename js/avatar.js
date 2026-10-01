// Personnages : modèle « blocs » paramétrable (texte -> personnage) et modèle voxel (image -> 3D).
import * as THREE from '../vendor/three.module.min.js';
import { hashStr, mulberry32, clamp } from './rng.js';

/* ------------------------------------------------------------------ */
/*  Descripteurs                                                        */
/* ------------------------------------------------------------------ */
export const HAIR_STYLES = ['none', 'short', 'spiky', 'long', 'mohawk', 'afro', 'twin'];
export const HATS = ['none', 'cap', 'tophat', 'crown', 'helmet', 'headband', 'catears', 'bunnyears', 'bearears', 'horns', 'antenna', 'wizard', 'pirate', 'santa', 'chef'];
export const ACCS = ['none', 'glasses', 'shades', 'mask', 'cape', 'tail', 'scarf', 'backpack', 'beard', 'mustache', 'wings', 'shell', 'cheeks'];
export const FACES = ['dots', 'big', 'angry', 'closed'];
export const BODIES = ['normal', 'round'];

export const LABELS = {
  hair: { none: 'Aucun', short: 'Court', spiky: 'Hérissés', long: 'Longs', mohawk: 'Crête', afro: 'Afro', twin: 'Couettes' },
  hat: { none: 'Aucun', cap: 'Casquette', tophat: 'Haut-de-forme', crown: 'Couronne', helmet: 'Casque', headband: 'Bandeau', catears: 'Oreilles de chat', bunnyears: 'Oreilles de lapin', bearears: 'Oreilles d’ours', horns: 'Cornes', antenna: 'Antenne', wizard: 'Chapeau de sorcier', pirate: 'Tricorne', santa: 'Bonnet de Noël', chef: 'Toque' },
  acc: { none: 'Aucun', glasses: 'Lunettes', shades: 'Lunettes de soleil', mask: 'Masque', cape: 'Cape', tail: 'Queue', scarf: 'Écharpe', backpack: 'Sac à dos', beard: 'Barbe', mustache: 'Moustache', wings: 'Ailes', shell: 'Carapace', cheeks: 'Joues rouges' },
  face: { dots: 'Classique', big: 'Gros yeux', angry: 'Sévère', closed: 'Zen' },
  body: { normal: 'Normal', round: 'Rond' },
};

export const DEFAULT_BLOCKY = {
  kind: 'blocky', label: '',
  skin: '#ffd7b0', hairStyle: 'short', hair: '#3b2a1a',
  shirt: '#ff5d73', pants: '#3a4a8c', shoes: '#ffffff', trim: '#ffd166',
  hat: 'none', hatColor: '#ff5d73', acc: 'none', accColor: '#ffffff',
  face: 'dots', body: 'normal',
};

const HEX = /^#[0-9a-f]{6}$/i;
const pick = (v, list, def) => (list.includes(v) ? v : def);
const col = (v, def) => (typeof v === 'string' && HEX.test(v) ? v : def);

// Nettoie un descripteur reçu du réseau ou du stockage (jamais de confiance aveugle).
export function sanitizeAvatar(d) {
  try {
    if (d && d.kind === 'voxel') {
      const w = d.w | 0, h = d.h | 0;
      if (w < 1 || h < 1 || w > 40 || h > 48 || typeof d.px !== 'string' || d.px.length !== w * h) throw 0;
      if (!Array.isArray(d.pal) || d.pal.length < 1 || d.pal.length > 32) throw 0;
      const pal = d.pal.map((c) => col(c, '#ff00ff'));
      return { kind: 'voxel', label: String(d.label || '').slice(0, 24), w, h, pal, px: d.px.replace(/[^0-9a-v.]/g, '.') };
    }
    const o = d || {};
    return {
      kind: 'blocky', label: String(o.label || '').slice(0, 24),
      skin: col(o.skin, DEFAULT_BLOCKY.skin),
      hairStyle: pick(o.hairStyle, HAIR_STYLES, 'short'),
      hair: col(o.hair, DEFAULT_BLOCKY.hair),
      shirt: col(o.shirt, DEFAULT_BLOCKY.shirt),
      pants: col(o.pants, DEFAULT_BLOCKY.pants),
      shoes: col(o.shoes, DEFAULT_BLOCKY.shoes),
      trim: col(o.trim, DEFAULT_BLOCKY.trim),
      hat: pick(o.hat, HATS, 'none'),
      hatColor: col(o.hatColor, DEFAULT_BLOCKY.hatColor),
      acc: pick(o.acc, ACCS, 'none'),
      accColor: col(o.accColor, DEFAULT_BLOCKY.accColor),
      face: pick(o.face, FACES, 'dots'),
      body: pick(o.body, BODIES, 'normal'),
    };
  } catch {
    return { ...DEFAULT_BLOCKY };
  }
}

/* ------------------------------------------------------------------ */
/*  Texte -> personnage                                                 */
/* ------------------------------------------------------------------ */
const SK = { light: '#ffd7b0', tan: '#e8b88a', dark: '#8d5a3b', yellow: '#ffd94a', green: '#7bd36b', blue: '#6ab7ff', pink: '#ffb3c7', grey: '#cfd6dd', white: '#ffffff', red: '#e0533d', purple: '#b07cff', orange: '#ff9d3c', black: '#2b2b33' };

// [mots-clés], descripteur partiel. Les clés les plus longues sont testées en premier.
const PRESETS = [
  [['goku', 'songoku', 'son goku', 'saiyan', 'dragon ball', 'dbz'], { skin: SK.light, hairStyle: 'spiky', hair: '#16161c', shirt: '#ff7a00', pants: '#ff7a00', shoes: '#2f5bff', trim: '#2f5bff', face: 'dots' }],
  [['vegeta', 'vegeto'], { skin: SK.light, hairStyle: 'spiky', hair: '#16161c', shirt: '#2f5bff', pants: '#2f5bff', shoes: '#ffffff', trim: '#ffffff', acc: 'none', face: 'angry' }],
  [['gohan'], { skin: SK.light, hairStyle: 'spiky', hair: '#16161c', shirt: '#7b3fe4', pants: '#7b3fe4', shoes: '#2f5bff', trim: '#ffffff' }],
  [['naruto', 'uzumaki'], { skin: SK.light, hairStyle: 'spiky', hair: '#ffd23f', shirt: '#ff7a00', pants: '#1e3a8a', shoes: '#1e3a8a', hat: 'headband', hatColor: '#1e3a8a', face: 'big' }],
  [['sasuke'], { skin: SK.light, hairStyle: 'spiky', hair: '#16161c', shirt: '#e8eef8', pants: '#3a3f6b', shoes: '#16161c', hat: 'headband', hatColor: '#1e3a8a', face: 'angry' }],
  [['luffy', 'one piece', 'monkey d'], { skin: SK.light, hairStyle: 'short', hair: '#16161c', shirt: '#d62d2d', pants: '#2b5fb3', shoes: '#c9a36b', hat: 'cap', hatColor: '#f2cf63', face: 'big' }],
  [['zoro'], { skin: SK.light, hairStyle: 'spiky', hair: '#3aa84f', shirt: '#e9e3c9', pants: '#1f6b3a', shoes: '#16161c', trim: '#3aa84f' }],
  [['mario', 'super mario'], { skin: SK.light, hairStyle: 'short', hair: '#4b2a12', shirt: '#e63232', pants: '#2f56d6', shoes: '#6b3b17', trim: '#ffffff', hat: 'cap', hatColor: '#e63232', acc: 'mustache', accColor: '#4b2a12', face: 'big' }],
  [['luigi'], { skin: SK.light, hairStyle: 'short', hair: '#4b2a12', shirt: '#2fa84f', pants: '#2f56d6', shoes: '#6b3b17', trim: '#ffffff', hat: 'cap', hatColor: '#2fa84f', acc: 'mustache', accColor: '#4b2a12', face: 'big' }],
  [['wario'], { skin: SK.light, hairStyle: 'short', hair: '#4b2a12', shirt: '#ffd23f', pants: '#7b3fe4', shoes: '#6b3b17', hat: 'cap', hatColor: '#ffd23f', acc: 'mustache', accColor: '#4b2a12', body: 'round', face: 'angry' }],
  [['sonic', 'hedgehog', 'herisson'], { skin: '#3d7bff', hairStyle: 'spiky', hair: '#2f63e0', shirt: '#3d7bff', pants: '#3d7bff', shoes: '#e63232', trim: '#ffffff', acc: 'tail', accColor: '#2f63e0', face: 'big' }],
  [['pikachu', 'pokemon'], { skin: '#ffd23f', hairStyle: 'none', hair: '#ffd23f', shirt: '#ffd23f', pants: '#ffd23f', shoes: '#ffd23f', trim: '#3b2a1a', hat: 'bunnyears', hatColor: '#ffd23f', acc: 'cheeks', accColor: '#e63232', face: 'big', body: 'round' }],
  [['kirby'], { skin: '#ffb3c7', hairStyle: 'none', shirt: '#ffb3c7', pants: '#ffb3c7', shoes: '#e63232', trim: '#ffb3c7', body: 'round', face: 'big', acc: 'cheeks', accColor: '#ff6f91' }],
  [['link', 'zelda'], { skin: SK.light, hairStyle: 'long', hair: '#e8c45a', shirt: '#2fa84f', pants: '#e9e3c9', shoes: '#6b3b17', hat: 'cap', hatColor: '#2fa84f', acc: 'backpack', accColor: '#3aa0ff', face: 'dots' }],
  [['batman', 'bruce wayne', 'dark knight'], { skin: SK.light, hairStyle: 'none', shirt: '#2b2f3a', pants: '#2b2f3a', shoes: '#16161c', trim: '#ffd23f', hat: 'bearears', hatColor: '#16161c', acc: 'cape', accColor: '#16161c', face: 'angry' }],
  [['spiderman', 'spider man', 'spider-man', 'araignee'], { skin: '#d62d2d', hairStyle: 'none', shirt: '#d62d2d', pants: '#2b5fb3', shoes: '#d62d2d', trim: '#16161c', acc: 'mask', accColor: '#d62d2d', face: 'big' }],
  [['superman', 'super man', 'clark kent'], { skin: SK.light, hairStyle: 'short', hair: '#16161c', shirt: '#2b5fb3', pants: '#2b5fb3', shoes: '#d62d2d', trim: '#ffd23f', acc: 'cape', accColor: '#d62d2d' }],
  [['iron man', 'ironman', 'tony stark'], { skin: '#c9302c', hairStyle: 'none', shirt: '#c9302c', pants: '#c9302c', shoes: '#ffd23f', trim: '#ffd23f', hat: 'helmet', hatColor: '#c9302c', face: 'angry' }],
  [['hulk'], { skin: '#4fbf4f', hairStyle: 'short', hair: '#2b2b33', shirt: '#4fbf4f', pants: '#7b3fe4', shoes: '#4fbf4f', body: 'round', face: 'angry' }],
  [['deadpool'], { skin: '#c9302c', hairStyle: 'none', shirt: '#c9302c', pants: '#c9302c', shoes: '#16161c', trim: '#16161c', acc: 'mask', accColor: '#16161c', face: 'angry' }],
  [['wolverine', 'logan'], { skin: SK.light, hairStyle: 'spiky', hair: '#16161c', shirt: '#ffd23f', pants: '#2b5fb3', shoes: '#16161c', acc: 'beard', accColor: '#2b2b33', face: 'angry' }],
  [['minion', 'minions'], { skin: '#ffd23f', hairStyle: 'none', shirt: '#2b5fb3', pants: '#2b5fb3', shoes: '#16161c', trim: '#9aa3ad', hat: 'none', acc: 'glasses', accColor: '#9aa3ad', face: 'big', body: 'round' }],
  [['shrek', 'ogre'], { skin: '#9bd34a', hairStyle: 'none', shirt: '#d6c28a', pants: '#6b4b2a', shoes: '#4b2a12', trim: '#4b2a12', hat: 'horns', hatColor: '#9bd34a', body: 'round', face: 'big' }],
  [['homer', 'simpson'], { skin: '#ffd23f', hairStyle: 'none', shirt: '#ffffff', pants: '#5b8fd9', shoes: '#4b4b55', body: 'round', acc: 'beard', accColor: '#c9b27a', face: 'big' }],
  [['bart'], { skin: '#ffd23f', hairStyle: 'spiky', hair: '#ffd23f', shirt: '#ff7a00', pants: '#3a7bd5', shoes: '#2f56d6', face: 'big' }],
  [['spongebob', 'bob l eponge', 'eponge', 'sponge'], { skin: '#ffe45e', hairStyle: 'none', shirt: '#ffffff', pants: '#8b5a2b', shoes: '#16161c', trim: '#d62d2d', face: 'big', body: 'round' }],
  [['mickey', 'mickey mouse', 'souris', 'mouse'], { skin: '#16161c', hairStyle: 'none', shirt: '#d62d2d', pants: '#d62d2d', shoes: '#ffd23f', trim: '#ffffff', hat: 'bearears', hatColor: '#16161c', face: 'big' }],
  [['elsa', 'reine des neiges', 'frozen'], { skin: SK.light, hairStyle: 'long', hair: '#f5f0c8', shirt: '#7fd3ff', pants: '#7fd3ff', shoes: '#cfefff', trim: '#ffffff', acc: 'cape', accColor: '#bfe8ff' }],
  [['harry potter', 'potter', 'poudlard'], { skin: SK.light, hairStyle: 'short', hair: '#16161c', shirt: '#2b2f3a', pants: '#2b2f3a', shoes: '#16161c', trim: '#d62d2d', acc: 'glasses', accColor: '#16161c', hat: 'none' }],
  [['darth vader', 'dark vador', 'vador', 'vader'], { skin: '#2b2b33', hairStyle: 'none', shirt: '#16161c', pants: '#16161c', shoes: '#16161c', trim: '#d62d2d', hat: 'helmet', hatColor: '#16161c', acc: 'cape', accColor: '#16161c', face: 'angry' }],
  [['yoda'], { skin: '#9bd34a', hairStyle: 'none', shirt: '#c9b27a', pants: '#8b6a3a', shoes: '#6b4b2a', hat: 'bunnyears', hatColor: '#9bd34a', body: 'round', face: 'closed' }],
  [['pacman', 'pac man', 'pac-man'], { skin: '#ffe45e', hairStyle: 'none', shirt: '#ffe45e', pants: '#ffe45e', shoes: '#ffe45e', body: 'round', face: 'big' }],
  [['ninja'], { skin: SK.light, hairStyle: 'none', shirt: '#2b2f3a', pants: '#2b2f3a', shoes: '#16161c', trim: '#d62d2d', hat: 'headband', hatColor: '#d62d2d', acc: 'mask', accColor: '#16161c', face: 'angry' }],
  [['pirate', 'corsaire'], { skin: SK.tan, hairStyle: 'long', hair: '#16161c', shirt: '#ffffff', pants: '#2b2f3a', shoes: '#4b2a12', trim: '#d62d2d', hat: 'pirate', hatColor: '#16161c', acc: 'beard', accColor: '#16161c', face: 'angry' }],
  [['robot', 'android', 'cyborg', 'mecha'], { skin: '#aab4c0', hairStyle: 'none', shirt: '#7e8a99', pants: '#5d6877', shoes: '#3d4551', trim: '#ff4d4d', hat: 'antenna', hatColor: '#ff4d4d', face: 'big' }],
  [['zombie', 'mort vivant'], { skin: '#8fbf7a', hairStyle: 'short', hair: '#4a5a3a', shirt: '#6b5a8a', pants: '#4a5a3a', shoes: '#3d3d3d', face: 'closed' }],
  [['alien', 'extraterrestre', 'martien', 'ovni'], { skin: '#7ee27e', hairStyle: 'none', shirt: '#7b3fe4', pants: '#4a2a9a', shoes: '#16161c', hat: 'antenna', hatColor: '#7ee27e', face: 'big' }],
  [['fantome', 'ghost', 'spectre'], { skin: '#f4f7ff', hairStyle: 'none', shirt: '#f4f7ff', pants: '#f4f7ff', shoes: '#f4f7ff', trim: '#f4f7ff', body: 'round', face: 'big' }],
  [['clown'], { skin: '#fff0e0', hairStyle: 'afro', hair: '#ff5d2f', shirt: '#ffd23f', pants: '#d62d2d', shoes: '#2f56d6', trim: '#2f56d6', hat: 'none', acc: 'cheeks', accColor: '#e63232', face: 'big', body: 'round' }],
  [['cowboy', 'sheriff', 'far west'], { skin: SK.tan, hairStyle: 'short', hair: '#4b2a12', shirt: '#b5651d', pants: '#3a4a8c', shoes: '#4b2a12', trim: '#ffd23f', hat: 'tophat', hatColor: '#6b3b17', acc: 'mustache', accColor: '#4b2a12' }],
  [['chevalier', 'knight', 'soldat', 'guerrier', 'viking', 'warrior'], { skin: SK.light, hairStyle: 'none', shirt: '#9aa3ad', pants: '#7e8a99', shoes: '#5d6877', trim: '#d62d2d', hat: 'helmet', hatColor: '#9aa3ad', acc: 'cape', accColor: '#d62d2d' }],
  [['roi', 'king', 'reine', 'queen', 'prince', 'princesse', 'princess'], { skin: SK.light, hairStyle: 'long', hair: '#e8c45a', shirt: '#7b3fe4', pants: '#7b3fe4', shoes: '#ffd23f', trim: '#ffd23f', hat: 'crown', hatColor: '#ffd23f', acc: 'cape', accColor: '#d62d2d' }],
  [['sorcier', 'magicien', 'wizard', 'mage', 'witch', 'sorciere', 'merlin', 'gandalf'], { skin: SK.light, hairStyle: 'long', hair: '#e9e9ef', shirt: '#4a3aa8', pants: '#4a3aa8', shoes: '#2b2f3a', trim: '#ffd23f', hat: 'wizard', hatColor: '#4a3aa8', acc: 'beard', accColor: '#e9e9ef' }],
  [['pere noel', 'santa', 'noel', 'christmas'], { skin: SK.light, hairStyle: 'none', shirt: '#d62d2d', pants: '#d62d2d', shoes: '#16161c', trim: '#ffffff', hat: 'santa', hatColor: '#d62d2d', acc: 'beard', accColor: '#ffffff', body: 'round' }],
  [['panda'], { skin: '#ffffff', hairStyle: 'none', shirt: '#ffffff', pants: '#16161c', shoes: '#16161c', trim: '#16161c', hat: 'bearears', hatColor: '#16161c', body: 'round', face: 'closed' }],
  [['chat', 'cat', 'chaton', 'kitty'], { skin: '#ffb36b', hairStyle: 'none', shirt: '#ffb36b', pants: '#ff9d3c', shoes: '#ffffff', hat: 'catears', hatColor: '#ffb36b', acc: 'tail', accColor: '#ff9d3c', face: 'big' }],
  [['chien', 'dog', 'toutou', 'loup', 'wolf'], { skin: '#d9b58a', hairStyle: 'none', shirt: '#d9b58a', pants: '#b5895a', shoes: '#ffffff', hat: 'bearears', hatColor: '#8b5a2b', acc: 'tail', accColor: '#b5895a', face: 'dots' }],
  [['lapin', 'bunny', 'rabbit', 'pâques'], { skin: '#ffffff', hairStyle: 'none', shirt: '#ffffff', pants: '#ffd9e6', shoes: '#ffd9e6', hat: 'bunnyears', hatColor: '#ffffff', acc: 'tail', accColor: '#ffffff', face: 'big' }],
  [['grenouille', 'frog', 'crapaud', 'kermit'], { skin: '#5fcf5f', hairStyle: 'none', shirt: '#5fcf5f', pants: '#3aa84f', shoes: '#3aa84f', trim: '#ffffff', hat: 'bearears', hatColor: '#5fcf5f', face: 'big' }],
  [['canard', 'duck', 'donald', 'poulet', 'chicken', 'poule'], { skin: '#ffe45e', hairStyle: 'none', shirt: '#ffe45e', pants: '#ff9d3c', shoes: '#ff9d3c', trim: '#ff9d3c', hat: 'none', acc: 'wings', accColor: '#ffe45e', face: 'big', body: 'round' }],
  [['dino', 'dinosaure', 'dinosaur', 'trex', 't rex', 'crocodile', 'dragon'], { skin: '#4fbf4f', hairStyle: 'none', shirt: '#4fbf4f', pants: '#3aa84f', shoes: '#2f8a3f', hat: 'horns', hatColor: '#ffd23f', acc: 'tail', accColor: '#3aa84f', face: 'angry' }],
  [['licorne', 'unicorn', 'poney', 'pony'], { skin: '#ffffff', hairStyle: 'long', hair: '#ff8fd0', shirt: '#ffffff', pants: '#e8d9ff', shoes: '#ffd9e6', hat: 'horns', hatColor: '#ffd23f', acc: 'tail', accColor: '#ff8fd0', face: 'big' }],
  [['ours', 'bear', 'teddy', 'nounours'], { skin: '#a9743c', hairStyle: 'none', shirt: '#a9743c', pants: '#8b5a2b', shoes: '#6b3b17', hat: 'bearears', hatColor: '#a9743c', body: 'round', face: 'dots' }],
  [['renard', 'fox'], { skin: '#ff8a3c', hairStyle: 'none', shirt: '#ff8a3c', pants: '#ffffff', shoes: '#4b2a12', hat: 'catears', hatColor: '#ff8a3c', acc: 'tail', accColor: '#ff8a3c', face: 'big' }],
  [['squelette', 'skeleton', 'os'], { skin: '#f4f1e6', hairStyle: 'none', shirt: '#f4f1e6', pants: '#e0dccb', shoes: '#f4f1e6', trim: '#16161c', face: 'big' }],
  [['vampire', 'dracula'], { skin: '#f2e8f0', hairStyle: 'short', hair: '#16161c', shirt: '#2b2f3a', pants: '#2b2f3a', shoes: '#16161c', trim: '#d62d2d', acc: 'cape', accColor: '#7a1030', face: 'angry' }],
  [['astronaute', 'astronaut', 'cosmonaute', 'nasa'], { skin: SK.light, hairStyle: 'none', shirt: '#f4f7ff', pants: '#f4f7ff', shoes: '#cfd6dd', trim: '#2f56d6', hat: 'helmet', hatColor: '#f4f7ff', acc: 'backpack', accColor: '#cfd6dd' }],
  [['chef', 'cuisinier', 'cuistot', 'boulanger'], { skin: SK.light, hairStyle: 'short', hair: '#3b2a1a', shirt: '#ffffff', pants: '#2b2f3a', shoes: '#2b2f3a', trim: '#d62d2d', hat: 'chef', hatColor: '#ffffff', acc: 'mustache', accColor: '#3b2a1a' }],
  [['policier', 'police', 'flic', 'cop'], { skin: SK.light, hairStyle: 'short', hair: '#3b2a1a', shirt: '#2b5fb3', pants: '#1e3a8a', shoes: '#16161c', trim: '#ffd23f', hat: 'cap', hatColor: '#1e3a8a', acc: 'shades', accColor: '#16161c' }],
  [['pompier', 'firefighter'], { skin: SK.light, hairStyle: 'none', shirt: '#d62d2d', pants: '#2b2f3a', shoes: '#16161c', trim: '#ffd23f', hat: 'helmet', hatColor: '#ffd23f' }],
  [['docteur', 'doctor', 'medecin', 'infirmier'], { skin: SK.light, hairStyle: 'short', hair: '#3b2a1a', shirt: '#ffffff', pants: '#3a9ad9', shoes: '#ffffff', trim: '#d62d2d', acc: 'glasses', accColor: '#16161c' }],
  [['hippie', 'rasta', 'reggae'], { skin: SK.dark, hairStyle: 'afro', hair: '#16161c', shirt: '#2fa84f', pants: '#ffd23f', shoes: '#d62d2d', trim: '#d62d2d', acc: 'shades', accColor: '#16161c' }],
  [['cool', 'rappeur', 'rapper', 'swag'], { skin: SK.dark, hairStyle: 'short', hair: '#16161c', shirt: '#ffd23f', pants: '#2b2f3a', shoes: '#ffffff', trim: '#ffd23f', hat: 'cap', hatColor: '#16161c', acc: 'shades', accColor: '#16161c' }],
  [['sirene', 'mermaid', 'poisson', 'fish'], { skin: '#7fd3ff', hairStyle: 'long', hair: '#ff6f91', shirt: '#3aa0ff', pants: '#2b7fd9', shoes: '#2b7fd9', acc: 'tail', accColor: '#3aa0ff', face: 'big' }],
  [['pizza'], { skin: '#ffd23f', hairStyle: 'none', shirt: '#ff9d3c', pants: '#d62d2d', shoes: '#ffd23f', hat: 'none', body: 'round', face: 'big' }],
  [['fraise', 'strawberry', 'tomate', 'tomato', 'cerise'], { skin: '#e63232', hairStyle: 'none', shirt: '#e63232', pants: '#e63232', shoes: '#4fbf4f', hat: 'bearears', hatColor: '#4fbf4f', body: 'round', face: 'big' }],
  [['banane', 'banana'], { skin: '#ffe45e', hairStyle: 'none', shirt: '#ffe45e', pants: '#ffe45e', shoes: '#8b5a2b', body: 'round', face: 'big', hat: 'antenna', hatColor: '#8b5a2b' }],
  [['tortue', 'turtle', 'koopa'], { skin: '#9bd34a', hairStyle: 'none', shirt: '#9bd34a', pants: '#9bd34a', shoes: '#ffd23f', acc: 'shell', accColor: '#3aa84f', face: 'big' }],
  [['abeille', 'bee', 'guepe'], { skin: '#ffe45e', hairStyle: 'none', shirt: '#ffe45e', pants: '#16161c', shoes: '#16161c', trim: '#16161c', hat: 'antenna', hatColor: '#16161c', acc: 'wings', accColor: '#cfefff', face: 'big', body: 'round' }],
  [['ange', 'angel', 'ange gardien'], { skin: SK.light, hairStyle: 'short', hair: '#ffe45e', shirt: '#ffffff', pants: '#ffffff', shoes: '#ffffff', hat: 'headband', hatColor: '#ffd23f', acc: 'wings', accColor: '#ffffff', face: 'closed' }],
  [['diable', 'demon', 'devil', 'satan'], { skin: '#e0533d', hairStyle: 'none', shirt: '#7a1030', pants: '#7a1030', shoes: '#16161c', hat: 'horns', hatColor: '#16161c', acc: 'tail', accColor: '#e0533d', face: 'angry' }],
];

const COLORS = {
  rouge: '#e63232', red: '#e63232', bleu: '#2f6fe0', blue: '#2f6fe0', vert: '#3aa84f', green: '#3aa84f',
  jaune: '#ffd23f', yellow: '#ffd23f', rose: '#ff8fb8', pink: '#ff8fb8', violet: '#8a4fe0', purple: '#8a4fe0',
  orange: '#ff8a1f', noir: '#2b2b33', black: '#2b2b33', blanc: '#f4f4f8', white: '#f4f4f8', gris: '#9aa3ad', grey: '#9aa3ad', gray: '#9aa3ad',
  marron: '#8b5a2b', brown: '#8b5a2b', or: '#ffcc33', gold: '#ffcc33', dore: '#ffcc33', argent: '#cfd6dd', silver: '#cfd6dd', cyan: '#33d1e0', turquoise: '#33d1e0',
};

export function normalizeText(s) {
  return (' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ');
}

const SORTED = [];
for (const [keys, desc] of PRESETS) for (const k of keys) SORTED.push([normalizeText(k), desc]);
SORTED.sort((a, b) => b[0].length - a[0].length);

// Retourne toujours un descripteur ; `known` indique si le texte est un personnage connu.
export function avatarFromText(text) {
  const raw = String(text || '').trim().slice(0, 40);
  const t = normalizeText(raw);
  let base = null;
  for (const [k, d] of SORTED) {
    if (t.includes(k)) { base = d; break; }
  }
  const out = { ...DEFAULT_BLOCKY, label: raw };
  let known = false;
  if (base) {
    Object.assign(out, base);
    known = true;
  } else if (raw) {
    // Personnage « inventé » mais stable : même texte => même look.
    const r = mulberry32(hashStr(t));
    const skins = Object.values(SK);
    const hairCols = ['#16161c', '#3b2a1a', '#8b5a2b', '#e8c45a', '#d62d2d', '#ff8fd0', '#3aa0ff', '#7b3fe4', '#e9e9ef'];
    const cols = ['#ff5d73', '#3aa0ff', '#4fbf4f', '#ffd23f', '#a46bff', '#ff8a1f', '#2fd1c4', '#ff8fb8', '#2b2f3a'];
    out.skin = skins[Math.floor(r() * 5)];
    out.hairStyle = HAIR_STYLES[1 + Math.floor(r() * (HAIR_STYLES.length - 1))];
    out.hair = hairCols[Math.floor(r() * hairCols.length)];
    out.shirt = cols[Math.floor(r() * cols.length)];
    out.pants = cols[Math.floor(r() * cols.length)];
    out.shoes = r() < 0.5 ? '#ffffff' : '#16161c';
    out.trim = cols[Math.floor(r() * cols.length)];
    out.hat = r() < 0.4 ? HATS[1 + Math.floor(r() * (HATS.length - 1))] : 'none';
    out.hatColor = cols[Math.floor(r() * cols.length)];
    out.acc = r() < 0.4 ? ACCS[1 + Math.floor(r() * (ACCS.length - 1))] : 'none';
    out.accColor = cols[Math.floor(r() * cols.length)];
    out.face = FACES[Math.floor(r() * FACES.length)];
    out.body = r() < 0.25 ? 'round' : 'normal';
  }
  // Modificateurs : « super saiyan », couleurs…
  if (/ (super saiyan|ssj|saiyan blond|blond|blonde) /.test(t)) { out.hair = '#ffe14a'; if (base) out.hairStyle = out.hairStyle === 'none' ? 'spiky' : out.hairStyle; }
  if (/ (roux|rousse|redhead) /.test(t)) out.hair = '#d9622b';
  if (/ (cheveux )?(roses?|pink) /.test(t) && /cheveux|hair/.test(t)) out.hair = '#ff8fd0';
  for (const w of t.trim().split(' ')) {
    if (COLORS[w]) {
      if (!known) { out.shirt = COLORS[w]; out.hatColor = COLORS[w]; out.trim = COLORS[w]; }
      else { out.shirt = COLORS[w]; }
    }
  }
  return { avatar: sanitizeAvatar(out), known };
}

export function randomAvatar() {
  const r = Math.random;
  const skins = [SK.light, SK.tan, SK.dark, SK.yellow, SK.green, SK.pink];
  const cols = ['#ff5d73', '#3aa0ff', '#4fbf4f', '#ffd23f', '#a46bff', '#ff8a1f', '#2fd1c4', '#ff8fb8', '#2b2f3a', '#ffffff'];
  const rc = () => cols[Math.floor(r() * cols.length)];
  return sanitizeAvatar({
    kind: 'blocky', label: '',
    skin: skins[Math.floor(r() * skins.length)],
    hairStyle: HAIR_STYLES[Math.floor(r() * HAIR_STYLES.length)],
    hair: ['#16161c', '#3b2a1a', '#e8c45a', '#d62d2d', '#ff8fd0', '#3aa0ff'][Math.floor(r() * 6)],
    shirt: rc(), pants: rc(), shoes: rc(), trim: rc(),
    hat: r() < 0.5 ? HATS[Math.floor(r() * HATS.length)] : 'none', hatColor: rc(),
    acc: r() < 0.5 ? ACCS[Math.floor(r() * ACCS.length)] : 'none', accColor: rc(),
    face: FACES[Math.floor(r() * FACES.length)], body: r() < 0.25 ? 'round' : 'normal',
  });
}

/* ------------------------------------------------------------------ */
/*  Image -> voxels                                                     */
/* ------------------------------------------------------------------ */
const PAL_CHARS = '0123456789abcdefghijklmnopqrstuv'; // 32 couleurs max, '.' = transparent
const MAX_W = 28, MAX_H = 36, PAL_N = 24;

function medianCut(pixels, n) {
  // pixels : tableau de [r,g,b]
  let boxes = [pixels];
  while (boxes.length < n) {
    let bi = -1, best = -1, ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
        const range = (mx - mn) * Math.sqrt(b.length);
        if (range > best) { best = range; bi = i; ch = c; }
      }
    });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi].sort((p, q) => p[ch] - q[ch]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    const k = b.length || 1;
    return [Math.round(r / k), Math.round(g / k), Math.round(bl / k)];
  });
}

const toHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

// source : HTMLImageElement | ImageBitmap | HTMLCanvasElement
export function imageToVoxel(source, label = '') {
  const sw = source.naturalWidth || source.width, sh = source.naturalHeight || source.height;
  if (!sw || !sh) throw new Error('Image vide');
  // 1) rendu à ~160px pour nettoyer le fond
  const S = 160;
  const sc = Math.min(S / sw, S / sh);
  const cw = Math.max(1, Math.round(sw * sc)), ch = Math.max(1, Math.round(sh * sc));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, cw, ch);
  x.drawImage(source, 0, 0, cw, ch);
  const img = x.getImageData(0, 0, cw, ch);
  const d = img.data;
  const A = (i) => d[i * 4 + 3];

  // fond : transparent ? sinon couleur dominante des bords
  const border = [];
  for (let i = 0; i < cw; i++) { border.push(i, (ch - 1) * cw + i); }
  for (let j = 0; j < ch; j++) { border.push(j * cw, j * cw + cw - 1); }
  const transparentBorder = border.filter((i) => A(i) < 40).length > border.length * 0.6;
  if (!transparentBorder) {
    // couleur de fond = médiane des pixels de bord
    const rs = [], gs = [], bs = [];
    for (const i of border) { rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]); }
    const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
    const br = med(rs), bg = med(gs), bb = med(bs);
    const tol = 56;
    const near = (i) => {
      const dr = d[i * 4] - br, dg = d[i * 4 + 1] - bg, db = d[i * 4 + 2] - bb;
      return Math.sqrt(dr * dr + dg * dg + db * db) < tol;
    };
    const seen = new Uint8Array(cw * ch);
    const stack = [];
    for (const i of border) if (near(i) && !seen[i]) { seen[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop();
      d[i * 4 + 3] = 0;
      const px = i % cw, py = (i / cw) | 0;
      if (px > 0 && !seen[i - 1] && near(i - 1)) { seen[i - 1] = 1; stack.push(i - 1); }
      if (px < cw - 1 && !seen[i + 1] && near(i + 1)) { seen[i + 1] = 1; stack.push(i + 1); }
      if (py > 0 && !seen[i - cw] && near(i - cw)) { seen[i - cw] = 1; stack.push(i - cw); }
      if (py < ch - 1 && !seen[i + cw] && near(i + cw)) { seen[i + cw] = 1; stack.push(i + cw); }
    }
  }
  // 2) boîte englobante des pixels opaques
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    if (A(j * cw + i) > 100) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  if (x1 < 0) throw new Error('Aucun sujet détecté dans l’image');
  x.putImageData(img, 0, 0);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // 3) réduction vers la grille voxel
  const k = Math.min(MAX_W / bw, MAX_H / bh);
  const gw = Math.max(2, Math.round(bw * k)), gh = Math.max(2, Math.round(bh * k));
  const g = document.createElement('canvas');
  g.width = gw; g.height = gh;
  const gx = g.getContext('2d', { willReadFrequently: true });
  gx.imageSmoothingEnabled = true; gx.imageSmoothingQuality = 'high';
  gx.drawImage(c, x0, y0, bw, bh, 0, 0, gw, gh);
  const gd = gx.getImageData(0, 0, gw, gh).data;
  const opaque = [], idx = [];
  for (let i = 0; i < gw * gh; i++) {
    if (gd[i * 4 + 3] >= 128) { idx.push(i); opaque.push([gd[i * 4], gd[i * 4 + 1], gd[i * 4 + 2]]); }
  }
  if (opaque.length < 4) throw new Error('Sujet trop petit');
  // 4) palette
  const pal = medianCut(opaque.slice(), PAL_N);
  const px = new Array(gw * gh).fill('.');
  idx.forEach((pi, n) => {
    const p = opaque[n];
    let bi = 0, bd = 1e9;
    for (let j = 0; j < pal.length; j++) {
      const q = pal[j];
      const dd = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
      if (dd < bd) { bd = dd; bi = j; }
    }
    px[pi] = PAL_CHARS[bi];
  });
  return sanitizeAvatar({ kind: 'voxel', label, w: gw, h: gh, pal: pal.map(toHex), px: px.join('') });
}

// URL d'image générée par IA (service public gratuit, sans clé). Peut échouer hors-ligne.
export async function fetchAIImage(text, signal) {
  const prompt = `${text}, full body character, standing, front view, cute 3d game character, simple flat colors, plain white background`;
  const urls = [
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`,
  ];
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal, mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Réponse inattendue');
      return await createImageBitmap(blob);
    } catch (e) {
      lastErr = e;
      if (signal && signal.aborted) throw e;
    }
  }
  throw lastErr || new Error('Génération impossible');
}

/* ------------------------------------------------------------------ */
/*  Modèles 3D                                                          */
/* ------------------------------------------------------------------ */
const BOX = new THREE.BoxGeometry(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(0.5, 14, 10);
const CONE = new THREE.ConeGeometry(0.5, 1, 6);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}
const ICE_MAT = new THREE.MeshLambertMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.55, emissive: 0x2a6f9a });
const SHIELD_MAT = new THREE.MeshBasicMaterial({ color: 0x6fd0ff, transparent: true, opacity: 0.28, depthWrite: false });

function part(geo, parent, color, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo, mat(color));
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const box = (p, c, w, h, d, x, y, z) => part(BOX, p, c, w, h, d, x, y, z);

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const t = text.length > 14 ? text.slice(0, 13) + '…' : text;
  x.lineWidth = 7; x.strokeStyle = 'rgba(20,20,40,.85)'; x.strokeText(t, 128, 34);
  x.fillStyle = '#fff'; x.fillText(t, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(2.0, 0.5, 1);
  s.renderOrder = 10;
  return s;
}

export class AvatarModel {
  // desc : descripteur nettoyé ; name : étiquette au-dessus ; showLabel
  constructor(desc, name = '', showLabel = true) {
    this.desc = sanitizeAvatar(desc);
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.phase = Math.random() * 6;
    this.squash = 0;
    this.prevGrounded = true;
    this.label = null;
    this.labelHeight = 2.15;
    if (this.desc.kind === 'voxel') this._buildVoxel(this.desc);
    else this._buildBlocky(this.desc);
    if (showLabel && name) {
      this.label = makeLabel(name);
      this.label.position.set(0, this.labelHeight, 0);
      this.root.add(this.label);
    }
    // effets (gel / bouclier)
    this.iceMesh = new THREE.Mesh(BOX, ICE_MAT);
    this.iceMesh.scale.set(1.0, 1.75, 1.0);
    this.iceMesh.position.y = 0.85;
    this.iceMesh.visible = false;
    this.root.add(this.iceMesh);
    this.shieldMesh = new THREE.Mesh(SPHERE, SHIELD_MAT);
    this.shieldMesh.scale.set(2.0, 2.2, 2.0);
    this.shieldMesh.position.y = 0.85;
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);
  }

  /* ---- blocs ---- */
  _buildBlocky(d) {
    const round = d.body === 'round';
    const P = this.pivot;
    const legH = round ? 0.4 : 0.5;
    const torsoW = round ? 0.86 : 0.62, torsoH = round ? 0.72 : 0.58, torsoD = round ? 0.6 : 0.36;
    const hipY = legH, shoulderY = legH + torsoH - 0.1, headY = legH + torsoH;
    this.shoulderY = shoulderY;
    this.torsoD = torsoD;
    this.torsoTop = headY;

    // jambes (pivot à la hanche)
    const mkLeg = (sx) => {
      const g = new THREE.Group();
      g.position.set(sx * (torsoW * 0.26), hipY, 0);
      box(g, d.pants, 0.26, legH - 0.14, 0.3, 0, -(legH - 0.14) / 2, 0);
      box(g, d.shoes, 0.28, 0.16, 0.38, 0, -legH + 0.08, 0.04);
      P.add(g);
      return g;
    };
    this.legL = mkLeg(-1); this.legR = mkLeg(1);
    // torse
    this.torso = new THREE.Group();
    this.torso.position.y = hipY;
    P.add(this.torso);
    box(this.torso, d.shirt, torsoW, torsoH, torsoD, 0, torsoH / 2, 0);
    box(this.torso, d.trim, torsoW + 0.02, 0.08, torsoD + 0.02, 0, 0.04, 0); // ceinture
    box(this.torso, d.trim, 0.18, 0.18, 0.02, 0, torsoH * 0.62, torsoD / 2 + 0.01); // emblème
    // bras
    const mkArm = (sx) => {
      const g = new THREE.Group();
      g.position.set(sx * (torsoW / 2 + 0.13), shoulderY, 0);
      box(g, d.shirt, 0.2, 0.3, 0.22, 0, -0.13, 0);
      box(g, d.skin, 0.19, 0.22, 0.21, 0, -0.38, 0);
      P.add(g);
      return g;
    };
    this.armL = mkArm(-1); this.armR = mkArm(1);
    // tête
    const hs = round ? 0.5 : 0.54;
    this.head = new THREE.Group();
    this.head.position.y = headY;
    P.add(this.head);
    const hc = hs / 2;
    box(this.head, d.skin, hs, hs, hs, 0, hc, 0);
    this._face(d, hs, hc);
    this._hair(d, hs, hc);
    this._hat(d, hs, hc);
    this._acc(d, hs, hc, torsoW, torsoH, torsoD);
    this.labelHeight = headY + hs + (d.hat === 'wizard' || d.hat === 'tophat' || d.hat === 'chef' || d.hat === 'bunnyears' ? 0.85 : 0.5);
    this.root.userData.height = this.labelHeight;
    // la hauteur totale ≈ 1,6 : on normalise à la boîte de collision
    const total = headY + hs;
    const k = 1.5 / total;
    this.pivot.scale.setScalar(k);
    this.labelHeight *= k;
  }

  _face(d, hs, hc) {
    const H = this.head, z = hs / 2 + 0.005, ey = hc + 0.04, ex = hs * 0.22;
    const eyeC = '#16161c';
    if (d.face === 'big') {
      for (const s of [-1, 1]) {
        box(H, '#ffffff', 0.17, 0.2, 0.02, s * ex, ey, z);
        box(H, eyeC, 0.08, 0.11, 0.02, s * ex + s * -0.01, ey - 0.01, z + 0.012);
      }
    } else if (d.face === 'closed') {
      for (const s of [-1, 1]) box(H, eyeC, 0.15, 0.03, 0.02, s * ex, ey, z);
    } else {
      for (const s of [-1, 1]) box(H, eyeC, 0.09, 0.13, 0.02, s * ex, ey, z);
    }
    if (d.face === 'angry') {
      for (const s of [-1, 1]) {
        const b = box(H, eyeC, 0.17, 0.04, 0.02, s * ex, ey + 0.13, z);
        b.rotation.z = s * -0.45;
      }
    }
    box(H, '#7a2f2f', d.face === 'angry' ? 0.16 : 0.18, 0.04, 0.02, 0, hc - 0.13, z);
  }

  _hair(d, hs, hc) {
    const H = this.head, h = d.hair, top = hs;
    switch (d.hairStyle) {
      case 'short':
        box(H, h, hs + 0.04, 0.14, hs + 0.04, 0, top - 0.04, 0);
        box(H, h, hs + 0.04, 0.34, 0.1, 0, top - 0.2, -hs / 2 - 0.0);
        box(H, h, hs + 0.04, 0.09, 0.08, 0, top - 0.1, hs / 2);
        break;
      case 'spiky': {
        box(H, h, hs + 0.04, 0.14, hs + 0.04, 0, top - 0.04, 0);
        box(H, h, hs + 0.04, 0.3, 0.1, 0, top - 0.18, -hs / 2);
        const sp = [[0, 0.36, 0, 0, 0], [-0.2, 0.3, 0, 0, 0.5], [0.2, 0.3, 0, 0, -0.5], [0, 0.28, -0.2, -0.5, 0], [-0.13, 0.22, 0.2, 0.45, 0.25], [0.13, 0.22, 0.2, 0.45, -0.25]];
        for (const [x, y, z, rx, rz] of sp) {
          const c = part(CONE, H, h, 0.2, 0.5, 0.2, x, top + y - 0.05, z);
          c.rotation.set(rx, 0, rz);
        }
        break;
      }
      case 'long':
        box(H, h, hs + 0.04, 0.14, hs + 0.04, 0, top - 0.04, 0);
        box(H, h, hs + 0.04, 0.8, 0.12, 0, top - 0.4, -hs / 2);
        box(H, h, 0.08, 0.55, hs * 0.8, -hs / 2 - 0.0, top - 0.3, -0.04);
        box(H, h, 0.08, 0.55, hs * 0.8, hs / 2 + 0.0, top - 0.3, -0.04);
        box(H, h, hs + 0.04, 0.09, 0.08, 0, top - 0.1, hs / 2);
        break;
      case 'mohawk':
        box(H, h, 0.12, 0.3, hs * 0.9, 0, top + 0.1, 0);
        break;
      case 'afro': {
        const s = part(SPHERE, H, h, 0.95, 0.85, 0.95, 0, top - 0.02, -0.02);
        s.castShadow = true;
        break;
      }
      case 'twin':
        box(H, h, hs + 0.04, 0.14, hs + 0.04, 0, top - 0.04, 0);
        box(H, h, hs + 0.04, 0.3, 0.1, 0, top - 0.18, -hs / 2);
        box(H, h, hs + 0.04, 0.09, 0.08, 0, top - 0.1, hs / 2);
        for (const s of [-1, 1]) {
          part(SPHERE, H, h, 0.22, 0.22, 0.22, s * (hs / 2 + 0.1), top - 0.12, 0);
          box(H, h, 0.1, 0.4, 0.1, s * (hs / 2 + 0.1), top - 0.4, 0);
        }
        break;
      default: break;
    }
  }

  _hat(d, hs, hc) {
    const H = this.head, c = d.hatColor, top = hs;
    switch (d.hat) {
      case 'cap':
        box(H, c, hs + 0.08, 0.16, hs + 0.08, 0, top + 0.02, 0);
        box(H, c, hs * 0.8, 0.04, 0.3, 0, top - 0.04, hs / 2 + 0.14);
        break;
      case 'tophat':
        part(CYL, H, c, 0.44, 0.38, 0.44, 0, top + 0.2, 0);
        part(CYL, H, c, 0.7, 0.05, 0.7, 0, top + 0.01, 0);
        part(CYL, H, '#16161c', 0.45, 0.07, 0.45, 0, top + 0.07, 0);
        break;
      case 'crown':
        part(CYL, H, '#ffcc33', 0.5, 0.15, 0.5, 0, top + 0.07, 0);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          part(CONE, H, '#ffcc33', 0.12, 0.2, 0.12, Math.cos(a) * 0.2, top + 0.24, Math.sin(a) * 0.2);
        }
        break;
      case 'helmet': {
        const s = part(SPHERE, H, c, hs * 1.35, hs * 1.15, hs * 1.35, 0, hc + 0.04, 0);
        s.material = mat(c);
        box(H, '#0e1a26', hs * 0.78, 0.2, 0.04, 0, hc + 0.04, hs * 0.66);
        break;
      }
      case 'headband':
        box(H, c, hs + 0.04, 0.09, hs + 0.04, 0, top - 0.17, 0);
        box(H, c, 0.12, 0.05, 0.3, 0.1, top - 0.17, -hs / 2 - 0.12).rotation.y = 0.2;
        box(H, c, 0.12, 0.05, 0.3, -0.1, top - 0.2, -hs / 2 - 0.12).rotation.y = -0.2;
        break;
      case 'catears':
        for (const s of [-1, 1]) {
          const e = part(CONE, H, c, 0.2, 0.28, 0.12, s * 0.17, top + 0.1, 0);
          e.rotation.z = s * -0.25;
        }
        break;
      case 'bunnyears':
        for (const s of [-1, 1]) {
          const e = box(H, c, 0.12, 0.5, 0.07, s * 0.13, top + 0.26, -0.02);
          e.rotation.z = s * -0.15;
        }
        break;
      case 'bearears':
        for (const s of [-1, 1]) part(SPHERE, H, c, 0.2, 0.2, 0.14, s * 0.2, top + 0.04, 0);
        break;
      case 'horns':
        for (const s of [-1, 1]) {
          const e = part(CONE, H, c, 0.12, 0.34, 0.12, s * 0.2, top + 0.14, 0.02);
          e.rotation.z = s * -0.35;
        }
        break;
      case 'antenna':
        part(CYL, H, '#5d6877', 0.04, 0.3, 0.04, 0, top + 0.15, 0);
        part(SPHERE, H, c, 0.12, 0.12, 0.12, 0, top + 0.32, 0);
        break;
      case 'wizard':
        part(CYL, H, c, 0.78, 0.05, 0.78, 0, top + 0.02, 0);
        part(CONE, H, c, 0.5, 0.8, 0.5, 0, top + 0.43, 0);
        part(CYL, H, '#ffd23f', 0.52, 0.06, 0.52, 0, top + 0.1, 0);
        break;
      case 'pirate':
        box(H, c, hs + 0.3, 0.1, hs * 0.8, 0, top + 0.04, 0);
        box(H, c, hs * 0.7, 0.2, hs * 0.7, 0, top + 0.16, 0);
        box(H, '#ffffff', 0.1, 0.1, 0.02, 0, top + 0.16, hs * 0.36);
        break;
      case 'santa': {
        part(CONE, H, c, 0.55, 0.6, 0.55, 0, top + 0.3, 0);
        part(CYL, H, '#ffffff', 0.62, 0.1, 0.62, 0, top + 0.02, 0);
        part(SPHERE, H, '#ffffff', 0.16, 0.16, 0.16, 0.08, top + 0.62, -0.08);
        break;
      }
      case 'chef':
        part(CYL, H, c, 0.5, 0.34, 0.5, 0, top + 0.17, 0);
        part(SPHERE, H, c, 0.62, 0.3, 0.62, 0, top + 0.4, 0);
        break;
      default: break;
    }
  }

  _acc(d, hs, hc, tw, th, td) {
    const H = this.head, T = this.torso, c = d.accColor, z = hs / 2 + 0.02;
    switch (d.acc) {
      case 'glasses':
        for (const s of [-1, 1]) box(H, c, 0.2, 0.2, 0.03, s * hs * 0.22, hc + 0.04, z + 0.02);
        box(H, c, 0.1, 0.03, 0.03, 0, hc + 0.08, z + 0.02);
        break;
      case 'shades':
        box(H, c, hs * 0.92, 0.12, 0.04, 0, hc + 0.05, z + 0.02);
        break;
      case 'mask':
        box(H, c, hs + 0.02, 0.16, hs + 0.02, 0, hc + 0.05, 0);
        for (const s of [-1, 1]) box(H, '#ffffff', 0.11, 0.1, 0.02, s * hs * 0.22, hc + 0.05, hs / 2 + 0.02);
        break;
      case 'cape': {
        this.cape = new THREE.Group();
        this.cape.position.set(0, th - 0.1, -td / 2 - 0.03);
        box(this.cape, c, tw + 0.1, th + 0.45, 0.05, 0, -(th + 0.45) / 2 + 0.1, 0);
        T.add(this.cape);
        break;
      }
      case 'tail': {
        this.tail = new THREE.Group();
        this.tail.position.set(0, 0.12, -td / 2);
        const seg = box(this.tail, c, 0.12, 0.12, 0.42, 0, 0, -0.2);
        box(this.tail, c, 0.1, 0.1, 0.2, 0, 0.08, -0.5).rotation.x = 0.5;
        void seg;
        T.add(this.tail);
        break;
      }
      case 'scarf':
        box(H, c, hs + 0.06, 0.12, hs * 0.8, 0, -0.02, 0);
        box(T, c, 0.16, 0.5, 0.06, 0.16, th - 0.3, -td / 2 - 0.03);
        break;
      case 'backpack':
        box(T, c, tw * 0.62, th * 0.8, 0.18, 0, th * 0.45, -td / 2 - 0.1);
        break;
      case 'beard':
        box(H, c, hs * 0.85, 0.22, 0.1, 0, hc - 0.16, z - 0.03);
        break;
      case 'mustache':
        box(H, c, 0.36, 0.06, 0.05, 0, hc - 0.05, z + 0.01);
        break;
      case 'wings': {
        this.wings = [];
        for (const s of [-1, 1]) {
          const g = new THREE.Group();
          g.position.set(s * 0.1, th * 0.7, -td / 2 - 0.05);
          box(g, c, 0.5, 0.36, 0.05, s * 0.28, 0.05, 0);
          T.add(g);
          this.wings.push(g);
        }
        break;
      }
      case 'shell': {
        part(SPHERE, T, c, tw * 1.15, th * 1.1, 0.5, 0, th * 0.5, -td / 2 - 0.06);
        break;
      }
      case 'cheeks':
        for (const s of [-1, 1]) box(H, c, 0.12, 0.12, 0.02, s * hs * 0.36, hc - 0.07, hs / 2 + 0.01);
        break;
      default: break;
    }
  }

  /* ---- voxels ---- */
  _buildVoxel(d) {
    const { w, h, pal, px } = d;
    const u = 1.55 / h;
    const T = Math.max(2, Math.min(5, Math.round(w * 0.16)));
    const cells = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = px[j * w + i];
      if (ch === '.') continue;
      const pi = PAL_CHARS.indexOf(ch);
      if (pi < 0 || pi >= pal.length) continue;
      cells.push([i, j, pi]);
    }
    const count = Math.max(1, cells.length * T);
    const geo = new THREE.BoxGeometry(u, u, u);
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, m, count);
    inst.castShadow = true;
    inst.frustumCulled = false;
    const mtx = new THREE.Matrix4(), colr = new THREE.Color();
    let n = 0;
    for (const [i, j, pi] of cells) {
      for (let t = 0; t < T; t++) {
        mtx.makeTranslation((i - (w - 1) / 2) * u, (h - 1 - j) * u + u / 2, (t - (T - 1) / 2) * u);
        inst.setMatrixAt(n, mtx);
        colr.set(pal[pi]);
        const shade = t === T - 1 ? 1 : 1 - (T - 1 - t) * 0.1; // la face avant garde la couleur d'origine
        colr.multiplyScalar(shade);
        inst.setColorAt(n, colr);
        n++;
      }
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.voxel = inst;
    this.voxelGeo = geo;
    this.voxelMat = m;
    this.pivot.add(inst);
    this.labelHeight = 1.55 + 0.45;
    this.isVoxel = true;
  }

  // st : {speed, vy, grounded, flying, frozen, shield, yawMove, lateral}
  update(dt, st, camYaw) {
    const sp = Math.min(1, st.speed / 7.5);
    this.phase += dt * (6 + 8 * sp);
    const t = this.phase;
    const air = !st.grounded;
    if (this.isVoxel) {
      // le sprite fait toujours face à la caméra
      this.root.rotation.y = camYaw;
      const bob = st.grounded ? Math.abs(Math.sin(t)) * 0.07 * sp : 0;
      const stretch = air ? clamp(st.vy * 0.012, -0.12, 0.18) : 0;
      if (this.prevGrounded === false && st.grounded) this.squash = 0.28;
      this.squash = Math.max(0, this.squash - dt * 2.5);
      const sq = this.squash * Math.sin(this.squash * Math.PI * 2.2) * 0.0 + this.squash * 0.5;
      this.pivot.scale.set(1 + sq - stretch * 0.6, 1 - sq + stretch, 1 + sq);
      this.pivot.position.y = bob;
      this.pivot.rotation.z = clamp(-(st.lateral || 0) * 0.04, -0.3, 0.3);
      this.pivot.rotation.x = st.flying ? -0.5 : 0;
    } else {
      if (st.moveYaw !== undefined && (sp > 0.05 || st.flying)) {
        // rotation douce vers la direction de déplacement
        let diff = st.moveYaw - this.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.root.rotation.y += diff * Math.min(1, dt * 14);
      }
      const k = sp;
      let ll = 0, rr = 0, al = 0, ar = 0;
      if (st.flying) {
        ll = 0.2; rr = -0.1; al = -2.4; ar = -2.4;
        this.pivot.rotation.x = 0.9;
        this.pivot.position.y = Math.sin(t * 0.5) * 0.05;
      } else if (air) {
        ll = 0.7; rr = -0.5; al = -2.6 + Math.sin(t) * 0.2; ar = -2.6 - Math.sin(t) * 0.2;
        this.pivot.rotation.x = 0.1;
        this.pivot.position.y = 0;
      } else if (st.frozen) {
        // figé
      } else {
        const s = Math.sin(t);
        ll = s * 0.95 * k; rr = -s * 0.95 * k;
        al = -s * 0.8 * k; ar = s * 0.8 * k;
        this.pivot.rotation.x = 0.12 * k;
        this.pivot.position.y = Math.abs(Math.cos(t)) * 0.06 * k;
        if (k < 0.05) { // repos : légère respiration
          al = Math.sin(t * 0.3) * 0.05; ar = -al;
          this.pivot.position.y = 0;
        }
      }
      if (!st.frozen) {
        this.legL.rotation.x = ll; this.legR.rotation.x = rr;
        this.armL.rotation.x = al; this.armR.rotation.x = ar;
      }
      if (this.cape) this.cape.rotation.x = air ? 0.7 : 0.1 + 0.5 * sp + Math.sin(t * 0.8) * 0.08 * sp;
      if (this.tail) this.tail.rotation.y = Math.sin(t * 0.7) * 0.4;
      if (this.wings) {
        const f = air || st.flying ? Math.sin(t * 2.5) * 0.7 : 0.15;
        this.wings[0].rotation.z = f + 0.2;
        this.wings[1].rotation.z = -f - 0.2;
      }
    }
    this.prevGrounded = st.grounded;
    this.iceMesh.visible = !!st.frozen;
    this.shieldMesh.visible = !!st.shield;
    if (st.shield) this.shieldMesh.rotation.y += dt;
  }

  dispose() {
    if (this.label) { this.label.material.map.dispose(); this.label.material.dispose(); }
    if (this.voxel) { this.voxel.dispose(); this.voxelGeo.dispose(); this.voxelMat.dispose(); }
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
