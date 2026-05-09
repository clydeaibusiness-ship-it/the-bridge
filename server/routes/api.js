const express = require('express');
const router = express.Router();
const { personalizeIntake, generateSituation, generateDebrief, commanderChat } = require('../services/claude');
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
 * POST /api/game/intake
 * Intake personalization — reads Big Book of Strategy, returns
 * personalized ship name, destination, and industry key.
 * Falls back to lawn care defaults on failure.
 */
router.post('/game/intake', async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers) return res.status(400).json({ error: 'Intake answers required' });

    const result = await personalizeIntake(answers);
    // Ensure industry_key is present
    if (!result.industry_key) result.industry_key = 'lawn_care';
    res.json(result);
  } catch (e) {
    console.error('Intake error:', e.message);
    res.status(500).json({
      ship_name: 'ISV Greenline',
      destination_name: 'Growth Horizon',
      industry_key: 'lawn_care',
      flavor_text: 'Your business is waiting. The decisions ahead are yours to make.'
    });
  }
});

/**
 * POST /api/game/situation
 * Generate a single personalized situation using Claude API
 * Receives: businessContext, situationNumber, previousThemes
 * Falls back to static situations.json on failure
 */
router.post('/game/situation', async (req, res) => {
  const { businessContext, situationNumber, previousThemes } = req.body;

  if (!businessContext || !situationNumber) {
    return res.status(400).json({ error: 'businessContext and situationNumber required' });
  }

  try {
    const situation = await generateSituation(
      businessContext,
      situationNumber,
      previousThemes || []
    );
    res.json(situation);
  } catch (e) {
    console.error(`Situation ${situationNumber} generation failed:`, e.message);
    // Fall back to static situation
    try {
      const fs = require('fs');
      const path = require('path');
      const staticData = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../../public/data/situations.json'), 'utf8')
      );
      const fallback = staticData.situations[situationNumber - 1];
      if (fallback) {
        console.log(`Falling back to static situation ${situationNumber}`);
        res.json(fallback);
      } else {
        res.status(500).json({ error: 'No fallback available' });
      }
    } catch (fallbackErr) {
      console.error('Static fallback also failed:', fallbackErr.message);
      res.status(500).json({ error: 'Generation failed' });
    }
  }
});

/**
 * POST /api/game/debrief
 * Run-end debrief — accepts both old format (run_history) and new format (intakeAnswers/runSummary)
 */
router.post('/game/debrief', async (req, res) => {
  try {
    const { run_history, intake_answers, intakeAnswers, runSummary } = req.body;

    // Support new payload format from redesigned game
    const history = run_history || runSummary;
    const intake = intake_answers || intakeAnswers;

    if (!history) return res.status(400).json({ error: 'Run data required' });

    // If new format, build a targeted prompt
    let debriefText;
    if (runSummary) {
      const { callClaude } = require('../services/claude');
      const prompt = `
A captain's ship has been destroyed. Based on their run data
and the Big Book of Strategy framework, produce a concise
strategic debrief in plain English. Be direct and specific.
Maximum 150 words. Reference their actual lever allocation.

Run data:
${JSON.stringify(runSummary, null, 2)}

Intake answers:
${JSON.stringify(intakeAnswers || {}, null, 2)}

Format:
What destroyed your ship: [one sentence]
The pattern: [one sentence]
The one thing: [one sentence]
Your next run: [one sentence and a question]
      `;
      debriefText = await callClaude(prompt);
    } else {
      debriefText = await generateDebrief(history, intake);
    }

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

/**
 * POST /api/game/save
 * Save game state (new format from redesigned game)
 */
router.post('/game/save', async (req, res) => {
  try {
    const { stats, mission, passengers, systems } = req.body;
    // For unauthenticated users, just acknowledge the save
    // TODO: When auth is wired, save to Supabase game_state table
    res.json({ success: true });
  } catch (e) {
    console.error('Save error:', e.message);
    res.status(500).json({ error: 'Save failed' });
  }
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
