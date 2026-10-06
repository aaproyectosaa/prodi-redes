/* Service worker de Prodi Redes: app instalable + avisos push (Web Push estándar, sin Firebase). */

// ---- App instalable: se activa enseguida y muestra una pantalla propia sin conexión ----
const OFFLINE_CACHE = 'prodi-offline-v2';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((c) => c.addAll(['/offline.html', '/icons/icon-192.png'])).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// Solo las pantallas (navegación): siempre de la red, así cada deploy se ve al toque.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match('/offline.html').then((r) => r || Response.error()))
  );
});

// ---- Avisos push ----
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Prodi', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Prodi';
  const url = data.url || '/';
  event.waitUntil(
    (async () => {
      // Con la app abierta y a la vista, se avisa adentro (toast) en vez de la notificación del sistema.
      const abiertas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const visible = abiertas.find((c) => c.visibilityState === 'visible');
      if (visible) {
        visible.postMessage({ tipo: 'prodi-push', title, body: data.body || '', url });
        return;
      }
      await self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.tag || undefined,
        data: { url },
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client && url) {
            try {
              await client.navigate(url);
              return;
            } catch (_) {}
          }
          return;
        }
      }
      if (clients.openWindow) await clients.openWindow(url);
    })()
  );
});
