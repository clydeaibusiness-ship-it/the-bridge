/**
 * push.js — enables phone/desktop notifications from Earl.
 *
 * Replaces the old check-in modal (checkin.js). Earl now reaches out on his
 * own via push; this script gets the device subscribed and exposes a small
 * API (window.EarlPush) so the Settings toggle in the app can turn
 * notifications on and off and send a test.
 *
 *  - Permission already granted → silently (re)subscribe so the server
 *    always has a fresh endpoint.
 *  - Permission not asked yet → a small one-time banner nudges them; the
 *    real control lives in Settings.
 *  - iPhone Safari not installed to home screen → Apple only allows web
 *    push for installed sites, so we explain the one-time Add-to-Home-Screen
 *    step instead.
 *
 * Include on member pages: <script src="/js/push.js"></script>
 */
(function () {
  const DISMISS_KEY = 'earlPushPromptDismissed';

  const STYLE = `
  .pu-banner { position: fixed; left: 50%; transform: translateX(-50%); bottom: 1rem;
    z-index: 9998; background: #f5f0e8; color: #0a0a0f; border: 1px solid #c8a96e;
    border-radius: 4px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); max-width: 26rem;
    width: calc(100% - 2rem); padding: 0.9rem 1rem; display: flex; align-items: center;
    gap: 0.75rem; font-family: var(--font-ui, system-ui, sans-serif); }
  .pu-pfp { width: 36px; height: 36px; border-radius: 50%; object-fit: cover;
    object-position: center top; flex: 0 0 auto; border: 1px solid #c8a96e; }
  .pu-text { flex: 1; font-size: 0.8125rem; line-height: 1.45; color: #1a1a1f; }
  .pu-btn { font-family: var(--font-data, monospace); font-size: 0.625rem; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 0.55rem 0.9rem; border-radius: 2px; cursor: pointer;
    border: none; background: #0a0a0f; color: #f0ebe0; flex: 0 0 auto; }
  .pu-btn:hover { background: #1e1e2a; }
  .pu-x { background: none; border: none; cursor: pointer; color: #7a7570;
    font-size: 1rem; line-height: 1; padding: 0.25rem; flex: 0 0 auto; }
  `;

  function injectStyle() {
    if (document.getElementById('pu-style')) return;
    const s = document.createElement('style');
    s.id = 'pu-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  // Register the SW and create+save a push subscription. Assumes permission
  // is already granted (caller handles the prompt).
  async function subscribe() {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const keyResp = await fetch('/api/member/push/vapid-public-key');
    if (!keyResp.ok) throw new Error('no vapid key');
    const { key } = await keyResp.json();
    if (!key) throw new Error('push not configured');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
    }

    const save = await fetch('/api/member/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!save.ok) throw new Error('subscription save failed');
  }

  // ---- Public API used by the Settings toggle ----
  const EarlPush = {
    supported,
    isIos,
    isStandalone,
    // 'on' (subscribed) | 'off' (supported, not on) | 'blocked' | 'needs-install' | 'unsupported'
    async status() {
      if (isIos() && !isStandalone()) return 'needs-install';
      if (!supported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'blocked';
      if (Notification.permission === 'granted') {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = reg && (await reg.pushManager.getSubscription());
          return sub ? 'on' : 'off';
        } catch (e) { return 'off'; }
      }
      return 'off';
    },
    // Turn on: request permission (if needed) then subscribe. Returns the
    // resulting status so the caller can message the member.
    async enable() {
      if (isIos() && !isStandalone()) return 'needs-install';
      if (!supported()) return 'unsupported';
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
      await subscribe();
      return 'on';
    },
    // Turn off: unsubscribe this device and tell the server to forget it.
    async disable() {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && (await reg.pushManager.getSubscription());
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await fetch('/api/member/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint })
          });
        }
      } catch (e) { console.error('push disable failed:', e.message); }
      return 'off';
    },
    // Ask the server to send this member a check-in right now (test button).
    async sendTest() {
      const r = await fetch('/api/member/push/test', { method: 'POST' });
      if (!r.ok) throw new Error('test send failed');
      return r.json();
    }
  };
  window.EarlPush = EarlPush;

  // ---- First-time discovery banner ----
  function showBanner() {
    injectStyle();
    const banner = document.createElement('div');
    banner.className = 'pu-banner';

    const pfp = document.createElement('img');
    pfp.className = 'pu-pfp';
    pfp.src = '/assets/earl.png';
    pfp.alt = 'Earl';
    banner.appendChild(pfp);

    const text = document.createElement('div');
    text.className = 'pu-text';

    const needsInstall = isIos() && !isStandalone();
    if (needsInstall) {
      text.textContent = 'Want Earl to check in on your phone? Tap Share, then "Add to Home Screen" — then open Earl from there and turn on notifications in Settings.';
      banner.appendChild(text);
    } else {
      text.textContent = 'Want Earl to check in on your phone? He reaches out between conversations — a question or a thought, when the timing is right.';
      banner.appendChild(text);

      const btn = document.createElement('button');
      btn.className = 'pu-btn';
      btn.textContent = 'Enable';
      btn.addEventListener('click', async () => {
        try { await EarlPush.enable(); } catch (e) { console.error('push enable failed:', e.message); }
        close();
      });
      banner.appendChild(btn);
    }

    const x = document.createElement('button');
    x.className = 'pu-x';
    x.setAttribute('aria-label', 'Dismiss');
    x.innerHTML = '&times;';
    x.addEventListener('click', () => {
      localStorage.setItem(DISMISS_KEY, '1');
      close();
    });
    banner.appendChild(x);

    function close() {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }

    document.body.appendChild(banner);
  }

  async function init() {
    try {
      if (!supported()) {
        // iOS Safari outside a home-screen install has no PushManager —
        // still worth showing the install nudge once.
        if (isIos() && !isStandalone() && !localStorage.getItem(DISMISS_KEY)) showBanner();
        return;
      }

      if (Notification.permission === 'granted') {
        // Already enabled — refresh the subscription quietly.
        await subscribe();
        return;
      }

      if (Notification.permission === 'default' && !localStorage.getItem(DISMISS_KEY)) {
        showBanner();
      }
      // 'denied' — respect it, never nag.
    } catch (e) {
      console.log('push setup skipped:', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
