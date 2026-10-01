// Configuration facultative. Tout fonctionne sans rien modifier ici.
export const CONFIG = {
  // Serveur de mise en relation WebRTC (signalisation uniquement : il ne voit pas le jeu).
  // Par défaut : le broker public gratuit de PeerJS (0.peerjs.com). Pour utiliser le tien :
  //   peer: { host: 'mon-peerjs.exemple.com', port: 443, path: '/', secure: true }
  peer: {},

  // Classement GLOBAL facultatif et gratuit (sans serveur à gérer) : une base Firebase Realtime Database.
  // Voir README.md (section « Classement mondial »). Laisse vide pour un classement local + salle.
  // Exemple : 'https://mon-projet-default-rtdb.europe-west1.firebasedatabase.app'
  firebaseUrl: '',
};
