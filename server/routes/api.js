const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { personalizeIntake, commanderChat, generateConversationSummary, generateChart, getSoulVersion, compressSession, generateSessionDebrief, generatePeriodicReport, generateIntakeFollowUp, generateBenchmark, generateGraduationComparison, generateChartFromInterview } = require('../services/claude');
const {
  QUESTIONS, STAGE_FRAMING, STAGE_COMPLETE, STAGE_BOUNDS, getQuestionByField
} = require('../data/intake-questions');
const {
  upsertAnonymousEvent, getCommanderUsage, incrementCommanderUsage,
  saveCommanderMessage, getCommanderHistory, getLatestCommanderSessionId,
  getCommanderMessagesForApi,
  saveCommanderSummary, getLatestCommanderSummary,
  upsertIntake, getIntake,
  getCommanderSessionMessages, saveSessionNote, getSessionNotes, sessionNoteExists,
  upsertSessionDebrief,
  ensureMemberState, updateMemberState,
  recordMemberActivity, countEarlKnowledge,
  getDraftFriendNote, setFriendNoteStatus,
  getActionSteps, getActionStep, updateActionStepStatus,
  getBenchmarks, getBenchmarkRatingHistory,
  completeBenchmarkGoal,
  getSessionDebriefs,
  getLatestPeriodicReport, savePeriodicReport,
  insertAnonymousAggregate,
  saveIntakeResponse, updateIntakeFollowUp, getIntakeResponses,
  saveBenchmarks, approveBenchmarks,
  getGraduationRecord, createGraduationRecord, finalizeGraduationRecord,
  saveChartSections
} = require('../services/supabase');
const { buildMemoryContext, describeGap } = require('../services/memory/context');
const { sendOwnerAlert } = require('../services/alert');
const { getVapidPublicKey, saveSubscription, removeSubscription } = require('../services/push');
const { checkInOne, replyToCheckIn } = require('../services/checkin-worker');

