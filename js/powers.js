// Pouvoirs temporaires ramassés dans les boîtes « ? ».
export const POWERS = {
  jump: { icon: '🦘', name: 'Super saut', kind: 'buff', dur: 10, w: 4, hint: 'Sauts +75 % pendant 10 s' },
  fly: { icon: '🕊️', name: 'Vol', kind: 'buff', dur: 6, w: 3, hint: 'Espace = monter · Maj = descendre (6 s)' },
  speed: { icon: '⚡', name: 'Turbo', kind: 'buff', dur: 8, w: 4, hint: 'Vitesse +60 % pendant 8 s' },
  shield: { icon: '🛡️', name: 'Bouclier', kind: 'buff', dur: 14, w: 3, hint: 'Bloque la prochaine attaque' },
  shock: { icon: '💥', name: 'Onde de choc', kind: 'attack', w: 4, hint: 'Repousse les joueurs proches' },
  freeze: { icon: '🧊', name: 'Gel', kind: 'attack', w: 3, hint: 'Fige les joueurs proches' },
  confuse: { icon: '🌀', name: 'Confusion', kind: 'attack', w: 3, hint: 'Inverse leurs commandes' },
  tremor: { icon: '🌋', name: 'Séisme', kind: 'attack', w: 3, hint: 'Fait tomber le sol sous un adversaire' },
};

export const ATTACK_RADIUS = { shock: 11, freeze: 18, confuse: 26 };
export const TREMOR_RANGE = 55;
export const TREMOR_RADIUS = 11;

// Tire un pouvoir au hasard ; sans adversaire, uniquement des bonus personnels.
export function rollPower(hasOpponents) {
  const list = Object.entries(POWERS).filter(([, p]) => hasOpponents || p.kind === 'buff');
  let sum = 0;
  for (const [, p] of list) sum += p.w;
  let r = Math.random() * sum;
  for (const [k, p] of list) { r -= p.w; if (r <= 0) return k; }
  return list[0][0];
}
