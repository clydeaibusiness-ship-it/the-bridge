// Web-push enrollment for the app. Registers the service worker, asks for
// permission, subscribes with the server's VAPID key, and saves the
// subscription. The backend (checkin worker) pushes the daily pulse to it.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushResult = "on" | "denied" | "unsupported" | "error";

export async function enablePush(
  fetchVapidKey: () => Promise<string>,
  saveSubscription: (sub: unknown) => Promise<void>
): Promise<PushResult> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      return "unsupported";
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const key = await fetchVapidKey();
    if (!key) return "error";

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));

    await saveSubscription(sub.toJSON());
    return "on";
  } catch {
    return "error";
  }
}

export function pushState(): "on" | "off" | "denied" | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "on";
  return "off";
}
