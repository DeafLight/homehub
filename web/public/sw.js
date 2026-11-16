// Service worker de HomeHub, pour les notifications du téléphone seulement (« Pars dans 5 min ») : il affiche le
// message poussé par le serveur (Web Push, chiffré jusqu'ici) et ouvre l'appli quand on le touche. Aucun cache, aucune
// interception des requêtes : l'appli se charge comme sans lui.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = { title: 'HomeHub', body: '' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // message illisible : titre seul
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag || 'homehub',
      renotify: true,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: message.url || '/m' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/m', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) return open.navigate(url).then((w) => (w ?? open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
