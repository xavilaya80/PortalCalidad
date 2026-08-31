/* PORTAL CALIDAD - Service Worker
   Misma logica que el de AppCalidad, con una diferencia importante: aca NO se
   cachea ninguna respuesta de la API. Las especificaciones tecnicas y la lista
   de PDFs deben estar siempre al dia; servir una version vieja de una
   especificacion desde cache seria peor que no mostrar nada. */

const CACHE_NAME = 'portal-calidad-v1';

const HOSTS_API = ['script.google.com', 'script.googleusercontent.com'];

const ASSETS_LOCALES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

const TIMEOUT_RED_MS = 3500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS_LOCALES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // La API nunca se intercepta: un fallo de red tiene que llegar a la app como
  // fallo, no como una respuesta inventada.
  if (HOSTS_API.indexOf(url.hostname) !== -1) return;
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Archivos propios: red primero, cache de respaldo. Asi una correccion
  // publicada llega sin tener que cambiar CACHE_NAME a mano.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const res = await Promise.race([
        fetch(e.request),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('timeout')), TIMEOUT_RED_MS))
      ]);
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      if (e.request.mode === 'navigate') {
        const index = await cache.match('index.html');
        if (index) return index;
      }
      throw err;
    }
  })());
});
