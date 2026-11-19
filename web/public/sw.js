// Service worker de HomeHub, pour les notifications du téléphone seulement (« Pars dans 5 min », « Nouveaux mots », minuteurs,
// tâches en retard) : il affiche le
// message poussé par le serveur (Web Push, chiffré jusqu'ici) et, quand on le touche, ouvre l'appli à l'adresse du
// message (le trajet du rendez-vous annoncé, les mots, les tâches). Aucun cache, aucune
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
  // L'adresse du message (le trajet du rendez-vous annoncé : /m/agenda?trajet=…), jamais hors de HomeHub.
  let target = new URL(event.notification.data?.url || '/m', self.location.origin);
  if (target.origin !== self.location.origin) target = new URL('/m', self.location.origin);
  const url = target.href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (!open) return self.clients.openWindow(url);
      // navigate() n'est permis que sur une fenêtre que ce service worker contrôle : sinon, une nouvelle fenêtre.
      return open
        .navigate(url)
        .then((w) => (w ?? open).focus())
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
