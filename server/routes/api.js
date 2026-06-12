const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { personalizeIntake, commanderChat, generateConversationSummary, generateChart, getSoulVersion, compressSession, generateSessionDebrief, generatePeriodicReport } = require('../services/claude');
const {
  upsertAnonymousEvent, getCommanderUsage, incrementCommanderUsage,
  saveCommanderMessage, getCommanderHistory, getLatestCommanderSessionId,
  getCommanderMessagesForApi,
  saveCommanderSummary, getLatestCommanderSummary,
  upsertIntake, getIntake,
  getCommanderSessionMessages, saveSessionNote, getSessionNotes, sessionNoteExists,
  upsertSessionDebrief,
  ensureMemberState, updateMemberState,
  getActionSteps, getActionStep, updateActionStepStatus, updateActionStepFollowUp,
  getBenchmarks, addBenchmarkRating, getBenchmarkRatingHistory,
  createCheckIn, getActiveCheckIn, getLastAnsweredCheckIn, answerCheckIn, snoozeCheckIn,
  getSessionDebriefs,
  getLatestPeriodicReport, savePeriodicReport,
  insertAnonymousAggregate
} = require('../services/supabase');

/**
 * Record a de-identified event for aggregate metrics, respecting the member's
 * opt-out. Runs in the background; never stores a user identifier.
 */
function recordAnonymous(userId, eventType, payload) {
  runBackground('anon-' + eventType, async () => {
    const state = await ensureMemberState(userId);
    if (!state || state.anonymous_data_opt_out) return;
    let industry = null;
    try { const intake = await getIntake(userId); industry = intake?.industry || null; } catch (e) {}
    await insertAnonymousAggregate(eventType, industry, payload);
  });
}
const { extractUser, requireAuth } = require('../middleware/auth');

// Keep fire-and-forget background work referenced until it resolves, so it is
// not garbage-collected mid-flight under Railway memory pressure / redeploys.
const _inFlight = new Set();
function runBackground(label, fn) {
  const p = (async () => {
    try { await fn(); }
    catch (e) { console.error(`Background task [${label}] failed:`, e.message); }
    finally { _inFlight.delete(p); }
  })();
  _inFlight.add(p);
}

// Apply auth extraction to all routes
router.use(extractUser);

/**
 * POST /api/intake/personalize
 * Intake personalization — reads Big Book of Strategy, returns
 * personalized ship name, destination, and industry key.
 * Falls back to generic defaults on failure.
 */