function monthsSince(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

/**
 * Evaluate the data-driven lifecycle signals. Graduation condition 1 is now
 * goal completion: every one of the member's goals has been marked complete
 * (in conversation, with their confirmation). Conditions 2 and 3 (member
 * confirmation of the overall shift, and question-quality) remain the
 * Commander's job in conversation.
 */
function evaluateLifecycle(benchmarks, ratingHistory, state) {
  const result = { graduationCandidate: false, milestoneReached: false, referralReached: false };

  // All named goals closed out = the data condition for graduation is met.
  if (benchmarks.length >= 1) {
    result.graduationCandidate = benchmarks.every(b => !!b.completed_at);
  }

  const months = monthsSince(state?.coaching_started_at);
  if (months >= 9 && !state?.graduated_at) result.referralReached = true;
  if (months >= 6 && !state?.graduated_at && !state?.extension_active) result.milestoneReached = true;
  return result;
}

/**
 * Build the Commander's context from the coaching system: the member's
 * interview answers, their benchmark (as a private map), the hidden
 * operational baseline, incomplete-intake status, and one pre-conversation
 * thread. Returns '' for legacy-only members so the caller falls back.
 */
async function buildCoachingContext(userId) {
  const [responses, benches, state] = await Promise.all([
    getIntakeResponses(userId, 1),
    getBenchmarks(userId),
    ensureMemberState(userId)
  ]);
  if (!responses.length && !benches.length) return '';

  let ctx = '';

  if (responses.length) {
    ctx += 'MEMBER PROFILE (from their interview):\n';
    for (const r of responses) {
      const q = getQuestionByField(r.question_field);
      const label = (q ? q.field : r.question_field).replace(/_/g, ' ');
      let val = r.answer || '';
      if (r.follow_up_answer) val += ' — ' + r.follow_up_answer;
      if (val.trim()) ctx += `- ${label}: ${val}\n`;
    }
  }

  // Goals + the action steps under each. This is the spine of progress now:
  // a goal is reached when its action steps are done (or the member says they
  // hit it another way), you confirm with them, then call complete_goal.
  let allSteps = [];
  try { allSteps = await getActionSteps(userId); } catch (e) { /* non-fatal */ }

  if (benches.length) {
    ctx += '\nTHEIR GOALS AND THE ACTION STEPS UNDER EACH (your private map):\n';
    for (const b of benches) {
      const done = !!b.completed_at;
      ctx += `- [benchmark_id: ${b.id}] "${b.statement}"${done ? ' — DONE (already marked complete)' : ''}\n`;
      const steps = allSteps.filter(s => s.benchmark_id === b.id);
      if (steps.length) {
        for (const s of steps) {
          const mark = s.status === 'completed' ? '✓ done'
            : s.status === 'did_not_happen' ? '✗ did not happen'
            : 'in progress';
          ctx += `    · [action_step_id: ${s.id}] "${s.step_text}" (${mark})\n`;
        }
        const openCount = steps.filter(s => s.status === 'active').length;
        if (!done && openCount === 0) {
          ctx += `    → Every action step for this goal is closed. If it feels reached, ask them whether to mark the goal complete and move to the next — only call complete_goal if they say yes.\n`;
        }
      } else if (!done) {
        ctx += `    · (no action steps yet — when the moment is right, help them name the concrete steps that would get them here, and save each with save_action_step tagged to this benchmark_id)\n`;
      }
    }
    ctx += 'Use the exact benchmark_id / action_step_id values above when saving steps, marking steps complete, or completing a goal.\n';
  }

  if (state && state.hidden_metrics && typeof state.hidden_metrics === 'object') {
    const lines = Object.entries(state.hidden_metrics).filter(([, v]) => v);
    if (lines.length) {
      ctx += '\nOPERATIONAL BASELINE (internal, not a talking point):\n';
      for (const [k, v] of lines) ctx += `- ${k.replace(/_/g, ' ')}: ${v}\n`;
    }
  }

  if (state && responses.length) {
    const incomplete = [];
    if (!state.stage_2_complete) incomplete.push('Stage 2 (operational reality)');
    if (!state.stage_3_complete) incomplete.push('Stage 3 (personal context)');
    if (incomplete.length) {
      ctx += `\nINTAKE STATUS: They have not completed ${incomplete.join(' and ')}. Invite them back only when the missing information would meaningfully change your response.\n`;
    }
  }

  // Lifecycle signals — data the Commander needs to run graduation / the
  // six-month milestone / the nine-month referral per its operating context.
  try {
    const ratingHistory = await getBenchmarkRatingHistory(userId);
    const life = evaluateLifecycle(benches, ratingHistory, state);
    if (life.graduationCandidate) {
      ctx += '\nGRADUATION SIGNAL: Every one of their goals has been marked complete (condition one is met). If their questions have shifted from survival to strategy, ask the confirming question and, only if they confirm the shift, begin the graduation conversation per your operating context.\n';
    }
    if (life.referralReached) {
      ctx += '\nNINE-MONTH POINT: They have been with The Bridge nine months without graduating. If progress is minimal, have the honest in-person-coaching referral conversation per your operating context.\n';
    } else if (life.milestoneReached && state && !state.six_month_milestone_handled) {
      ctx += '\nSIX-MONTH MILESTONE: They have reached six months. Take a moment to look at where they are versus where they started, and offer the extension if meaningful progress is visible — per your operating context. If they accept, call request_extension.\n';
    }
    if (state && state.extension_pending_confirmation && !state.extension_active) {
      ctx += '\nEXTENSION PENDING: They accepted the extension and the owner is arranging it. Do not imply it is already active.\n';
    } else if (state && state.extension_active) {
      ctx += '\nEXTENSION ACTIVE: They are in their three-month extension period.\n';
    }
  } catch (e) { /* non-fatal */ }

  // One pre-conversation thread from the most recent debrief.
  try {
    const debriefs = await getSessionDebriefs(userId, 1);
    if (debriefs.length && debriefs[0].unresolved_item) {
      ctx += `\nONE UNRESOLVED THREAD FROM LAST TIME: ${debriefs[0].unresolved_item}\n`;
    }
  } catch (e) { /* non-fatal */ }

  // Surface an overdue action step, if any.
  try {
    const steps = await getActionSteps(userId, 'active');
    const overdue = steps.filter(s => s.target_date && new Date(s.target_date) < new Date());
    if (overdue.length) ctx += `\nOVERDUE ACTION STEP (raise if relevant): "${overdue[0].step_text}"\n`;
  } catch (e) { /* non-fatal */ }

  return ctx.trim();
}

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
    const messages = await getCommanderHistory(req.dbUser.id, 40);
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

    // One unresolved thread from last time, to show as a quiet note before
    // the member types (the pre-conversation prompt).
    let preConversation = null;
    try {
      const debriefs = await getSessionDebriefs(req.dbUser.id, 1);
      if (debriefs.length && debriefs[0].unresolved_item) preConversation = debriefs[0].unresolved_item;
    } catch (e) { /* non-fatal */ }

    res.json({
      messages: messages.map(m => ({
        role: m.message_role,
        content: m.message_content,
        timestamp: m.created_at
      })),
      sessionId: sessionInfo?.sessionId || null,
      summary,
      preConversation
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

    // If the member closes the app before Earl finishes (his reply can take a
    // few seconds), we can't hand the answer back over this request — so we
    // push them a notification instead. This flips true if the connection
    // drops before we've sent the response.
    let clientLeft = false;
    res.on('close', () => { if (!res.writableEnded) clientLeft = true; });

    let conversationHistory = [];
    let sessionId = null;
    let summaryContext = null;
    let sessionNotesContext = '';
    let gapMinutes = null;

    // If authenticated, load conversation history and save messages
    if (req.dbUser) {
      // Get or create session ID
      const sessionInfo = await getLatestCommanderSessionId(req.dbUser.id);
      
      if (sessionInfo) {
        const lastTime = new Date(sessionInfo.lastMessageAt).getTime();
        const minutesSince = (Date.now() - lastTime) / (1000 * 60);
        gapMinutes = minutesSince;

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

      // Mid-session compression: if the current session has grown very long,
      // compress the oldest chunk in the background and drop a marker in chat.
      const MID_COMPRESS_THRESHOLD = 30;
      const currentSessionMsgs = await getCommanderSessionMessages(req.dbUser.id, sessionId);
      if (currentSessionMsgs.length >= MID_COMPRESS_THRESHOLD) {
        const alreadyMarked = currentSessionMsgs.some(m => m.message_role === 'system_note');
        if (!alreadyMarked) {
          const toCompress = currentSessionMsgs.filter(m => m.message_role !== 'system_note').slice(0, 20);
          runBackground('mid-session-compress', async () => {
            try {
              const compressed = await compressSession(toCompress);
              await saveSessionNote(req.dbUser.id, crypto.randomUUID(),
                compressed.operator_insights || [],
                compressed.strategic_ground || [],
                compressed.unresolved_threads || [],
                toCompress.length
              );
              await saveCommanderMessage(req.dbUser.id, sessionId, 'system_note',
                'Earlier context in this conversation has been summarized.', null);
            } catch (e) {
              console.error('Mid-session compression error:', e.message);
            }
          });
        }
      }

      // Get last 30 messages for API context — filtered by soul version
      conversationHistory = await getCommanderMessagesForApi(req.dbUser.id, 30, soulVersion);

      // Long-term memory: member file + relevant facts (recency-weighted,
      // softened by age) + decision ledger. A null result means this member
      // simply has no derived memory yet (fall back to the legacy session
      // notes). A THROWN error means memory is actually broken — we do NOT
      // swallow it and answer with a memory-less Earl; it propagates to the
      // route handler, which alerts the owner and shows the member the snag.
      const memoryContext = await buildMemoryContext(req.dbUser.id, message);
      if (memoryContext) {
        sessionNotesContext = memoryContext;
      } else {
        const sessionNotes = await getSessionNotes(req.dbUser.id, 30);
        if (sessionNotes.length > 0) {
          sessionNotesContext = formatSessionNotes(sessionNotes);
        }
      }

      // Let Earl feel time passing: when a new session starts, tell him how
      // long it has been. Pure data; what he does with it is the soul's call.
      if (gapMinutes !== null && gapMinutes >= 30) {
        const gapLine = `TIME CONTEXT: It has been ${describeGap(gapMinutes)} since your last conversation with this member.`;
        sessionNotesContext = gapLine + (sessionNotesContext ? '\n\n' + sessionNotesContext : '');
      }

      // Save user message tagged with current soul version
      await saveCommanderMessage(req.dbUser.id, sessionId, 'user', message, soulVersion);
      recordMemberActivity(req.dbUser.id).catch(() => {}); // the Walk: they showed up today
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

    // Prefer the new coaching context (intake_responses + benchmark + state);
    // keep the legacy user_intake block as supplementary fallback.
    if (req.dbUser) {
      const coaching = await buildCoachingContext(req.dbUser.id);
      if (coaching) intakeContext = coaching + (intakeContext ? '\n\n' + intakeContext : '');
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

      // If they left before Earl finished, the answer is saved but never
      // reached their screen — tell them it's waiting.
      if (clientLeft) {
        try {
          const { sendPushToUser } = require('../services/push');
          await sendPushToUser(req.dbUser.id, {
            title: 'Earl',
            body: 'Earl has responded to you.',
            url: '/app'
          });
        } catch (e) { console.error('left-chat push failed:', e.message); }
      }

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
    // Surface, don't hide: notify the owner so a real failure gets fixed
    // instead of quietly degrading every member's experience.
    sendOwnerAlert(
      'commander-chat',
      'Earl failed to answer a member',
      `A member's message could not be answered and they saw the snag message.\n\nError: ${e.message}\n\n${e.stack || ''}`
    );
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

const PERIODIC_REPORT_DAYS = 28;

function daysSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
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
    const [benchmarks, ratingHistory, actionSteps, debriefs, periodicReport, knowledgeCount] = await Promise.all([
      getBenchmarks(userId),
      getBenchmarkRatingHistory(userId),
      getActionSteps(userId),
      getSessionDebriefs(userId, 20),
      getLatestPeriodicReport(userId),
      countEarlKnowledge(userId).catch(() => 0)
    ]);

    // Lazy: kick off a periodic report if one is due (non-blocking).
    maybeGeneratePeriodicReport(userId, memberState, benchmarks, debriefs);

    // The semester arc: six months from coaching start, walked week by week.
    const startedAt = memberState?.coaching_started_at || null;
    const week = startedAt
      ? Math.min(26, Math.max(1, Math.floor(daysSince(startedAt) / 7) + 1))
      : null;

    res.json({
      authenticated: true,
      stages: {
        stage_1: !!memberState?.stage_1_complete,
        stage_2: !!memberState?.stage_2_complete,
        stage_3: !!memberState?.stage_3_complete
      },
      walk: {
        current: memberState?.current_streak || 0,
        longest: memberState?.longest_streak || 0
      },
      knowledgeCount,
      semester: startedAt ? { week, totalWeeks: 26, startedAt } : null,
      benchmarks: benchmarks.map(b => ({
        id: b.id, statement: b.statement, position: b.position,
        starting_rating: b.starting_rating, current_rating: b.current_rating,
        completed_at: b.completed_at || null
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
      privacy: { optOut: !!memberState?.anonymous_data_opt_out },
      graduation: (() => {
        const life = evaluateLifecycle(benchmarks, ratingHistory, memberState);
        return {
          offered: life.graduationCandidate && !memberState?.graduated_at,
          graduated: !!memberState?.graduated_at
        };
      })()
    });
  } catch (e) {
    console.error('Progress error:', e.message);
    res.status(500).json({ error: 'Could not load progress' });
  }
});

/**
 * GET /api/member/push/vapid-public-key
 * The public key the browser needs to create a push subscription.
 */
router.get('/member/push/vapid-public-key', (req, res) => {
  res.json({ key: getVapidPublicKey() });
});

/**
 * POST /api/member/push/subscribe
 * Body: { subscription }. Registers this device to receive Earl's check-ins.
 */
router.post('/member/push/subscribe', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'subscription required' });
    }
    await saveSubscription(req.dbUser.id, subscription, req.get('user-agent') || null);
    res.json({ ok: true });
  } catch (e) {
    console.error('Push subscribe error:', e.message);
    res.status(500).json({ error: 'Could not register for notifications' });
  }
});

/**
 * POST /api/member/push/unsubscribe
 * Body: { endpoint }. Member turned notifications off on this device.
 */
router.post('/member/push/unsubscribe', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { endpoint } = req.body;
    if (endpoint) await removeSubscription(endpoint);
    res.json({ ok: true });
  } catch (e) {
    console.error('Push unsubscribe error:', e.message);
    res.status(500).json({ error: 'Could not turn off notifications' });
  }
});

