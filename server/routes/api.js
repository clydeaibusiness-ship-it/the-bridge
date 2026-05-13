const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { personalizeIntake, generateSituation, generateDebrief, commanderChat, generateConversationSummary, generateChart, getSoulVersion, compressSession } = require('../services/claude');
const { 
  saveGameState, getGameState, saveRunHistory, getRunHistory,
  upsertAnonymousEvent, getCommanderUsage, incrementCommanderUsage,
  saveCommanderMessage, getCommanderHistory, getLatestCommanderSessionId,
  getCommanderMessagesForApi,
  saveCommanderSummary, getLatestCommanderSummary,
  upsertIntake, getIntake,
  getCommanderSessionMessages, saveSessionNote, getSessionNotes, sessionNoteExists
} = require('../services/supabase');
const { extractUser, requireAuth } = require('../middleware/auth');

// Apply auth extraction to all routes
router.use(extractUser);

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
 * Falls back to generic defaults on failure.
 */
router.post('/game/intake', async (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers) return res.status(400).json({ error: 'Intake answers required' });

    const result = await personalizeIntake(answers);
    if (!result.industry_key) result.industry_key = 'general';

    // If user is authenticated, save intake to unified table
    if (req.dbUser) {
      await upsertIntake(req.dbUser.id, answers);
    }

    res.json(result);
  } catch (e) {
    console.error('Intake error:', e.message);
    res.status(500).json({
      ship_name: 'Your Business',
      destination_name: 'Growth Horizon',
      industry_key: 'general',
      flavor_text: 'Your business is waiting. The decisions ahead are yours to make.'
    });
  }
});

/**
 * POST /api/game/situation
 * Generate a single personalized situation using Claude API
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
 * Run-end debrief
 */
