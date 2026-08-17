/**
 * Service worker — Earl's notifications (new app, app.captainsbridge.io).
 *
 * Push arrives → show a notification with a Reply action (inline text on Android
 * Chrome) and Clear. Tapping the body opens the app. The reply posts straight to
 * the API. Because the app lives on app.captainsbridge.io but the API is on
 * captainsbridge.io, the reply goes to the parent origin (derived below), and
 * the signed reply token authenticates it without a cookie.
 */

// API is on the parent domain: app.captainsbridge.io -> captainsbridge.io.
const API_BASE = self.location.origin.replace(/\/\/app\./, "//");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // registered handler = installable PWA

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* text fallback */ }

  const title = data.title || "Earl";
  const options = {
    body: data.body || (event.data ? event.data.text() : "Earl sent you a message."),
    icon: "/assets/earl.png",
    badge: "/assets/earl.png",
    tag: "earl-checkin",
    renotify: true,
    data: { token: data.token || null },
    actions: [
      { action: "reply", type: "text", title: "Reply", placeholder: "Reply to Earl…" },
      { action: "clear", title: "Clear" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

function openApp() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if (client.url.startsWith(self.location.origin)) return client.focus();
    }
    return self.clients.openWindow("/");
  });
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;

  if (event.action === "clear") { notification.close(); return; }

  if (event.action === "reply") {
    const text = (event.reply || "").trim();
    const token = (notification.data && notification.data.token) || null;
    notification.close();
    if (!text) { event.waitUntil(openApp()); return; }
    event.waitUntil(
      fetch(API_BASE + "/api/member/checkin/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, token }),
      })
        .then((r) => { if (!r.ok) throw new Error("http " + r.status); })
        .catch(() =>
          self.registration.showNotification("Earl", {
            body: "Your reply didn't send. Tap to open the chat and send it again.",
            icon: "/assets/earl.png",
            badge: "/assets/earl.png",
          })
        )
    );
    return;
  }

  notification.close();
  event.waitUntil(openApp());
});