/**
 * POST /api/member/checkin/reply
 * Body: { text, token? }. A reply typed straight into a phone notification.
 * Auth: the signed token in the notification (works even when the login cookie
 * has expired — a reply sent minutes after the push); falls back to the Clerk
 * cookie when present. Records the reply, has Earl respond, pushes his answer.
 */
router.post('/member/checkin/reply', async (req, res) => {
  // Resolve the member from the notification token first, then the cookie.
  let userId = req.dbUser && req.dbUser.id;
  if (!userId && req.body && req.body.token) {
    const { verify } = require('../services/replytoken');
    userId = verify(req.body.token);
  }
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  try {
    const text = ((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const result = await replyToCheckIn(userId, text);
    res.json({ ok: true, reply: result.reply });
  } catch (e) {
    console.error('Check-in reply error:', e.message);
    // Surface, don't hide — a broken reply loop should reach the owner.
    sendOwnerAlert('checkin-reply', 'Earl failed to answer a notification reply', `User ${userId}: ${e.message}`);
    res.status(500).json({ error: 'Could not send your reply' });
  }
});

/**
 * GET /api/member/friend
 * The member's accountability person + any note awaiting their approval.
 */
router.get('/member/friend', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const state = await ensureMemberState(req.dbUser.id);
    const draft = await getDraftFriendNote(req.dbUser.id);
    res.json({
      friend: state?.friend_email
        ? { name: state.friend_name, email: state.friend_email, fromName: state.friend_from_name }
        : null,
      pendingNote: draft ? { id: draft.id, note: draft.note, created_at: draft.created_at } : null,
    });
  } catch (e) {
    console.error('Friend fetch error:', e.message);
    res.status(500).json({ error: 'Could not load' });
  }
});