router.post('/game/debrief', async (req, res) => {
  try {
    const { run_history, intake_answers, intakeAnswers, runSummary } = req.body;
    const history = run_history || runSummary;
    const intake = intake_answers || intakeAnswers;

    if (!history) return res.status(400).json({ error: 'Run data required' });

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
 */
router.get('/game/state', async (req, res) => {
  res.json(null);
});

/**
 * POST /api/game/state
 */
router.post('/game/state', async (req, res) => {
  res.json({ saved: true });
});

/**
 * POST /api/game/save
 */
router.post('/game/save', async (req, res) => {
  try {
    res.json({ success: true });
  } catch (e) {
    console.error('Save error:', e.message);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ---- Analytics (no auth) ----

router.post('/analytics/event', async (req, res) => {
  try {
    await upsertAnonymousEvent(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

// ---- Commander API ----

/**
 * GET /api/member/commander/sessions
 * Get Commander session usage
 */
router.get('/member/commander/sessions', async (req, res) => {
  if (req.dbUser) {
    try {
      const usage = await getCommanderUsage(req.dbUser.id);
      return res.json(usage);
    } catch (e) {}
  }
  res.json({ used: 0, max: 20 });
});

/**
 * GET /api/member/commander/history
 * Fetch last 20 commander messages for the authenticated user
 */
router.get('/member/commander/history', async (req, res) => {
  if (!req.dbUser) {
    return res.json({ messages: [], sessionId: null });
  }

  try {
    const messages = await getCommanderHistory(req.dbUser.id, 20);
    const sessionInfo = await getLatestCommanderSessionId(req.dbUser.id);
    
    // Check if we need a summary (>24h gap)
    let summary = null;
    if (sessionInfo && sessionInfo.lastMessageAt) {
      const lastTime = new Date(sessionInfo.lastMessageAt).getTime();
      const now = Date.now();
      const hoursSince = (now - lastTime) / (1000 * 60 * 60);
      
      if (hoursSince > 24) {
        // Check if we already have a summary for this gap
        const existingSummary = await getLatestCommanderSummary(req.dbUser.id);
        if (existingSummary) {
          summary = existingSummary.summary;
        } else if (messages.length > 0) {
          // Generate summary in background
          try {
            const historyForSummary = messages.map(m => ({
              role: m.message_role,
              content: m.message_content
            }));
            const summaryText = await generateConversationSummary(historyForSummary);
            await saveCommanderSummary(req.dbUser.id, sessionInfo.sessionId, summaryText);
            summary = summaryText;
          } catch (e) {
            console.error('Summary generation failed:', e.message);
          }
        }
      }
    }

    res.json({
      messages: messages.map(m => ({
        role: m.message_role,
        content: m.message_content,
        timestamp: m.created_at
      })),
      sessionId: sessionInfo?.sessionId || null,
      summary
    });
  } catch (e) {
    console.error('Commander history error:', e.message);
    res.json({ messages: [], sessionId: null });
  }
});

/**
 * POST /api/member/commander/message
 * Send message to Commander — now with history persistence + context
 */
router.post('/member/commander/message', async (req, res) => {
  try {
    const { message, sessionContext } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    let conversationHistory = [];
    let sessionId = null;
    let summaryContext = null;
    let sessionNotesContext = '';

    // If authenticated, load conversation history and save messages
    if (req.dbUser) {
      // Get or create session ID
      const sessionInfo = await getLatestCommanderSessionId(req.dbUser.id);
      
      if (sessionInfo) {
        const lastTime = new Date(sessionInfo.lastMessageAt).getTime();
        const minutesSince = (Date.now() - lastTime) / (1000 * 60);
        
        if (minutesSince >= 30) {
          // Session ended by inactivity — compress the old session before starting new one
          const oldSessionId = sessionInfo.sessionId;
          const alreadyCompressed = await sessionNoteExists(req.dbUser.id, oldSessionId);
          
          if (!alreadyCompressed) {
            const oldMessages = await getCommanderSessionMessages(req.dbUser.id, oldSessionId);
            if (oldMessages.length >= 4) {
              // Only compress sessions with meaningful conversation (at least 2 exchanges)
              try {
                const compressed = await compressSession(oldMessages);
                await saveSessionNote(
                  req.dbUser.id,
                  oldSessionId,
                  compressed.operator_insights || [],
                  compressed.strategic_ground || [],
                  compressed.unresolved_threads || [],
                  oldMessages.length
                );
                console.log(`Session ${oldSessionId} compressed: ${oldMessages.length} messages → session note`);
              } catch (compressErr) {
                console.error('Session compression error:', compressErr.message);
                // Compression failed but don't block the new message
              }
            }
          }

          // Get summary of old conversation for transition context
          const existingSummary = await getLatestCommanderSummary(req.dbUser.id);
          if (existingSummary) {
            summaryContext = existingSummary.summary;
          }
          sessionId = crypto.randomUUID();
        } else {
          sessionId = sessionInfo.sessionId;
        }
      } else {
        sessionId = crypto.randomUUID();
      }

      // Get current soul version for filtering + tagging
      const soulVersion = getSoulVersion();

      // Get last 10 messages for API context — filtered by soul version
      conversationHistory = await getCommanderMessagesForApi(req.dbUser.id, 10, soulVersion);

      // Load session notes (long-term memory) — max 30 most recent
      const sessionNotes = await getSessionNotes(req.dbUser.id, 30);
      if (sessionNotes.length > 0) {
        sessionNotesContext = formatSessionNotes(sessionNotes);
      }

      // Save user message tagged with current soul version
      await saveCommanderMessage(req.dbUser.id, sessionId, 'user', message, soulVersion);
    }

    // Load actual intake data and run history from database
    let intakeContext = '';
    const runHistory = [];
    if (req.dbUser) {
      const intake = await getIntake(req.dbUser.id);
      if (intake && intake.intake_completed_at) {
        intakeContext = `MEMBER PROFILE:\n`;
        if (intake.business_name) intakeContext += `Business: ${intake.business_name}\n`;
        if (intake.business_description) intakeContext += `Description: ${intake.business_description}\n`;
        if (intake.industry) intakeContext += `Industry: ${intake.industry}\n`;
        if (intake.revenue_range) intakeContext += `Revenue: ${intake.revenue_range}\n`;
        if (intake.team_size) intakeContext += `Team size: ${intake.team_size}\n`;
        if (intake.years_operating) intakeContext += `Years operating: ${intake.years_operating}\n`;
        if (intake.city) intakeContext += `Location: ${intake.city}${intake.state ? ', ' + intake.state : ''}\n`;
        if (intake.differentiator) intakeContext += `Differentiator: ${intake.differentiator}\n`;
        if (intake.challenge) intakeContext += `Current challenge: ${intake.challenge}\n`;
        if (intake.destination_name) intakeContext += `Business destination: ${intake.destination_name}\n`;
        if (intake.business_context) intakeContext += `Additional context: ${intake.business_context}\n`;
        if (intake.chart_sections) {
          try {
            const chart = typeof intake.chart_sections === 'string' ? JSON.parse(intake.chart_sections) : intake.chart_sections;
            if (chart && Array.isArray(chart)) {
              intakeContext += `\nNAVIGATION CHART:\n`;
              chart.forEach(s => { intakeContext += `${s.title}: ${s.body}\n`; });
            }
          } catch (e) { /* chart parse failed, skip */ }
        }
      }

      const runs = await getRunHistory(req.dbUser.id);
      if (runs && runs.length > 0) runHistory.push(...runs);
    }

    const response = await commanderChat(
      message,
      {},
      runHistory,
      intakeContext,
      conversationHistory,
      summaryContext,
      sessionNotesContext
    );

    // Save assistant response tagged with current soul version
    if (req.dbUser && sessionId) {
      const soulVersion = getSoulVersion();
      await saveCommanderMessage(req.dbUser.id, sessionId, 'assistant', response, soulVersion);
    }

    res.json({ response });
  } catch (e) {
    console.error('Commander error:', e.message, e.stack);
    res.status(500).json({ 
      error: 'I was not able to process that just now. Could you rephrase or try again in a moment?' 
    });
  }
});

/**
 * Format session notes into the context block the Commander reads.
 */
function formatSessionNotes(notes) {
  const allInsights = [];
  const allGround = [];
  const allThreads = [];

  // Notes come newest-first; collect all entries
  for (const note of notes) {
    if (note.operator_insights) allInsights.push(...note.operator_insights);
    if (note.strategic_ground) allGround.push(...note.strategic_ground);
    if (note.unresolved_threads) allThreads.push(...note.unresolved_threads);
  }

  let block = 'WHAT I KNOW ABOUT THIS PERSON FROM OUR PREVIOUS CONVERSATIONS:\n\n';

  if (allInsights.length > 0) {
    block += 'Operator insights:\n';
    for (const insight of allInsights) block += `\u2014 ${insight}\n`;
    block += '\n';
  }

  if (allGround.length > 0) {
    block += 'Strategic ground we have covered:\n';
    for (const ground of allGround) block += `\u2014 ${ground}\n`;
    block += '\n';
  }

  if (allThreads.length > 0) {
    block += 'Open threads we have not resolved:\n';
    for (const thread of allThreads) block += `\u2014 ${thread}\n`;
  }

  return block;
}

/**
 * GET /api/member/runs
 */
router.get('/member/runs', async (req, res) => {
  res.json([]);
});

/**
 * POST /api/member/chart/generate
 * Generate Navigation Chart
 */
router.post('/member/chart/generate', async (req, res) => {
  try {
    const { businessContext, intakeAnswers } = req.body;
    if (!businessContext || !intakeAnswers) {
      return res.status(400).json({ error: 'businessContext and intakeAnswers required' });
    }
    const chart = await generateChart(businessContext, intakeAnswers, req.body.scannedContent);
    res.json(chart);
  } catch (e) {
    console.error('Chart generation error:', e.message);
    res.status(500).json({ error: 'Chart generation failed' });
  }
});

/**
 * POST /api/intake/scan-urls
 * Fetch and extract text from website and Facebook URLs
 */
router.post('/intake/scan-urls', async (req, res) => {
  const { websiteUrl, facebookUrl } = req.body;
  const results = { websiteContent: '', facebookContent: '' };

  async function fetchAndExtract(url) {
    if (!url || !url.trim()) return '';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(url.trim(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheBridge/1.0)' }
      });
      clearTimeout(timeout);
      if (!resp.ok) return '';
      const html = await resp.text();
      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text.substring(0, 3000);
    } catch (e) {
      console.log(`URL scan failed for ${url}: ${e.message}`);
      return '';
    }
  }

  const [website, facebook] = await Promise.all([
    fetchAndExtract(websiteUrl),
    fetchAndExtract(facebookUrl)
  ]);

  results.websiteContent = website;
  results.facebookContent = facebook;
  res.json(results);
});

// ---- Unified Intake API ----

/**
 * GET /api/intake/data
 * Fetch existing intake data for authenticated user
 */
router.get('/intake/data', async (req, res) => {
  if (!req.dbUser) {
    return res.json({ intake: null });
  }

  try {
    const intake = await getIntake(req.dbUser.id);
    if (!intake) return res.json({ intake: null });

    // Map DB columns back to frontend field names
    res.json({
      intake: {
        businessName: intake.business_name,
        websiteUrl: intake.website_url,
        facebookUrl: intake.facebook_url,
        description: intake.business_description,
        years: intake.years_operating,
        revenue: intake.revenue_range,
        employees: intake.team_size,
        customerType: intake.repeat_vs_new,
        switchingCosts: intake.switching_costs,
        systems: intake.systems_dependency,
        financialState: intake.financial_state,
        uncertainty: intake.biggest_uncertainty,
        goal: intake.success_in_one_year,
        websiteContent: intake.website_content,
        facebookContent: intake.facebook_content,
        industry: intake.industry,
        differentiator: intake.differentiator,
        challenge: intake.challenge,
        updatedAt: intake.updated_at
      },
      // Full session state for cross-device sync
      session: {
        shipName: intake.ship_name || intake.business_name,
        businessName: intake.business_name,
        destination: intake.destination_name,
        industryKey: intake.industry_key,
        businessContext: intake.business_context,
        chartSections: intake.chart_sections,
        scannedContent: intake.scanned_content,
        completedAt: intake.intake_completed_at,
        simulatorResources: intake.simulator_resources,
        intakeAnswers: {
          businessName: intake.business_name,
          websiteUrl: intake.website_url,
          facebookUrl: intake.facebook_url,
          description: intake.business_description,
          years: intake.years_operating,
          revenue: intake.revenue_range,
          employees: intake.team_size,
          customerType: intake.repeat_vs_new,
          switchingCosts: intake.switching_costs,
          systems: intake.systems_dependency,
          financialState: intake.financial_state,
          uncertainty: intake.biggest_uncertainty,
          goal: intake.success_in_one_year,
          industry: intake.industry,
          differentiator: intake.differentiator,
          challenge: intake.challenge
        }
      },
      source: 'database'
    });
  } catch (e) {
    console.error('Get intake error:', e.message);
    res.json({ intake: null });
  }
});

/**
 * POST /api/intake/save
 * Save intake data for authenticated user
 */
router.post('/intake/save', async (req, res) => {
  if (!req.dbUser) {
    return res.status(401).json({ error: 'Authentication required to save intake' });
  }

  try {
    const { answers, scannedContent } = req.body;
    if (!answers) return res.status(400).json({ error: 'Answers required' });

    // Merge scanned content into answers
    const merged = { ...answers };
    if (scannedContent) {
      merged.websiteContent = scannedContent.websiteContent || '';
      merged.facebookContent = scannedContent.facebookContent || '';
    }

    await upsertIntake(req.dbUser.id, merged);
    res.json({ saved: true });
  } catch (e) {
    console.error('Save intake error:', e.message);
    res.status(500).json({ error: 'Save failed' });
  }
});

/**
 * POST /api/session/save
 * Save full session state (intake + personalization + chart + simulator)
 * This is the single source of truth — replaces localStorage dependency
 */
router.post('/session/save', async (req, res) => {
  if (!req.dbUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { session } = req.body;
    if (!session) return res.status(400).json({ error: 'Session data required' });

    const db = require('../services/supabase').getClient();
    if (!db) return res.status(503).json({ error: 'Database not configured' });

    const update = { updated_at: new Date().toISOString() };

    // Map session fields to DB columns
    if (session.shipName !== undefined) update.ship_name = session.shipName;
    if (session.businessName !== undefined) update.business_name = session.businessName;
    if (session.destination !== undefined) update.destination_name = session.destination;
    if (session.industryKey !== undefined) update.industry_key = session.industryKey;
    if (session.businessContext !== undefined) update.business_context = session.businessContext;
    if (session.chartSections !== undefined) update.chart_sections = session.chartSections;
    if (session.simulatorResources !== undefined) update.simulator_resources = session.simulatorResources;
    if (session.completedAt !== undefined) update.intake_completed_at = session.completedAt;

    if (session.scannedContent !== undefined) {
      update.scanned_content = session.scannedContent;
      if (session.scannedContent) {
        update.website_content = session.scannedContent.websiteContent || null;
        update.facebook_content = session.scannedContent.facebookContent || null;
      }
    }

    if (session.intakeAnswers) {
      const a = session.intakeAnswers;
      if (a.businessName) update.business_name = a.businessName;
      if (a.websiteUrl) update.website_url = a.websiteUrl;
      if (a.facebookUrl) update.facebook_url = a.facebookUrl;
      if (a.description) update.business_description = a.description;
      if (a.years) update.years_operating = a.years;
      if (a.revenue) update.revenue_range = a.revenue;
      if (a.employees) update.team_size = a.employees;
      if (a.customerType) update.repeat_vs_new = a.customerType;
      if (a.switchingCosts) update.switching_costs = a.switchingCosts;
      if (a.systems) update.systems_dependency = a.systems;
      if (a.financialState) update.financial_state = a.financialState;
      if (a.uncertainty) update.biggest_uncertainty = a.uncertainty;
      if (a.goal) update.success_in_one_year = a.goal;
      if (a.industry) update.industry = a.industry;
      if (a.differentiator) update.differentiator = a.differentiator;
      if (a.challenge) update.challenge = a.challenge;
    }

    const { error } = await db
      .from('user_intake')
      .upsert({ user_id: req.dbUser.id, ...update }, { onConflict: 'user_id' });

    if (error) throw error;
    res.json({ saved: true });
  } catch (e) {
    console.error('Session save error:', e.message);
    res.status(500).json({ error: 'Save failed' });
  }
});

module.exports = router;
