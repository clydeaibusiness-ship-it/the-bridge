// ============================================================
// ANALYTICS.JS — Anonymous event logging to Supabase.
// Player is never identified. Session ID is random per session.
// ============================================================

const SESSION_ID = crypto.randomUUID();

export async function logEvent(eventData) {
  try {
    await fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        ...eventData,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (e) {
    // Silent fail — analytics must never break gameplay
  }
}