router.post('/intake/personalize', async (req, res) => {
  try {
    const { intake: answers } = req.body;
    if (!answers) return res.status(400).json({ error: 'Intake data required' });

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
    if (req.dbUser) {
      const intake = await getIntake(req.dbUser.id);
      if (intake && (intake.intake_completed_at || intake.business_name || intake.industry || intake.business_description)) {
        intakeContext = `MEMBER PROFILE:\n`;
        if (intake.business_name) intakeContext += `Business: ${intake.business_name}\n`;
        if (intake.business_description) intakeContext += `Description: ${intake.business_description}\n`;
        if (intake.industry) intakeContext += `Industry: ${intake.industry}\n`;
        if (intake.exact_revenue) intakeContext += `Annual revenue: $${intake.exact_revenue.toLocaleString()}\n`;
        else if (intake.revenue_range) intakeContext += `Revenue: ${intake.revenue_range}\n`;
        if (intake.exact_employee_count) intakeContext += `Employees: ${intake.exact_employee_count}\n`;
        else if (intake.team_size) intakeContext += `Team size: ${intake.team_size}\n`;
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
    }

    const response = await commanderChat(
      message,
      {},
      intakeContext,
      conversationHistory,
      summaryContext,
      sessionNotesContext,
      { userId: req.dbUser ? req.dbUser.id : null, sessionId }
    );

    // Save assistant response tagged with current soul version
    if (req.dbUser && sessionId) {
      const soulVersion = getSoulVersion();
      await saveCommanderMessage(req.dbUser.id, sessionId, 'assistant', response, soulVersion);

      // Background pass (non-blocking): the second of the three API calls.
      // A Haiku call reflects on the exchange, checks for a meaningful shift,
      // and writes a member-facing debrief for the progress view. Never blocks
      // or affects the response already being returned to the member.
      const userId = req.dbUser.id;
      const debriefMessages = [
        ...conversationHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: response }
      ];
      runBackground('session-debrief', async () => {
        const debrief = await generateSessionDebrief(debriefMessages);
        await upsertSessionDebrief(
          userId,
          sessionId,
          debrief.summary,
          !!debrief.shift_detected,
          debrief.unresolved_item || null
        );
      });
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
 * Save full session state (intake + personalization + chart)
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

// ============================================================
// COACHING — Progress systems (benchmarks, check-ins, action
// steps, progress view, periodic report)
// ============================================================

const SUBJECTIVE_PROMPTS = [
  { key: 'money_stress', text: 'On a scale of 1 to 10, how stressed are you about money in the business right now?' },
  { key: 'week_ownership', text: 'On a scale of 1 to 10, how much of your week felt like yours this week?' },
  { key: 'direction_confidence', text: 'On a scale of 1 to 10, how confident do you feel about the direction you are heading?' }
];

const CHECK_IN_CADENCE_DAYS = 3;
const SUBJECTIVE_EVERY_DAYS = 16;        // a subjective prompt roughly every 2-3 weeks
const PERIODIC_REPORT_DAYS = 28;

function daysSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * If nothing is already waiting and the cadence has elapsed, create the next
 * due check-in. Metric check-ins rotate through the member's benchmarks
 * (weakest first); when no benchmarks exist yet, fall back to a subjective
 * prompt so the heartbeat still runs. Returns the active check-in (or null).
 */
async function ensureDueCheckIn(userId) {
  const active = await getActiveCheckIn(userId);
  if (active) return active;

  const last = await getLastAnsweredCheckIn(userId);
  if (daysSince(last?.answered_at) < CHECK_IN_CADENCE_DAYS) return null;

  const benchmarks = await getBenchmarks(userId);

  // Occasionally ask a subjective question instead of a metric one.
  const wantSubjective = benchmarks.length === 0 || daysSince(last?.answered_at) >= SUBJECTIVE_EVERY_DAYS;

  if (wantSubjective) {
    const pick = SUBJECTIVE_PROMPTS[Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % SUBJECTIVE_PROMPTS.length];
    return await createCheckIn(userId, {
      type: 'subjective', prompt_text: pick.text, subjective_key: pick.key
    });
  }

  // Metric: focus the weakest (lowest current_rating) benchmark.
  const target = [...benchmarks].sort((a, b) =>
    (a.current_rating ?? a.starting_rating ?? 0) - (b.current_rating ?? b.starting_rating ?? 0)
  )[0];

  return await createCheckIn(userId, {
    type: 'metric',
    benchmark_id: target.id,
    prompt_text: `On a scale of 1 to 10, how close does this feel right now: "${target.statement}"?`
  });
}

/**
 * Generate the 28-day periodic report in the background if one is due and
 * there is enough material to reflect on. Non-blocking.
 */
async function maybeGeneratePeriodicReport(userId, memberState, benchmarks, debriefs) {
  const latest = await getLatestPeriodicReport(userId);
  const anchorIso = latest?.created_at || memberState?.coaching_started_at;
  if (daysSince(anchorIso) < PERIODIC_REPORT_DAYS) return;
  if (benchmarks.length === 0 && debriefs.length === 0) return; // nothing to say yet

  runBackground('periodic-report', async () => {
    const actionSteps = await getActionSteps(userId);
    const letter = await generatePeriodicReport({
      memberName: null, benchmarks, actionSteps, debriefs
    });
    if (letter) {
      const periodStart = anchorIso || null;
      await savePeriodicReport(userId, letter, periodStart, new Date().toISOString());
      await updateMemberState(userId, { last_periodic_report_at: new Date().toISOString() });
    }
  });
}

/**
 * GET /api/member/progress
 * Everything the progress view needs in one call.
 */
router.get('/member/progress', async (req, res) => {
  if (!req.dbUser) return res.json({ authenticated: false });
  try {
    const userId = req.dbUser.id;
    const memberState = await ensureMemberState(userId);
    const [benchmarks, ratingHistory, actionSteps, debriefs, periodicReport] = await Promise.all([
      getBenchmarks(userId),
      getBenchmarkRatingHistory(userId),
      getActionSteps(userId),
      getSessionDebriefs(userId, 20),
      getLatestPeriodicReport(userId)
    ]);

    // Lazy: kick off a periodic report if one is due (non-blocking).
    maybeGeneratePeriodicReport(userId, memberState, benchmarks, debriefs);

    res.json({
      authenticated: true,
      stages: {
        stage_1: !!memberState?.stage_1_complete,
        stage_2: !!memberState?.stage_2_complete,
        stage_3: !!memberState?.stage_3_complete
      },
      benchmarks: benchmarks.map(b => ({
        id: b.id, statement: b.statement, position: b.position,
        starting_rating: b.starting_rating, current_rating: b.current_rating
      })),
      ratingHistory,
      actionSteps: {
        active: actionSteps.filter(a => a.status === 'active'),
        completed: actionSteps.filter(a => a.status === 'completed'),
        did_not_happen: actionSteps.filter(a => a.status === 'did_not_happen')
      },
      reflections: debriefs.map(d => ({ id: d.id, summary: d.summary, created_at: d.created_at })),
      periodicReport: periodicReport
        ? { letter: periodicReport.letter, created_at: periodicReport.created_at, read: periodicReport.read }
        : null,
      privacy: { optOut: !!memberState?.anonymous_data_opt_out }
    });
  } catch (e) {
    console.error('Progress error:', e.message);
    res.status(500).json({ error: 'Could not load progress' });
  }
});

/**
 * GET /api/member/check-in
 * The check-in to show right now, if any. Creates one if the cadence is due.
 */
router.get('/member/check-in', async (req, res) => {
  if (!req.dbUser) return res.json({ checkIn: null });
  try {
    const checkIn = await ensureDueCheckIn(req.dbUser.id);
    res.json({ checkIn: checkIn || null });
  } catch (e) {
    console.error('Check-in fetch error:', e.message);
    res.json({ checkIn: null });
  }
});

/**
 * POST /api/member/check-in/answer
 * Body: { checkInId, rating?, choice?, text_answer? }
 */
router.post('/member/check-in/answer', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { checkInId, rating, choice, text_answer } = req.body;
    if (!checkInId) return res.status(400).json({ error: 'checkInId required' });

    const answered = await answerCheckIn(checkInId, {
      rating: rating ?? null, choice: choice ?? null, text_answer: text_answer ?? null
    });

    // A metric rating updates the benchmark arc.
    if (answered && answered.type === 'metric' && answered.benchmark_id && typeof rating === 'number') {
      await addBenchmarkRating(req.dbUser.id, answered.benchmark_id, rating, 'check_in');
      recordAnonymous(req.dbUser.id, 'benchmark_progress', { rating });
    }
    if (answered && answered.type === 'subjective' && typeof rating === 'number') {
      recordAnonymous(req.dbUser.id, 'subjective_rating', { key: answered.subjective_key, rating });
    }
    // An action follow-up records onto the action step.
    // Status only changes on an explicit choice; a text-only "how did it go?"
    // answer (the prompt shown after a step is already marked done) records a
    // note without disturbing the existing status.
    if (answered && answered.type === 'action_followup' && answered.action_step_id) {
      if (choice === 'did_not_happen') {
        await updateActionStepStatus(answered.action_step_id, 'did_not_happen', text_answer ?? null);
        recordAnonymous(req.dbUser.id, 'action_completion', { status: 'did_not_happen' });
      } else if (choice === 'done') {
        await updateActionStepStatus(answered.action_step_id, 'completed', text_answer ?? null);
        recordAnonymous(req.dbUser.id, 'action_completion', { status: 'completed' });
      } else if (text_answer) {
        await updateActionStepFollowUp(answered.action_step_id, text_answer);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Check-in answer error:', e.message);
    res.status(500).json({ error: 'Could not record answer' });
  }
});

/**
 * POST /api/member/check-in/snooze
 * Body: { checkInId }
 */
router.post('/member/check-in/snooze', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { checkInId } = req.body;
    if (!checkInId) return res.status(400).json({ error: 'checkInId required' });
    await snoozeCheckIn(checkInId, 24);
    res.json({ ok: true });
  } catch (e) {
    console.error('Check-in snooze error:', e.message);
    res.status(500).json({ error: 'Could not snooze' });
  }
});

/**
 * POST /api/member/privacy/opt-out
 * Body: { optOut: boolean }. Toggles anonymous aggregate data collection.
 * Opting out never affects access or the member's benchmark.
 */
router.post('/member/privacy/opt-out', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const optOut = !!req.body.optOut;
    await ensureMemberState(req.dbUser.id);
    await updateMemberState(req.dbUser.id, { anonymous_data_opt_out: optOut });
    res.json({ ok: true, optOut });
  } catch (e) {
    console.error('Privacy opt-out error:', e.message);
    res.status(500).json({ error: 'Could not update preference' });
  }
});

