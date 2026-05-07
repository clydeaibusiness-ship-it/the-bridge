const express = require('express');
const router = express.Router();
const { personalizeIntake, generateDebrief, commanderChat } = require('../services/claude');
const { 
  saveGameState, getGameState, saveRunHistory, getRunHistory,
  upsertAnonymousEvent, getCommanderUsage, incrementCommanderUsage
} = require('../services/supabase');

// ---- Game API (no auth required) ----

/**
 * POST /api/game/personalize
 * Intake personalization — ship name, destination, flavor text
 */
router.post('/game/personalize', async (req, res) => {
  try {
    const { intake } = req.body;
    if (!intake) return res.status(400).json({ error: 'Intake data required' });

    const result = await personalizeIntake(intake);
    res.json(result);
  } catch (e) {
    console.error('Personalize error:', e.message);
    res.status(500).json({
      ship_name: 'The Venture',
      destination_name: 'North Star',
      flavor_text: 'Your ship awaits, Captain.'
    });
  }
});

/**
 * POST /api/game/debrief
 * Run-end debrief — Navigation Chart lite
 */
router.post('/game/debrief', async (req, res) => {
  try {
    const { run_history, intake_answers } = req.body;
    if (!run_history) return res.status(400).json({ error: 'Run history required' });

    const debriefText = await generateDebrief(run_history, intake_answers);

    // Save to database if user is authenticated
    // For now, return the debrief with a generated ID
    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    res.json({ id, debrief: debriefText });
  } catch (e) {
    console.error('Debrief error:', e.message);
    res.status(500).json({ error: 'Failed to generate debrief' });
  }
});

/**
 * GET /api/game/state
 * Load saved game state (requires auth cookie)
 */
router.get('/game/state', async (req, res) => {
  // TODO: Extract user from Clerk session
  // For now, return null (no saved state)
  res.json(null);
});

/**
 * POST /api/game/state
 * Save game state
 */
router.post('/game/state', async (req, res) => {
  // TODO: Extract user from Clerk session, save to Supabase
  res.json({ saved: true });
});

// ---- Analytics (no auth) ----

/**
 * POST /api/analytics/event
 * Anonymous event logging
 */
router.post('/analytics/event', async (req, res) => {
  try {
    await upsertAnonymousEvent(req.body);
    res.json({ ok: true });
  } catch (e) {
    // Silent fail — never break the game for analytics
    res.json({ ok: true });
  }
});

// ---- Member API (auth required) ----

/**
 * GET /api/member/commander/sessions
 * Get Commander session usage
 */
router.get('/member/commander/sessions', async (req, res) => {
  // TODO: Auth check
  res.json({ used: 0, max: 20 });
});

/**
 * POST /api/member/commander/message
 * Send message to Commander
 */
router.post('/member/commander/message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    // TODO: Auth check, get user, check session limits
    // TODO: Load game state and run history for context

    const gameState = {}; // placeholder
    const runHistory = []; // placeholder

    const response = await commanderChat(message, gameState, runHistory);

    res.json({ response });
  } catch (e) {
    console.error('Commander error:', e.message);
    res.status(500).json({ error: 'Commander unavailable' });
  }
});

/**
 * GET /api/member/runs
 * Get run history
 */
router.get('/member/runs', async (req, res) => {
  // TODO: Auth check
  res.json([]);
});

/**
 * GET /api/member/chart
 * Get latest Navigation Chart
 */
router.get('/member/chart', async (req, res) => {
  // TODO: Auth check, return latest chart
  res.json(null);
});

module.exports = router;