/**
 * POST /api/member/friend
 * Body: { name, email, fromName }. Invite (or replace) the one person who
 * holds you to it. Pass empty email to remove.
 */
router.post('/member/friend', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { name, email, fromName } = req.body || {};
    await ensureMemberState(req.dbUser.id);
    if (!email || !String(email).trim()) {
      await updateMemberState(req.dbUser.id, { friend_name: null, friend_email: null, friend_from_name: null, friend_invited_at: null });
      return res.json({ ok: true, removed: true });
    }
    const clean = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return res.status(400).json({ error: 'That email does not look right' });
    await updateMemberState(req.dbUser.id, {
      friend_name: String(name || '').trim() || null,
      friend_email: clean,
      friend_from_name: String(fromName || '').trim() || null,
      friend_invited_at: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Friend save error:', e.message);
    res.status(500).json({ error: 'Could not save' });
  }
});

/**
 * POST /api/member/friend/note
 * Body: { noteId, action: 'send' | 'skip' }. Approving sends the note to the
 * friend by email; skipping quietly drops it. Nothing sends without this.
 */
router.post('/member/friend/note', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { noteId, action } = req.body || {};
    if (!noteId || !['send', 'skip'].includes(action)) return res.status(400).json({ error: 'noteId and action required' });

    if (action === 'skip') {
      await setFriendNoteStatus(noteId, req.dbUser.id, 'skipped');
      return res.json({ ok: true });
    }

    const state = await ensureMemberState(req.dbUser.id);
    if (!state?.friend_email) return res.status(400).json({ error: 'No friend on file' });
    const draft = await getDraftFriendNote(req.dbUser.id);
    if (!draft || draft.id !== noteId) return res.status(404).json({ error: 'Note not found' });

    const from = state.friend_from_name || 'your friend';
    const { mintFriendOptOut } = require('../services/replytoken');
    const base = process.env.PUBLIC_BASE_URL || 'https://captainsbridge.io';
    const optOut = `${base}/friend/opt-out?t=${encodeURIComponent(mintFriendOptOut(req.dbUser.id))}`;
    const html = `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:26px;background:#f5f0e8;color:#1a1512;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.7;">${String(draft.note).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p>
      <p style="margin:0 0 4px;font-size:13px;color:#6a5c4a;">— Earl, walking alongside ${from.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>
      <p style="margin:16px 0 0;font-size:11px;color:#9a948a;">${from.replace(/&/g,'&amp;').replace(/</g,'&lt;')} chose you as the person who keeps them honest, and approved this note before it was sent. Curious what Earl is? <a href="https://captainsbridge.io" style="color:#8a6830;">captainsbridge.io</a><br><a href="${optOut}" style="color:#9a948a;">I would rather not receive these</a></p>
    </div>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Earl <earl@captainsbridge.io>',
        to: [state.friend_email],
        subject: `A note about ${from}`,
        html,
      }),
    });
    if (!r.ok) throw new Error('Resend ' + r.status);
    await setFriendNoteStatus(noteId, req.dbUser.id, 'sent');
    res.json({ ok: true, sent: true });
  } catch (e) {
    console.error('Friend note error:', e.message);
    sendOwnerAlert('friend-note', 'Friend note send failed', `User ${req.dbUser.id}: ${e.message}`);
    res.status(500).json({ error: 'Could not send the note' });
  }
});

/**
 * POST /api/member/newsletter-optin
 * Alumni drumbeat: subscribe the signed-in member's own email to the
 * newsletter (used on the certificate page).
 */
router.post('/member/newsletter-optin', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const store = require('../services/newsletter/store');
    await store.addSubscriber({ email: req.dbUser.email, userId: req.dbUser.id, source: 'alumni' });
    res.json({ ok: true });
  } catch (e) {
    console.error('Newsletter opt-in error:', e.message);
    res.status(500).json({ error: 'Could not subscribe' });
  }
});

/**
 * POST /api/member/push/test
 * Send the calling member an Earl check-in right now — the "does this work?"
 * button in Settings. Composes a real, situational message, drops it in their
 * chat, and pushes it to their enabled devices.
 */
router.post('/member/push/test', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = await checkInOne(req.dbUser.id);
    res.json({ ok: true, pushed: !!(result && result.pushed) });
  } catch (e) {
    console.error('Push test error:', e.message);
    res.status(500).json({ error: 'Could not send a test' });
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
 * GET /api/member/intake-changes
 * The member's editable interview answers and how many changes remain.
 */
router.get('/member/intake-changes', async (req, res) => {
  if (!req.dbUser) return res.json({ authenticated: false });
  try {
    const state = await ensureMemberState(req.dbUser.id);
    const responses = await getIntakeResponses(req.dbUser.id, 1);
    const answers = responses
      .filter(r => r.answer && String(r.answer).trim())
      .map(r => {
        const q = getQuestionByField(r.question_field);
        return { field: r.question_field, label: q ? q.question : r.question_field, answer: r.answer };
      });
    res.json({
      authenticated: true,
      remaining: state?.intake_changes_remaining ?? 0,
      contactEmail: 'ClydeAIbusiness@gmail.com',
      answers
    });
  } catch (e) {
    console.error('Intake-changes fetch error:', e.message);
    res.status(500).json({ error: 'Could not load your answers' });
  }
});

/**
 * POST /api/member/intake-changes
 * Body: { field, answer }. Updates one interview answer and decrements the
 * allowance (3 total). Locks at zero with a contact email.
 */
router.post('/member/intake-changes', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { field, answer } = req.body;
    const q = getQuestionByField(field);
    if (!q) return res.status(400).json({ error: 'Unknown question' });
    if (!answer || !String(answer).trim()) return res.status(400).json({ error: 'Answer required' });

    const state = await ensureMemberState(req.dbUser.id);
    const remaining = state?.intake_changes_remaining ?? 0;
    if (remaining <= 0) {
      return res.status(403).json({ error: 'no_changes_left', contactEmail: 'ClydeAIbusiness@gmail.com' });
    }

    await saveIntakeResponse(req.dbUser.id, 1, q.stage, field, String(answer).trim());
    await updateMemberState(req.dbUser.id, { intake_changes_remaining: remaining - 1 });
    res.json({ ok: true, remaining: remaining - 1 });
  } catch (e) {
    console.error('Intake-changes save error:', e.message);
    res.status(500).json({ error: 'Could not save your change' });
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
 * PATCH /api/member/action-steps/:id
 * Member edits the text of one of their action steps.
 */
router.patch('/member/action-steps/:id', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { step_text } = req.body;
    if (!step_text || !String(step_text).trim()) return res.status(400).json({ error: 'step_text required' });
    const { updateActionStepText } = require('../services/supabase');
    const step = await updateActionStepText(req.params.id, req.dbUser.id, String(step_text).trim());
    if (!step) return res.status(404).json({ error: 'Step not found or not yours' });
    res.json({ ok: true, step });
  } catch (e) {
    console.error('Update action step error:', e.message);
    res.status(500).json({ error: 'Could not update action step' });
  }
});

/**
 * POST /api/member/action-steps
 * Member manually creates an action step, optionally tied to a benchmark.
 */
router.post('/member/action-steps', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const { step_text, benchmark_id } = req.body;
    if (!step_text || !String(step_text).trim()) {
      return res.status(400).json({ error: 'step_text required' });
    }
    const { saveActionStep } = require('../services/supabase');
    const step = await saveActionStep(
      req.dbUser.id,
      String(step_text).trim(),
      null,
      null,
      benchmark_id || null
    );
    if (!step) return res.status(500).json({ error: 'Could not save action step' });
    res.json({ ok: true, step });
  } catch (e) {
    console.error('Create action step error:', e.message);
    res.status(500).json({ error: 'Could not save action step' });
  }
});

/**
 * POST /api/member/action-steps/:id/complete
 * Marks a step complete from the progress view. The "how did it go?"
 * follow-up now happens in conversation with Earl, not a popup.
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
    recordMemberActivity(req.dbUser.id).catch(() => {}); // the Walk: they showed up today

    res.json({ ok: true });
  } catch (e) {
    console.error('Action step complete error:', e.message);
    res.status(500).json({ error: 'Could not complete action step' });
  }
});

// ============================================================
// INTERVIEWING COMMANDER — conversational intake (round 1)
// ============================================================

/** Rule-based vagueness check (stage 1 of the two-stage check). */
function isVague(answer, check) {
  if (!check) return false;
  const raw = (answer || '').trim();
  const low = raw.toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean).length;

  if (check.custom === 'always_if_no') {
    return /^(no|nope|not really|haven'?t|have not|not yet|never)\b/.test(low);
  }
  if (check.custom === 'depends_only') {
    return low === 'depends' || /^(it )?depends\.?$/.test(low);
  }
  if (check.custom === 'both_only') {
    return /^both( equally)?\.?$/.test(low);
  }
  if (check.minWords && words < check.minWords) return true;
  if (check.banned && check.banned.some(b => low.includes(b))) return true;
  if (check.needNumber && !/\d/.test(raw)) return true;
  if (check.needTimeRef && !/\d|year|month|week|day|decade/.test(low)) return true;
  return false;
}

function answeredFieldSet(responses) {
  const set = new Set();
  for (const r of responses) if (r.answer != null && String(r.answer).trim() !== '') set.add(r.question_field);
  return set;
}

function nextQuestion(answered) {
  return QUESTIONS.find(q => !answered.has(q.field)) || null;
}

function stageStatus(memberState) {
  return {
    stage_1: !!memberState?.stage_1_complete,
    stage_2: !!memberState?.stage_2_complete,
    stage_3: !!memberState?.stage_3_complete
  };
}

/** Mark a stage complete (and after stage 2, generate the benchmark). */
async function completeStageIfDone(userId, stage, answered) {
  const bounds = STAGE_BOUNDS[stage];
  const stageFields = QUESTIONS.filter(q => q.stage === stage).map(q => q.field);
  const allAnswered = stageFields.every(f => answered.has(f));
  if (!allAnswered) return { completed: false };

  const flag = `stage_${stage}_complete`;
  const tsField = `stage_${stage}_completed_at`;
  const state = await ensureMemberState(userId);
  if (state && state[flag]) return { completed: false }; // already handled

  await updateMemberState(userId, { [flag]: true, [tsField]: new Date().toISOString() });

  let benchmarkReady = false;
  if (stage === 2) {
    try {
      const responses = await getIntakeResponses(userId, 1);
      const answers = {};
      for (const r of responses) answers[r.question_field] = r.follow_up_answer
        ? `${r.answer} ${r.follow_up_answer}` : r.answer;
      const bench = await generateBenchmark(answers);
      if (bench.statements && bench.statements.length) {
        await saveBenchmarks(userId, bench.statements);
        if (bench.hidden_metrics) await updateMemberState(userId, { hidden_metrics: bench.hidden_metrics });
        benchmarkReady = true;
      }
    } catch (e) {
      console.error('Benchmark generation failed:', e.message);
    }
  }

  // Regenerate the Navigation Chart from the interview so far (background,
  // non-blocking). Fires on every stage completion, per spec.
  runBackground('chart-regen', async () => {
    const all = await getIntakeResponses(userId, 1);
    const sections = await generateChartFromInterview(answersMap(all));
    if (sections && sections.length) await saveChartSections(userId, sections);
  });

  return { completed: true, message: STAGE_COMPLETE[stage], benchmarkReady };
}

/** Build a { field: answer (+follow-up) } map from a set of intake responses. */
function answersMap(responses) {
  const m = {};
  for (const r of responses) {
    m[r.question_field] = r.follow_up_answer ? `${r.answer} ${r.follow_up_answer}` : r.answer;
  }
  return m;
}

/** Finalize graduation after the round-2 exit interview completes. */
async function finalizeGraduation(userId) {
  const [r1, r2] = await Promise.all([getIntakeResponses(userId, 1), getIntakeResponses(userId, 2)]);
  let comparison = { changes: [] };
  try {
    comparison = await generateGraduationComparison(answersMap(r1), answersMap(r2));
  } catch (e) {
    console.error('Graduation comparison failed:', e.message);
  }
  const freeUntil = new Date();
  freeUntil.setMonth(freeUntil.getMonth() + 6);
  await finalizeGraduationRecord(userId, comparison, freeUntil.toISOString().split('T')[0]);
  await updateMemberState(userId, { graduated_at: new Date().toISOString() });
}

/**
 * POST /api/member/graduation/start
 * Begins the exit interview once condition 1 (metric movement) is met. The
 * member reaches here only after the Commander's confirming conversation.
 */
router.post('/member/graduation/start', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const userId = req.dbUser.id;
    const [benches, ratingHistory, state] = await Promise.all([
      getBenchmarks(userId), getBenchmarkRatingHistory(userId), ensureMemberState(userId)
    ]);
    if (state?.graduated_at) return res.status(400).json({ error: 'already_graduated' });
    const life = evaluateLifecycle(benches, ratingHistory, state);
    if (!life.graduationCandidate) return res.status(403).json({ error: 'not_eligible' });

    const startedOn = state?.coaching_started_at
      ? new Date(state.coaching_started_at).toISOString().split('T')[0] : null;
    await createGraduationRecord(userId, startedOn);
    res.json({ ok: true });
  } catch (e) {
    console.error('Graduation start error:', e.message);
    res.status(500).json({ error: 'Could not start the exit interview' });
  }
});

/**
 * GET /api/member/graduation
 * The graduation record + certificate content (for the certificate page).
 */
router.get('/member/graduation', async (req, res) => {
  if (!req.dbUser) return res.json({ record: null });
  try {
    const rec = await getGraduationRecord(req.dbUser.id);
    const r1 = await getIntakeResponses(req.dbUser.id, 1);
    let memberName = null, businessName = null;
    for (const r of r1) {
      if (r.question_field === 'member_name') memberName = r.answer;
      if (r.question_field === 'business_name') businessName = r.answer;
    }
    res.json({
      memberName, businessName,
      record: rec ? {
        comparison: rec.comparison, started_on: rec.started_on,
        graduated_on: rec.graduated_on, free_access_until: rec.free_access_until,
        certificate_issued: rec.certificate_issued
      } : null
    });
  } catch (e) {
    console.error('Graduation fetch error:', e.message);
    res.json({ record: null });
  }
});

/** Paid membership check (mirrors requirePaidMember's tier list). */
function isPaidMember(dbUser) {
  const t = dbUser && dbUser.membership_tier;
  return t === 'ensign' || t === 'navigator' || t === 'captain';
}

/**
 * GET /api/member/interview/state
 * The next question to ask (with stage framing if a stage is starting), or done.
 * Stage 1 is free; unpaid members hitting Stage 2 get the paywall (Earl's
 * First Read + the door).
 */
router.get('/member/interview/state', async (req, res) => {
  if (!req.dbUser) return res.json({ authenticated: false });
  try {
    const userId = req.dbUser.id;
    const round = parseInt(req.query.round, 10) === 2 ? 2 : 1;
    const memberState = await ensureMemberState(userId);
    const responses = await getIntakeResponses(userId, round);
    const answered = answeredFieldSet(responses);
    const q = nextQuestion(answered);
    const paid = isPaidMember(req.dbUser);

    // Free funnel: Stage 1 done, not yet paid → the First Read screen.
    if (round === 1 && !paid && (memberState?.stage_1_complete || (q && q.stage > 1))) {
      return res.json({ authenticated: true, paid: false, paywall: true, round,
        stages: stageStatus(memberState) });
    }

    if (!q) {
      return res.json({ authenticated: true, paid, done: true, round, stages: stageStatus(memberState),
        progress: { answered: answered.size, total: QUESTIONS.length } });
    }
    const framing = (q.n === STAGE_BOUNDS[q.stage].first) ? STAGE_FRAMING[q.stage] : null;
    res.json({
      authenticated: true, paid, done: false, round,
      stages: stageStatus(memberState),
      progress: { answered: answered.size, total: QUESTIONS.length },
      stage: q.stage,
      framing,
      question: { n: q.n, field: q.field, text: q.question }
    });
  } catch (e) {
    console.error('Interview state error:', e.message);
    res.status(500).json({ error: 'Could not load the interview' });
  }
});

/**
 * GET /api/member/first-read
 * Earl's first read on the business, generated once from the Stage-1 answers
 * and stored word-for-word. The free taste that IS the sales pitch.
 */
router.get('/member/first-read', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const userId = req.dbUser.id;
    const state = await ensureMemberState(userId);
    if (state?.first_read) return res.json({ read: state.first_read });

    const responses = await getIntakeResponses(userId, 1);
    const answers = {};
    for (const r of responses) {
      const q = getQuestionByField(r.question_field);
      if (q && q.stage === 1 && r.answer) {
        answers[r.question_field] = r.answer + (r.follow_up_answer ? ' ' + r.follow_up_answer : '');
      }
    }
    if (!Object.keys(answers).length) return res.status(400).json({ error: 'Finish Stage 1 first' });

    const { generateFirstRead } = require('../services/claude');
    const read = await generateFirstRead(answers);
    if (read) await updateMemberState(userId, { first_read: read });
    res.json({ read });
  } catch (e) {
    console.error('First read error:', e.message);
    sendOwnerAlert('first-read', 'First Read generation failed', `User ${req.dbUser.id}: ${e.message}`);
    res.status(500).json({ error: 'Earl could not finish his read just now. Give it a moment and reload.' });
  }
});

/**
 * POST /api/member/interview/answer
 * Body: { field, answer, isFollowUp }
 * Saves immediately. Returns a follow-up if the answer is vague, otherwise the
 * next step (next question / stage completion / done).
 */
router.post('/member/interview/answer', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const userId = req.dbUser.id;
    const { field, answer, isFollowUp } = req.body;
    const round = parseInt(req.body.round, 10) === 2 ? 2 : 1;
    const q = getQuestionByField(field);
    if (!q) return res.status(400).json({ error: 'Unknown question' });
    if (answer == null || String(answer).trim() === '') {
      return res.status(400).json({ error: 'Answer required' });
    }
    // Stage 1 is free; the rest of the interview is membership.
    if (round === 1 && q.stage > 1 && !isPaidMember(req.dbUser)) {
      return res.status(402).json({ paywall: true });
    }

    if (isFollowUp) {
      // Record the follow-up answer; never re-prompt.
      await updateIntakeFollowUp(userId, round, field, undefined, String(answer));
    } else {
      await saveIntakeResponse(userId, round, q.stage, field, String(answer));
      if (round === 1) recordAnonymous(userId, 'intake_answer', { field, stage: q.stage });

      // Two-stage vagueness check → one follow-up, then always advance.
      if (isVague(answer, q.check) && q.followup.kind !== 'none') {
        let followUp;
        if (q.followup.kind === 'string') {
          const snippet = String(answer).trim().split(/\s+/).slice(0, 12).join(' ');
          followUp = q.followup.template.replace('[answer]', snippet);
        } else {
          try {
            followUp = await generateIntakeFollowUp(q.question, String(answer), q.followup.instruction);
          } catch (e) {
            followUp = null; // if generation fails, just move on
          }
        }
        if (followUp) {
          await updateIntakeFollowUp(userId, round, field, followUp, undefined);
          return res.json({ followUp });
        }
      }
    }

    // Advance.
    const responses = await getIntakeResponses(userId, round);
    const answered = answeredFieldSet(responses);

    // Round 2 = graduation exit interview: no stage flags, no benchmark.
    // On full completion, finalize graduation and issue the certificate.
    if (round === 2) {
      const nq2 = nextQuestion(answered);
      if (!nq2) {
        await finalizeGraduation(userId);
        return res.json({ done: true, round: 2, graduated: true });
      }
      return res.json({
        done: false, round: 2,
        framing: (nq2.n === STAGE_BOUNDS[nq2.stage].first) ? STAGE_FRAMING[nq2.stage] : null,
        stage: nq2.stage,
        question: { n: nq2.n, field: nq2.field, text: nq2.question }
      });
    }

    const stageResult = await completeStageIfDone(userId, q.stage, answered);
    const nq = nextQuestion(answered);
    const memberState = await ensureMemberState(userId);

    // Free funnel: Stage 1 just wrapped for an unpaid member → the First Read.
    if (!isPaidMember(req.dbUser) && (!nq || nq.stage > 1)) {
      return res.json({
        paywall: true,
        stageComplete: stageResult.completed ? stageResult.message : null,
        stages: stageStatus(memberState)
      });
    }

    if (!nq) {
      return res.json({
        done: true,
        stageComplete: stageResult.completed ? stageResult.message : null,
        benchmarkReady: !!stageResult.benchmarkReady,
        stages: stageStatus(memberState)
      });
    }

    res.json({
      done: false,
      stageComplete: stageResult.completed ? stageResult.message : null,
      benchmarkReady: !!stageResult.benchmarkReady,
      framing: (nq.n === STAGE_BOUNDS[nq.stage].first && stageResult.completed) ? STAGE_FRAMING[nq.stage] : null,
      stage: nq.stage,
      question: { n: nq.n, field: nq.field, text: nq.question },
      stages: stageStatus(memberState)
    });
  } catch (e) {
    console.error('Interview answer error:', e.message);
    res.status(500).json({ error: 'Could not save your answer' });
  }
});

/**
 * GET /api/member/benchmark
 * Current benchmark statements (for the review screen and the progress view).
 */
router.get('/member/benchmark', async (req, res) => {
  if (!req.dbUser) return res.json({ benchmarks: [] });
  try {
    const benches = await getBenchmarks(req.dbUser.id, false);
    res.json({
      benchmarks: benches.map(b => ({
        id: b.id, statement: b.statement, position: b.position,
        starting_rating: b.starting_rating, current_rating: b.current_rating, approved: b.approved
      }))
    });
  } catch (e) {
    console.error('Benchmark fetch error:', e.message);
    res.json({ benchmarks: [] });
  }
});

/**
 * POST /api/member/benchmark/approve
 * Body: { statements: [string] } — the member's final, reviewed list.
 */
router.post('/member/benchmark/approve', async (req, res) => {
  if (!req.dbUser) return res.status(401).json({ error: 'Authentication required' });
  try {
    const statements = Array.isArray(req.body.statements)
      ? req.body.statements.map(s => String(s).trim()).filter(Boolean).slice(0, 5)
      : [];
    if (statements.length === 0) return res.status(400).json({ error: 'At least one statement required' });
    const saved = await approveBenchmarks(req.dbUser.id, statements);
    res.json({ ok: true, benchmarks: saved.map(b => ({ id: b.id, statement: b.statement })) });
  } catch (e) {
    console.error('Benchmark approve error:', e.message);
    res.status(500).json({ error: 'Could not save your benchmark' });
  }
});

module.exports = router;
