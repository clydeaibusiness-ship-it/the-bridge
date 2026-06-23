/**
 * Check-in modal — the 30-second heartbeat.
 * Self-contained: injects its own styles + DOM, fetches the due check-in,
 * and handles answer / snooze. Include on any member page:
 *   <script src="/js/checkin.js"></script>
 *
 * Surfaces one check-in (metric rating, subjective rating, or an action
 * follow-up) before the member gets on with their day. Can be snoozed once
 * for 24h but not permanently dismissed.
 */
(function () {
  const STYLE = `
  .ci-overlay { position: fixed; inset: 0; background: rgba(10,10,15,0.55);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
    font-family: var(--font-ui, system-ui, sans-serif); padding: 1.5rem; }
  .ci-card { background: #f5f0e8; color: #0a0a0f; border-radius: 4px;
    max-width: 30rem; width: 100%; padding: 2rem 1.75rem 1.5rem; box-shadow: 0 12px 40px rgba(0,0,0,0.3); }
  .ci-kicker { font-family: var(--font-data, monospace); font-size: 0.5625rem; letter-spacing: 0.12em;
    text-transform: uppercase; color: #7a7570; margin-bottom: 0.75rem; }
  .ci-prompt { font-size: 1rem; line-height: 1.5; color: #1a1a1f; margin-bottom: 1.5rem; }
  .ci-scale { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.25rem; }
  .ci-num { flex: 1 1 auto; min-width: 2.1rem; padding: 0.55rem 0; text-align: center;
    font-family: var(--font-data, monospace); font-size: 0.8125rem; color: #3a3530;
    background: transparent; border: 1px solid #c8c0b0; border-radius: 2px; cursor: pointer; }
  .ci-num:hover { background: #0a0a0f; color: #f0ebe0; border-color: #0a0a0f; }
  .ci-text { width: 100%; box-sizing: border-box; min-height: 4.5rem; padding: 0.6rem 0.7rem;
    font-family: inherit; font-size: 0.875rem; border: 1px solid #c8c0b0; border-radius: 2px;
    background: #fff; color: #1a1a1f; margin-bottom: 1rem; resize: vertical; }
  .ci-choices { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
  .ci-btn { font-family: var(--font-data, monospace); font-size: 0.625rem; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 0.6rem 1rem; border-radius: 2px; cursor: pointer; border: none; }
  .ci-btn-dark { background: #0a0a0f; color: #f0ebe0; }
  .ci-btn-dark:hover { background: #1e1e2a; }
  .ci-btn-ghost { background: transparent; color: #3a3530; border: 1px solid #c8c0b0; }
  .ci-btn-ghost:hover { border-color: #3a3530; }
  .ci-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; }
  .ci-snooze { background: none; border: none; cursor: pointer; color: #7a7570;
    font-family: var(--font-data, monospace); font-size: 0.5625rem; letter-spacing: 0.08em;
    text-transform: uppercase; text-decoration: underline; }
  `;

  function injectStyle() {
    if (document.getElementById('ci-style')) return;
    const s = document.createElement('style');
    s.id = 'ci-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  async function api(path, method, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    return r.ok ? r.json() : null;
  }

  function close(overlay) { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }

  function render(checkIn) {
    injectStyle();
    const overlay = document.createElement('div');
    overlay.className = 'ci-overlay';

    const card = document.createElement('div');
    card.className = 'ci-card';

    const kicker = document.createElement('div');
    kicker.className = 'ci-kicker';
    kicker.textContent = 'A quick check-in';
    card.appendChild(kicker);

    const prompt = document.createElement('div');
    prompt.className = 'ci-prompt';
    prompt.textContent = checkIn.prompt_text;
    card.appendChild(prompt);

    if (checkIn.type === 'metric' || checkIn.type === 'subjective') {
      const scale = document.createElement('div');
      scale.className = 'ci-scale';
      for (let n = 1; n <= 10; n++) {
        const b = document.createElement('button');
        b.className = 'ci-num';
        b.textContent = String(n);
        b.addEventListener('click', async () => {
          await api('/api/member/check-in/answer', 'POST', { checkInId: checkIn.id, rating: n });
          close(overlay);
        });
        scale.appendChild(b);
      }
      card.appendChild(scale);
    } else if (checkIn.type === 'action_followup') {
      const ta = document.createElement('textarea');
      ta.className = 'ci-text';
      ta.placeholder = 'How did it go? (optional)';
      card.appendChild(ta);

      const choices = document.createElement('div');
      choices.className = 'ci-choices';

      const save = document.createElement('button');
      save.className = 'ci-btn ci-btn-dark';
      save.textContent = 'Save';
      save.addEventListener('click', async () => {
        await api('/api/member/check-in/answer', 'POST', {
          checkInId: checkIn.id, text_answer: ta.value.trim() || null
        });
        close(overlay);
      });
      choices.appendChild(save);
      card.appendChild(choices);
    } else {
      // Unknown type — acknowledge so it doesn't get stuck pending.
      const ok = document.createElement('button');
      ok.className = 'ci-btn ci-btn-dark';
      ok.textContent = 'OK';
      ok.addEventListener('click', async () => {
        await api('/api/member/check-in/answer', 'POST', { checkInId: checkIn.id });
        close(overlay);
      });
      card.appendChild(ok);
    }

    const foot = document.createElement('div');
    foot.className = 'ci-foot';
    const snooze = document.createElement('button');
    snooze.className = 'ci-snooze';
    snooze.textContent = 'Remind me tomorrow';
    snooze.addEventListener('click', async () => {
      await api('/api/member/check-in/snooze', 'POST', { checkInId: checkIn.id });
      close(overlay);
    });
    foot.appendChild(snooze);
    card.appendChild(foot);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  async function waitForClerk(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (window.Clerk) {
        try { if (!window.Clerk.loaded) await window.Clerk.load(); } catch (e) {}
        return;
      }
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async function init() {
    try {
      await waitForClerk(4000);
      const data = await api('/api/member/check-in', 'GET');
      if (data && data.checkIn) render(data.checkIn);
    } catch (e) {
      // Never let a check-in failure disrupt the page.
      console.log('check-in skipped:', e.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
