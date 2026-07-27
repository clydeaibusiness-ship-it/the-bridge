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

// Network pass-through. A registered fetch handler is what makes the app
// installable as a PWA. We deliberately don't cache the app shell — the
// content is authenticated and should always come fresh from the server.
self.addEventListener('fetch', () => {});

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
    data: { url: data.url || '/app', token: data.token || null },
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
    const token = (notification.data && notification.data.token) || null;
    notification.close();
    if (!text) {
      // No inline text box on this platform — open the chat to reply there.
      event.waitUntil(openChat());
      return;
    }
    // The token authenticates the reply on its own, so it works even when the
    // login cookie has gone stale (a reply typed minutes after the push). If
    // it still fails, tell them — never lose their words silently.
    event.waitUntil(
      fetch('/api/member/checkin/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text, token })
      })
        .then((r) => { if (!r.ok) throw new Error('http ' + r.status); })
        .catch(() =>
          self.registration.showNotification('Earl', {
            body: "Your reply didn't send. Tap to open the chat and send it again.",
            icon: '/assets/earl.png',
            badge: '/assets/earl.png',
            data: { url: '/app' }
          })
        )
    );
    return;
  }

  // Body tap — open the conversation.
  notification.close();
  event.waitUntil(openChat());
});
