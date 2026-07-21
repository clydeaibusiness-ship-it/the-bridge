/**
 * Service worker — receives push notifications from Earl and opens the chat
 * when the member taps one. Kept intentionally minimal: no caching, no
 * offline behavior, just push.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* plain text fallback */ }

  const title = data.title || 'Earl';
  const options = {
    body: data.body || (event.data ? event.data.text() : 'Earl sent you a message.'),
    icon: '/assets/earl.png',
    badge: '/assets/earl.png',
    tag: 'earl-checkin', // a newer check-in replaces an unread older one
    renotify: true,
    data: { url: data.url || '/app' },
    actions: [{ action: 'reply', title: 'Reply' }]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing app tab if one is open, else open a new one.
      for (const client of clientList) {
        if (client.url.includes('/app') || client.url.includes('/dashboard')) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
