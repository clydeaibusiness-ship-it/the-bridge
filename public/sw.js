/**
 * Service worker — Earl's notifications.
 *
 * Push arrives → show a notification with two actions:
 *   Reply  — an inline text box (Android Chrome); the member types back and
 *            it posts straight to the server, no app open required. Earl's
 *            answer comes back as another notification.
 *   Clear  — dismiss it.
 * Tapping the body (not an action) opens the chat.
 *
 * Inline text reply is supported on Android Chrome. On desktop/other platforms
 * that don't support it, "Reply" has no text box, so we fall back to opening
 * the chat where they can respond normally.
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
    tag: 'earl-checkin',      // a newer message replaces an unread older one
    renotify: true,
    data: { url: data.url || '/app' },
    actions: [
      { action: 'reply', type: 'text', title: 'Reply', placeholder: 'Reply to Earl…' },
      { action: 'clear', title: 'Clear' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

function openChat() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if (client.url.includes('/app') || client.url.includes('/dashboard')) return client.focus();
    }
    return self.clients.openWindow('/app');
  });
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;

  // Clear — just dismiss.
  if (event.action === 'clear') {
    notification.close();
    return;
  }

  // Reply — send the typed text straight to the server.
  if (event.action === 'reply') {
    const text = (event.reply || '').trim();
    notification.close();
    if (!text) {
      // No inline text box on this platform — open the chat to reply there.
      event.waitUntil(openChat());
      return;
    }
    event.waitUntil(
      fetch('/api/member/checkin/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text })
      }).catch(() => { /* Earl's reply push will confirm; failures stay quiet here */ })
    );
    return;
  }

  // Body tap — open the conversation.
  notification.close();
  event.waitUntil(openChat());
});
