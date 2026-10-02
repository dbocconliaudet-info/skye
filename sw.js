/* Skye — service worker
 *
 * Stratégie : réseau d'abord pour les fichiers de l'app, cache en secours.
 * C'est volontaire : après un `git push`, la nouvelle version doit apparaître
 * immédiatement sur les téléphones. Un cache prioritaire ferait gagner
 * quelques centaines de millisecondes au chargement, au prix de « j'ai
 * modifié l'app mais je vois toujours l'ancienne », ce qui est le pire
 * problème possible quand on itère souvent.
 *
 * Les dépendances externes (polices, SDK Supabase) sont versionnées dans leur
 * URL : elles, on les sert depuis le cache en priorité.
 */

const VERSION = 'skye-v8';
const COQUILLE = [
  './',
  './index.html',
  './manifest.json',
  './css/tokens.css',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/etat.js',
  './js/ui.js',
  './js/taches.js',
  './js/courses.js',
  './js/tricount.js',
  './js/anniversaires.js',
  './js/personnel.js',
  './brand/skye-icone-favicon.svg',
  './brand/skye-mark-animated.svg',
  './brand/png/skye-icon-192.png',
  './brand/png/skye-icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // addAll échoue en bloc si un seul fichier manque : on tolère les ratés
      .then((c) => Promise.allSettled(COQUILLE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Appels à Supabase : jamais de cache, les données doivent être fraîches.
  if (url.hostname.endsWith('.supabase.co')) return;

  const memeOrigine = url.origin === self.location.origin;

  if (memeOrigine) {
    // Réseau d'abord, cache en secours (hors ligne).
    e.respondWith(
      fetch(req)
        .then((rep) => {
          if (rep && rep.ok) {
            const copie = rep.clone();
            caches.open(VERSION).then((c) => c.put(req, copie));
          }
          return rep;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Ressources externes immuables (polices, SDK) : cache d'abord.
  e.respondWith(
    caches.match(req).then((cache) => cache || fetch(req).then((rep) => {
      if (rep && (rep.ok || rep.type === 'opaque')) {
        const copie = rep.clone();
        caches.open(VERSION).then((c) => c.put(req, copie));
      }
      return rep;
    }))
  );
});
