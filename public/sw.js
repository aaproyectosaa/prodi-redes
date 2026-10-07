/* Service worker de Prodi Redes: app instalable + avisos push (Web Push estándar, sin Firebase). */

// ---- App instalable: se activa enseguida y muestra una pantalla propia sin conexión ----
const OFFLINE_CACHE = 'prodi-offline-v2';
const OFFLINE_ARCHIVOS = ['/offline.html', '/icons/icon-192.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((c) => c.addAll(OFFLINE_ARCHIVOS)).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// Solo las pantallas (navegación): siempre de la red, así cada deploy se ve al toque.
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html').then((r) => r || Response.error()))
    );
    return;
  }
  // Lo que usa la pantalla sin conexión (el logo): de la red y, si no hay, de la caché.
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && OFFLINE_ARCHIVOS.includes(url.pathname)) {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname).then((r) => r || Response.error())));
  }
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
        // Con el sonido del sistema (la web no permite sonidos propios en las notificaciones).
        silent: false,
        renotify: !!data.tag,
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
      const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const enChatApp = (c) => new URL(c.url).pathname.startsWith('/chat-app');
      const destino = new URL(url, self.location.origin);
      // Avisos de chat: si Prodi Chat está abierta, ahí (/chat?c=x → /chat-app?c=x).
      if (destino.pathname === '/chat' || destino.pathname.startsWith('/chat/')) {
        const chat = ventanas.find(enChatApp);
        if (chat && 'focus' in chat) {
          await chat.focus();
          try {
            await chat.navigate('/chat-app' + destino.search);
          } catch (_) {}
          return;
        }
      }
      // El resto, en el sistema: nunca dentro de la app de chats (si solo está esa, se abre otra ventana).
      const allClients = ventanas.filter((c) => !enChatApp(c));
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