/**
 * GET /api/member/action-steps
 */
router.get('/member/action-steps', async (req, res) => {
  if (!req.dbUser) return res.json({ active: [], completed: [] });
  try {
    const steps = await getActionSteps(req.dbUser.id);
    res.json({
      active: steps.filter(s => s.status === 'active'),
      completed: steps.filter(s => s.status === 'completed'),
      did_not_happen: steps.filter(s => s.status === 'did_not_happen')
    });
  } catch (e) {
    console.error('Action steps fetch error:', e.message);
    res.json({ active: [], completed: [] });
  }
});

/**
 * POST /api/member/action-steps/:id/complete
 * Marks complete and triggers an immediate Type 2 (action follow-up) check-in.
 */
router.post('/member/action-steps/:id/complete', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const stepId = req.params.id;
    const step = await getActionStep(stepId);
    if (!step || step.user_id !== req.dbUser.id) {
      return res.status(404).json({ error: 'Action step not found' });
    }

    await updateActionStepStatus(stepId, 'completed');
    recordAnonymous(req.dbUser.id, 'action_completion', { status: 'completed' });

    // Immediate Type 2 check-in: "How did it go?" (optional text).
    await createCheckIn(req.dbUser.id, {
      type: 'action_followup',
      action_step_id: stepId,
      prompt_text: `You marked this done: "${step.step_text}". How did it go?`
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('Action step complete error:', e.message);
    res.status(500).json({ error: 'Could not complete action step' });
  }
});

module.exports = router;
