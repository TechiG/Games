# 🏃 Tumble Rush

Course de plateformes **3D infinie** façon *Fall Guys*, **jouable à plusieurs en ligne sans aucun serveur à payer**.
Tout tourne dans le navigateur (PC, mobile, tablette, manette) : un simple site statique.

- 🌍 **Piste infinie générée au hasard** (une nouvelle à chaque manche), qui devient de plus en plus dure.
- 🟧 **Plateformes qui tombent**, plateformes mobiles, trampolines, glace, barres rotatives, checkpoints.
- 🌪️ **Événements** toutes les ~30 s : vent violent, pluie de météores, verglas, brouillard, commandes inversées, séisme, gravité lourde.
- 🎁 **Pouvoirs temporaires** (boîtes « ? ») : 🦘 super saut · 🕊️ vol · ⚡ turbo · 🛡️ bouclier · 💥 onde de choc · 🧊 gel · 🌀 confusion · 🌋 séisme sous un adversaire.
- 🧑‍🎤 **Personnage sur mesure** : tape « Goku », « pirate », « chat »… et un personnage 3D est généré ; ou importe une image (ou fais-la dessiner par IA) et elle est transformée en **personnage 3D en voxels**.
- 🏆 **Classements** : sur ton appareil, dans la salle, et (option) mondial.
- 🌐 **Multijoueur P2P** (WebRTC) : un joueur crée une salle, partage le code/lien, les autres rejoignent. Si l'hôte part, un autre joueur reprend la main.

## Jouer

Le jeu est 100 % statique (aucune compilation) mais utilise des modules ES : il faut le servir en HTTP.

```bash
# n'importe quel serveur de fichiers statiques fait l'affaire
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

### Héberger gratuitement (GitHub Pages)

1. Pousse ce dépôt sur GitHub.
2. *Settings → Pages → Build and deployment → Source : **GitHub Actions***.
3. Le workflow `.github/workflows/pages.yml` publie le site à chaque push sur `main`.

Aucun autre service n'est nécessaire : envoie simplement le lien à tes amis.

## Commandes

| Action | Clavier | Tactile / manette |
|---|---|---|
| Se déplacer | `Z Q S D` / `W A S D` / flèches | joystick (moitié gauche) / stick gauche |
| Sauter (maintenu = plus haut) | `Espace` | bouton ⤒ / A |
| Plonger (pousse les autres) · descendre en vol | `Maj` / `F` | bouton 💨 / X |
| Utiliser le pouvoir | `E` / `Entrée` | bouton ⚡ / B |
| Caméra | souris (clic pour capturer) | glisser à droite / stick droit |
| Classement | `Tab` | bouton 🏆 |
| Son · Pause | `M` · `Échap` | boutons |

## Comment marche le multijoueur sans serveur ?

- **Connexion directe entre navigateurs** (WebRTC, bibliothèque [PeerJS](https://peerjs.com)) : les données de jeu ne passent par aucun serveur.
- Seule la *mise en relation* initiale passe par le serveur de signalisation public et gratuit de PeerJS (`0.peerjs.com`). PeerJS fournit aussi des serveurs STUN/TURN gratuits pour traverser les box/NAT.
- **La piste n'est jamais envoyée** : tous les joueurs reçoivent la même *graine* aléatoire et génèrent exactement la même piste (générateur déterministe). Idem pour le calendrier des événements.
- Réseau en **maillage** : chaque joueur est relié à tous les autres (idéal jusqu'à ~8 joueurs). L'hôte (le plus ancien joueur présent) lance les manches ; s'il quitte, le suivant devient hôte.

> ⚠️ Si le broker public est un jour indisponible, tu peux utiliser le tien (gratuit à héberger, p. ex. `npx peerjs --port 9000`) :
> `js/config.js` → `peer: { host: 'mon-serveur', port: 443, path: '/', secure: true }`
> (ou, pour tester : `?peerhost=localhost&peerport=9000&peerpath=/&peersecure=0` dans l'URL).

## Classement mondial (facultatif, gratuit)

Sans serveur dédié, le classement est local (appareil) + celui de la salle. Pour un classement mondial :

1. Crée un projet gratuit sur [Firebase](https://firebase.google.com) → *Realtime Database* (mode verrouillé).
2. Colle ces règles (lecture publique, écriture en ajout seul, validées) :
   ```json
   {
     "rules": {
       "scores": {
         ".read": true,
         ".indexOn": ["score"],
         "$id": {
           ".write": "!data.exists()",
           ".validate": "newData.hasChildren(['name','score','t']) && newData.child('score').isNumber() && newData.child('score').val() >= 0 && newData.child('score').val() <= 100000 && newData.child('name').isString() && newData.child('name').val().length <= 14"
         }
       }
     }
   }
   ```
3. Dans `js/config.js`, renseigne `firebaseUrl: 'https://TON-PROJET-default-rtdb.europe-west1.firebasedatabase.app'`.

> Un classement 100 % côté client ne peut pas empêcher la triche : c'est un classement « entre amis ».

## Personnages

- **Texte → personnage** : 70+ personnages et thèmes reconnus (plus de 200 mots-clés : goku, mario, pikachu, naruto, batman, pirate, robot, chat, licorne…) en français et en anglais, avec modificateurs (« super saiyan », « rouge »…). Un texte inconnu génère un personnage inventé mais stable (même texte = même look).
- **Image → 3D** : l'image est détourée (fond retiré), réduite en grille, quantifiée en 24 couleurs puis extrudée en **voxels**. Le personnage est envoyé aux autres joueurs sous forme compacte (~1,5 Ko).
- **Image IA** : le bouton « 🎨 Image IA → 3D » demande une image au service public gratuit [Pollinations](https://pollinations.ai) (aucune clé) puis la convertit en 3D. Il nécessite Internet ; en cas d'échec, le jeu garde ton personnage actuel.

## Structure

```
index.html · css/style.css
js/main.js      démarrage
js/game.js      moteur : manches, joueurs, réseau, pouvoirs, événements, caméra, HUD
js/track.js     génération déterministe de la piste infinie
js/events.js    calendrier déterministe des événements
js/player.js    physique du joueur (collisions AABB, plateformes mobiles)
js/world.js     rendu 3D, décor, plateformes dynamiques, effets
js/avatar.js    personnages (blocs, voxels, texte→perso, image→voxels)
js/net.js       multijoueur P2P (PeerJS) en maillage + élection d'hôte
js/powers.js · scores.js · audio.js · input.js · ui.js · config.js
vendor/         three.js (r170) et PeerJS 1.5 (copies locales, MIT)
```

## Tests

```bash
npm test   # (ou : node tests/track.test.mjs)
```

Vérifie que la piste générée est **identique pour tous les joueurs** (même graine) et que **chaque saut de plateforme à plateforme est réalisable** avec la vraie physique du jeu, jusqu'à la difficulté maximale.

## Licences

Code du jeu : voir le dépôt. `vendor/three.module.min.js` (MIT, © three.js authors) et `vendor/peerjs.min.js` (MIT, © PeerJS authors).
