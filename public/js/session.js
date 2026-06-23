/**
 * Session Manager — Supabase is the source of truth, localStorage is cache
 *
 * Usage:
 *   const session = await BridgeSession.load();
 *   await BridgeSession.save(session);
 */
window.BridgeSession = (function () {
  'use strict';

  var CACHE_KEY = 'bridge_session';

  /** Read from localStorage cache */
  function getCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  /** Write to localStorage cache */
  function setCache(session) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(session));
    } catch (e) { /* localStorage unavailable */ }
  }

  /**
   * Load session — tries Supabase first, falls back to cache
   * Returns the session object or null if nothing exists
   */
  async function load() {
    var serverHasData = false;

    // 1. Try Supabase (the source of truth)
    try {
      var resp = await fetch('/api/intake/data');
      if (resp.ok) {
        var data = await resp.json();
        if (data.session && (data.session.businessName || data.session.completedAt)) {
          serverHasData = true;
          // Merge with intake answers
          var session = data.session;
          // Ensure intakeAnswers is populated
          if (!session.intakeAnswers && data.intake) {
            session.intakeAnswers = data.intake;
          }
          // Cache locally for performance
          setCache(session);
          return session;
        }
      }
    } catch (e) {
      console.warn('Failed to load session from server:', e.message);
    }

    // 2. Fall back to cache
    var cached = getCache();

    // 3. If cache has data but server doesn't, sync UP to server
    if (cached && !serverHasData && (cached.businessName || cached.intakeAnswers || cached.completedAt)) {
      console.log('Syncing local session data up to server...');
      try {
        await fetch('/api/session/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: cached })
        });
        console.log('Session synced to server successfully');
      } catch (e) {
        console.warn('Session sync to server failed:', e.message);
      }
    }

    return cached;
  }

  /**
   * Save session — writes to Supabase (primary) AND localStorage (cache)
   * Partial saves are fine — only provided fields are updated
   */
  async function save(session) {
    if (!session) return;

    // Always update cache immediately (fast UI)
    var cached = getCache() || {};
    var merged = Object.assign({}, cached, session);
    setCache(merged);

    // Save to Supabase (the source of truth)
    try {
      await fetch('/api/session/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: session })
      });
    } catch (e) {
      console.warn('Failed to save session to server:', e.message);
      // Data is still in localStorage cache — will sync on next successful save
    }
  }

  /**
   * Save only to cache (for high-frequency updates)
   * Call save() periodically to sync to Supabase
   */
  function saveLocal(session) {
    if (!session) return;
    var cached = getCache() || {};
    setCache(Object.assign({}, cached, session));
  }

  /**
   * Merge updates into current session and save
   */
  async function update(updates) {
    var cached = getCache() || {};
    var merged = Object.assign({}, cached, updates);
    setCache(merged);
    try {
      await fetch('/api/session/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: updates })
      });
    } catch (e) {
      console.warn('Session update to server failed:', e.message);
    }
    return merged;
  }

  return {
    load: load,
    save: save,
    saveLocal: saveLocal,
    update: update,
    getCache: getCache,
    setCache: setCache
  };
})();
