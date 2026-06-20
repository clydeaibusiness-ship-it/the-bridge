const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

function getClient() {
  if (!supabase && supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
  }
  return supabase;
}

// ---- Users ----

async function createUser(clerkId, email) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('users')
    .insert({ clerk_id: clerkId, email })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getUserByClerkId(clerkId) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('clerk_id', clerkId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function updateMembershipTier(userId, tier) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('users')
    .update({ membership_tier: tier })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateStripeCustomerId(userId, stripeCustomerId) {
  const db = getClient();
  if (!db) return null;

  const { error } = await db
    .from('users')
    .update({ stripe_customer_id: stripeCustomerId })
    .eq('id', userId);

  if (error) throw error;
}

// ---- Anonymous Events ----

async function upsertAnonymousEvent(sessionData) {
  const db = getClient();
  if (!db) return null;

  const record = {
    session_id: sessionData.session_id,
    industry: sessionData.industry,
    biggest_uncertainty: sessionData.biggest_uncertainty,
    starting_levers: sessionData.starting_levers,
    threats_encountered: sessionData.threats_encountered,
    turns_survived: sessionData.turns_survived || 0,
    email_captured: sessionData.email_captured || false,
    converted_to_member: sessionData.converted_to_member || false,
    last_event: new Date().toISOString()
  };

  const { data, error } = await db
    .from('anonymous_events')
    .upsert(record, { onConflict: 'session_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getWeeklyEvents(daysBack = 7) {
  const db = getClient();
  if (!db) return [];

  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data, error } = await db
    .from('anonymous_events')
    .select('*')
    .gte('session_start', since.toISOString());

  if (error) throw error;
  return data || [];
}

// ---- Commander Sessions ----

async function getCommanderUsage(userId) {
  const db = getClient();
  if (!db) return { used: 0, max: 20 };

  const { data, error } = await db
    .from('users')
    .select('commander_sessions_used, commander_sessions_reset_date')
    .eq('id', userId)
    .single();

  if (error) return { used: 0, max: 20 };

  // Reset monthly counter if needed
  const resetDate = new Date(data.commander_sessions_reset_date);
  const now = new Date();
  if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    await db.from('users').update({
      commander_sessions_used: 0,
      commander_sessions_reset_date: now.toISOString().split('T')[0]
    }).eq('id', userId);
    return { used: 0, max: 20 };
  }

  return { used: data.commander_sessions_used || 0, max: 20 };
}

async function incrementCommanderUsage(userId) {
  const db = getClient();
  if (!db) return;

  const { error } = await db.rpc('increment_commander_sessions', { user_id_input: userId });
  if (error) {
    // Fallback: manual increment
    const { data } = await db.from('users').select('commander_sessions_used').eq('id', userId).single();
    if (data) {
      await db.from('users').update({
        commander_sessions_used: (data.commander_sessions_used || 0) + 1
      }).eq('id', userId);
    }
  }
}

// ---- Commander Messages ----

async function saveCommanderMessage(userId, sessionId, role, content, soulVersion = null) {
  const db = getClient();
  if (!db) return null;

  const insertData = {
    user_id: userId,
    session_id: sessionId,
    message_role: role,
    message_content: content
  };
  if (soulVersion) insertData.soul_version = soulVersion;

  const { data, error } = await db
    .from('commander_messages')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    if (error.message && error.message.includes('soul_version')) {
      console.error('MISSING COLUMN: commander_messages.soul_version does not exist. Run: ALTER TABLE commander_messages ADD COLUMN soul_version TEXT DEFAULT NULL;');
    }
    console.error('Save commander message error:', error.message);
    return null;
  }
  return data;
}

async function getCommanderHistory(userId, limit = 20) {
  const db = getClient();
  if (!db) return [];

  const { data, error } = await db
    .from('commander_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Get commander history error:', error.message);
    return [];
  }
  // Return in chronological order
  return (data || []).reverse();
}

async function getLatestCommanderSessionId(userId) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('commander_messages')
    .select('session_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return { sessionId: data[0].session_id, lastMessageAt: data[0].created_at };
}

async function getCommanderMessagesForApi(userId, limit = 10, soulVersion = null) {
  const db = getClient();
  if (!db) return [];

  let query = db
    .from('commander_messages')
    .select('message_role, message_content, soul_version')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data, error } = await query;

  if (error) {
    if (error.message && error.message.includes('soul_version')) {
      console.error('MISSING COLUMN: commander_messages.soul_version does not exist. Run: ALTER TABLE commander_messages ADD COLUMN soul_version TEXT DEFAULT NULL;');
    }
    console.error('Get commander messages error:', error.message);
    return [];
  }

  // If we have a soul version, filter out assistant messages from old versions.
  // User messages always pass through — they're the member's words.
  // Assistant messages only pass if they match the current soul version
  // (or have no version tag, for backward compat during transition).
  let filtered = data || [];
  if (soulVersion) {
    filtered = filtered.filter(m => {
      if (m.message_role === 'user') return true;
      // Assistant messages: keep if same version or no version tagged yet
      return !m.soul_version || m.soul_version === soulVersion;
    });
  }

  // Return in chronological order, formatted for Claude API
  const chronological = filtered.reverse().map(m => ({
    role: m.message_role,
    content: m.message_content
  }));

  // Enforce strict role alternation after soul version filtering.
  // When old assistant messages are filtered out, consecutive user messages remain.
  // Anthropic rejects consecutive same-role messages.
  // Keep the LAST message in any consecutive same-role sequence (most recent matters most).
  const deduplicated = [];
  for (let i = 0; i < chronological.length; i++) {
    const msg = chronological[i];
    const next = chronological[i + 1];
    // If the next message has the same role, skip this one (keep the later one)
    if (next && next.role === msg.role) {
      continue;
    }
    deduplicated.push(msg);
  }

  // Ensure the first message is role:user (it follows the silent "." + soul primer)
  // If it starts with assistant, drop it — the soul primer already covers that slot
  if (deduplicated.length > 0 && deduplicated[0].role === 'assistant') {
    deduplicated.shift();
  }

  return deduplicated;
}

// ---- Commander Summaries ----

async function saveCommanderSummary(userId, sessionId, summary) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('commander_summaries')
    .insert({
      user_id: userId,
      session_id: sessionId,
      summary
    })
    .select()
    .single();

  if (error) {
    console.error('Save commander summary error:', error.message);
    return null;
  }
  return data;
}

async function getLatestCommanderSummary(userId) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('commander_summaries')
    .select('summary, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0];
}

// ---- Unified Intake ----

async function upsertIntake(userId, answers) {
  const db = getClient();
  if (!db) return null;

  const record = {
    user_id: userId,
    business_name: answers.businessName || answers.business_name || null,
    website_url: answers.websiteUrl || answers.website_url || null,
    facebook_url: answers.facebookUrl || answers.facebook_url || null,
    business_description: answers.description || answers.businessDescription || answers.business_description || null,
    years_operating: answers.years || answers.yearsOperating || answers.years_operating || null,
    revenue_range: answers.revenue || answers.revenueRange || answers.revenue_range || null,
    team_size: answers.employees || answers.teamSize || answers.team_size || null,
    exact_revenue: (typeof answers.revenue === 'number' || (typeof answers.revenue === 'string' && /^\d+$/.test(answers.revenue))) ? parseInt(answers.revenue, 10) : null,
    exact_employee_count: (typeof answers.employees === 'number' || (typeof answers.employees === 'string' && /^\d+$/.test(answers.employees))) ? parseInt(answers.employees, 10) : null,
    repeat_vs_new: answers.customerType || answers.repeatVsNew || answers.repeat_vs_new || null,
    switching_costs: answers.switchingCosts || answers.switching_costs || null,
    systems_dependency: answers.systems || answers.systemsDependency || answers.systems_dependency || null,
    financial_state: answers.financialState || answers.financial_state || null,
    biggest_uncertainty: answers.uncertainty || answers.biggestUncertainty || answers.biggest_uncertainty || null,
    success_in_one_year: answers.goal || answers.successInOneYear || answers.success_in_one_year || null,
    website_content: answers.websiteContent || answers.website_content || null,
    facebook_content: answers.facebookContent || answers.facebook_content || null,
    industry: answers.industry || null,
    differentiator: answers.differentiator || null,
    challenge: answers.challenge || null,
    business_basics_completed: true,
    updated_at: new Date().toISOString()
  };

  // Include session fields if provided
  if (answers._shipName) record.ship_name = answers._shipName;
  if (answers._destinationName) record.destination_name = answers._destinationName;
  if (answers._industryKey) record.industry_key = answers._industryKey;
  if (answers._flavorText) record.flavor_text = answers._flavorText;
  if (answers._businessContext) record.business_context = answers._businessContext;
  if (answers._chartSections) record.chart_sections = answers._chartSections;
  if (answers._scannedContent) record.scanned_content = answers._scannedContent;
  if (answers._intakeCompletedAt) record.intake_completed_at = answers._intakeCompletedAt;

  const { data, error } = await db
    .from('user_intake')
    .upsert(record, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    console.error('Upsert intake error:', error.message);
    return null;
  }
  return data;
}

async function getIntake(userId) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('user_intake')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Get intake error:', error.message);
  }
  return data || null;
}

// ---- Commander Session Notes (compression / long-term memory) ----

/**
 * Get all messages for a specific session (for compression).
 */
async function getCommanderSessionMessages(userId, sessionId) {
  const db = getClient();
  if (!db) return [];

  const { data, error } = await db
    .from('commander_messages')
    .select('message_role, message_content, created_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Get commander session messages error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Save a compressed session note.
 */
async function saveSessionNote(userId, sessionId, insights, strategicGround, unresolvedThreads, turnCount) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('commander_session_notes')
    .insert({
      user_id: userId,
      session_id: sessionId,
      operator_insights: insights,
      strategic_ground: strategicGround,
      unresolved_threads: unresolvedThreads,
      generated_at: new Date().toISOString(),
      conversation_turn_count: turnCount
    })
    .select()
    .single();

  if (error) {
    console.error('Save session note error:', error.message);
    return null;
  }
  return data;
}

/**
 * Get session notes for a user (most recent 30, ordered newest first).
 */
async function getSessionNotes(userId, limit = 30) {
  const db = getClient();
  if (!db) return [];

  const { data, error } = await db
    .from('commander_session_notes')
    .select('operator_insights, strategic_ground, unresolved_threads, generated_at')
    .eq('user_id', userId)
    .order('generated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Get session notes error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Check if a session note already exists for a given session.
 */
async function sessionNoteExists(userId, sessionId) {
  const db = getClient();
  if (!db) return false;

  const { data, error } = await db
    .from('commander_session_notes')
    .select('id')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .limit(1);

  if (error) {
    console.error('Check session note exists error:', error.message);
    return false;
  }
  return data && data.length > 0;
}

// ---- Action Steps (coaching system) ----

/**
 * Save an action step the member committed to during a Commander conversation.
 * Stores the member's exact words. Called when the Commander invokes the
 * save_action_step tool.
 */
async function saveActionStep(userId, stepText, sourceSessionId = null, targetDate = null) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('action_steps')
    .insert({
      user_id: userId,
      step_text: stepText,
      source_session_id: sourceSessionId,
      target_date: targetDate,
      status: 'active'
    })
    .select()
    .single();

  if (error) {
    console.error('Save action step error:', error.message);
    return null;
  }
  return data;
}

// ---- Session Debriefs (coaching system) ----

/**
 * Insert or update the member-facing debrief for a session.
 * One row per session_id — the latest background pass replaces the prior
 * summary rather than flooding the table with a row per message.
 */
async function upsertSessionDebrief(userId, sessionId, summary, shiftDetected = false, unresolvedItem = null) {
  const db = getClient();
  if (!db) return null;

  // Look for an existing debrief for this session
  const { data: existing } = await db
    .from('session_debriefs')
    .select('id')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .limit(1);

  if (existing && existing.length > 0) {
    const { data, error } = await db
      .from('session_debriefs')
      .update({ summary, shift_detected: shiftDetected, unresolved_item: unresolvedItem })
      .eq('id', existing[0].id)
      .select()
      .single();
    if (error) { console.error('Update session debrief error:', error.message); return null; }
    return data;
  }

  const { data, error } = await db
    .from('session_debriefs')
    .insert({
      user_id: userId,
      session_id: sessionId,
      summary,
      shift_detected: shiftDetected,
      unresolved_item: unresolvedItem
    })
    .select()
    .single();

  if (error) { console.error('Insert session debrief error:', error.message); return null; }
  return data;
}

// ---- Member State (coaching lifecycle spine) ----

/**
 * Get the member_state row, creating it on first access. One row per member.
 */
async function ensureMemberState(userId) {
  const db = getClient();
  if (!db) return null;

  const { data: existing } = await db
    .from('member_state')
    .select('*')
    .eq('user_id', userId)
    .limit(1);

  if (existing && existing.length > 0) return existing[0];

  const { data, error } = await db
    .from('member_state')
    .insert({ user_id: userId })
    .select()
    .single();

  if (error) {
    // Another request may have created it concurrently — read it back.
    const { data: race } = await db
      .from('member_state').select('*').eq('user_id', userId).limit(1);
    if (race && race.length > 0) return race[0];
    console.error('ensureMemberState error:', error.message);
    return null;
  }
  return data;
}

async function updateMemberState(userId, patch) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('member_state')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) { console.error('updateMemberState error:', error.message); return null; }
  return data;
}

// ---- Action Steps: reads + status ----

async function getActionSteps(userId, status = null) {
  const db = getClient();
  if (!db) return [];
  let q = db.from('action_steps').select('*').eq('user_id', userId);
  if (status) q = q.eq('status', status);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) { console.error('getActionSteps error:', error.message); return []; }
  return data || [];
}

async function getActionStep(actionStepId) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('action_steps').select('*').eq('id', actionStepId).single();
  if (error && error.code !== 'PGRST116') console.error('getActionStep error:', error.message);
  return data || null;
}

/**
 * Update an action step's status. Sets completed_at when completed.
 * Optionally records the check-in follow-up answer.
 */
async function updateActionStepStatus(actionStepId, status, followUpAnswer = null) {
  const db = getClient();
  if (!db) return null;
  const patch = { status };
  if (status === 'completed') patch.completed_at = new Date().toISOString();
  if (followUpAnswer !== null) patch.follow_up_answer = followUpAnswer;
  const { data, error } = await db
    .from('action_steps').update(patch).eq('id', actionStepId).select().single();
  if (error) { console.error('updateActionStepStatus error:', error.message); return null; }
  return data;
}

/**
 * Record a check-in follow-up note on an action step without changing its status.
 */
async function updateActionStepFollowUp(actionStepId, followUpAnswer) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('action_steps')
    .update({ follow_up_answer: followUpAnswer })
    .eq('id', actionStepId)
    .select()
    .single();
  if (error) { console.error('updateActionStepFollowUp error:', error.message); return null; }
  return data;
}

// ---- Benchmarks + ratings ----

async function getBenchmarks(userId, activeOnly = true) {
  const db = getClient();
  if (!db) return [];
  let q = db.from('member_benchmarks').select('*').eq('user_id', userId);
  if (activeOnly) q = q.eq('active', true);
  const { data, error } = await q.order('position', { ascending: true });
  if (error) { console.error('getBenchmarks error:', error.message); return []; }
  return data || [];
}

/**
 * Record a rating for a benchmark in the history table and update the
 * benchmark's current_rating. Returns the updated benchmark.
 */
async function addBenchmarkRating(userId, benchmarkId, rating, source = 'check_in') {
  const db = getClient();
  if (!db) return null;

  await db.from('benchmark_ratings').insert({
    user_id: userId, benchmark_id: benchmarkId, rating, source
  });

  const { data, error } = await db
    .from('member_benchmarks')
    .update({ current_rating: rating, updated_at: new Date().toISOString() })
    .eq('id', benchmarkId)
    .select()
    .single();
  if (error) { console.error('addBenchmarkRating update error:', error.message); return null; }
  return data;
}

/**
 * All ratings for a member (for the progress arc), oldest first.
 */
async function getBenchmarkRatingHistory(userId) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('benchmark_ratings')
    .select('benchmark_id, rating, source, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) { console.error('getBenchmarkRatingHistory error:', error.message); return []; }
  return data || [];
}

// ---- Check-ins ----

async function createCheckIn(userId, fields) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('check_ins')
    .insert({ user_id: userId, status: 'pending', ...fields })
    .select()
    .single();
  if (error) { console.error('createCheckIn error:', error.message); return null; }
  return data;
}

/**
 * The single check-in to surface now: a pending one, or a snoozed one whose
 * snooze has elapsed. Most recent first.
 */
async function getActiveCheckIn(userId) {
  const db = getClient();
  if (!db) return null;
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('check_ins')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'answered')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) { console.error('getActiveCheckIn error:', error.message); return null; }
  const list = data || [];
  // A snoozed check-in is hidden until snoozed_until passes.
  const due = list.find(c =>
    c.status === 'pending' ||
    (c.status === 'snoozed' && (!c.snoozed_until || c.snoozed_until <= nowIso))
  );
  return due || null;
}

async function getLastAnsweredCheckIn(userId) {
  const db = getClient();
  if (!db) return null;
  const { data } = await db
    .from('check_ins')
    .select('answered_at, type')
    .eq('user_id', userId)
    .eq('status', 'answered')
    .order('answered_at', { ascending: false })
    .limit(1);
  return (data && data.length > 0) ? data[0] : null;
}

async function answerCheckIn(checkInId, { rating = null, choice = null, text_answer = null }) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('check_ins')
    .update({
      status: 'answered',
      answered_at: new Date().toISOString(),
      rating, choice, text_answer
    })
    .eq('id', checkInId)
    .select()
    .single();
  if (error) { console.error('answerCheckIn error:', error.message); return null; }
  return data;
}

async function snoozeCheckIn(checkInId, hours = 24) {
  const db = getClient();
  if (!db) return null;
  const until = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from('check_ins')
    .update({ status: 'snoozed', snoozed_until: until })
    .eq('id', checkInId)
    .select()
    .single();
  if (error) { console.error('snoozeCheckIn error:', error.message); return null; }
  return data;
}

// ---- Session debriefs: reads ----

async function getSessionDebriefs(userId, limit = 20) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('session_debriefs')
    .select('*')
    .eq('user_id', userId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('getSessionDebriefs error:', error.message); return []; }
  return data || [];
}

// ---- Periodic reports ----

async function getLatestPeriodicReport(userId) {
  const db = getClient();
  if (!db) return null;
  const { data } = await db
    .from('periodic_reports')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  return (data && data.length > 0) ? data[0] : null;
}

async function savePeriodicReport(userId, letter, periodStart, periodEnd) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('periodic_reports')
    .insert({ user_id: userId, letter, period_start: periodStart, period_end: periodEnd })
    .select()
    .single();
  if (error) { console.error('savePeriodicReport error:', error.message); return null; }
  return data;
}

// ---- Intake responses (Interviewing Commander) ----

async function saveIntakeResponse(userId, round, stage, field, answer) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('intake_responses')
    .upsert({
      user_id: userId, round, stage, question_field: field, answer,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,round,question_field' })
    .select()
    .single();
  if (error) { console.error('saveIntakeResponse error:', error.message); return null; }
  return data;
}

async function updateIntakeFollowUp(userId, round, field, followUpQuestion, followUpAnswer) {
  const db = getClient();
  if (!db) return null;
  const patch = { updated_at: new Date().toISOString() };
  if (followUpQuestion !== undefined) patch.follow_up_question = followUpQuestion;
  if (followUpAnswer !== undefined) patch.follow_up_answer = followUpAnswer;
  const { data, error } = await db
    .from('intake_responses')
    .update(patch)
    .eq('user_id', userId).eq('round', round).eq('question_field', field)
    .select()
    .single();
  if (error) { console.error('updateIntakeFollowUp error:', error.message); return null; }
  return data;
}

async function getIntakeResponses(userId, round = 1) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('intake_responses')
    .select('*')
    .eq('user_id', userId).eq('round', round)
    .order('stage', { ascending: true });
  if (error) { console.error('getIntakeResponses error:', error.message); return []; }
  return data || [];
}

// ---- Benchmark creation + approval ----

/**
 * Replace a member's benchmark set with newly generated statements and seed
 * the rating history. Used once after Stage 2 (and editable on review).
 */
async function saveBenchmarks(userId, statements) {
  const db = getClient();
  if (!db) return [];
  // Clear any prior set (regeneration / re-review).
  await db.from('member_benchmarks').delete().eq('user_id', userId);

  const rows = statements.map((s, i) => ({
    user_id: userId,
    statement: s.statement,
    position: i,
    starting_rating: s.starting_rating ?? null,
    current_rating: s.starting_rating ?? null,
    approved: false,
    active: true
  }));
  const { data, error } = await db.from('member_benchmarks').insert(rows).select();
  if (error) { console.error('saveBenchmarks error:', error.message); return []; }

  // Seed the arc with the starting rating.
  const seed = (data || [])
    .filter(b => b.starting_rating != null)
    .map(b => ({ user_id: userId, benchmark_id: b.id, rating: b.starting_rating, source: 'initial' }));
  if (seed.length) await db.from('benchmark_ratings').insert(seed);

  return data || [];
}

/**
 * Apply the member's reviewed statements (edit/add/remove) and mark approved.
 * `statements` is the final list of strings in display order.
 */
async function approveBenchmarks(userId, statements) {
  const db = getClient();
  if (!db) return [];
  const existing = await getBenchmarks(userId, false);
  const byPos = existing.sort((a, b) => a.position - b.position);

  // Simple reconcile: rewrite the set, preserving ratings where the statement
  // text is unchanged so the arc is not lost on a pure approval.
  await db.from('member_benchmarks').delete().eq('user_id', userId);
  const rows = statements.map((text, i) => {
    const prior = byPos.find(b => b.statement === text);
    return {
      user_id: userId,
      statement: text,
      position: i,
      starting_rating: prior?.starting_rating ?? 1,
      current_rating: prior?.current_rating ?? prior?.starting_rating ?? 1,
      approved: true,
      active: true
    };
  });
  const { data, error } = await db.from('member_benchmarks').insert(rows).select();
  if (error) { console.error('approveBenchmarks error:', error.message); return []; }
  return data || [];
}

// ---- Anonymous aggregate data (no personal identifiers) ----

/**
 * Record a de-identified event for product/social-proof metrics.
 * Callers must check member_state.anonymous_data_opt_out first — no user_id
 * is ever stored here.
 */
async function insertAnonymousAggregate(eventType, industry = null, payload = null) {
  const db = getClient();
  if (!db) return null;
  const { error } = await db
    .from('anonymous_aggregate_data')
    .insert({ event_type: eventType, industry, payload });
  if (error) { console.error('insertAnonymousAggregate error:', error.message); return null; }
  return true;
}

module.exports = {
  getClient,
  createUser, getUserByClerkId, updateMembershipTier, updateStripeCustomerId,
  upsertAnonymousEvent, getWeeklyEvents,
  getCommanderUsage, incrementCommanderUsage,
  saveCommanderMessage, getCommanderHistory, getLatestCommanderSessionId,
  getCommanderMessagesForApi,
  saveCommanderSummary, getLatestCommanderSummary,
  upsertIntake, getIntake,
  getCommanderSessionMessages, saveSessionNote, getSessionNotes, sessionNoteExists,
  saveActionStep, upsertSessionDebrief,
  ensureMemberState, updateMemberState,
  getActionSteps, getActionStep, updateActionStepStatus, updateActionStepFollowUp,
  getBenchmarks, addBenchmarkRating, getBenchmarkRatingHistory,
  createCheckIn, getActiveCheckIn, getLastAnsweredCheckIn, answerCheckIn, snoozeCheckIn,
  getSessionDebriefs,
  getLatestPeriodicReport, savePeriodicReport,
  insertAnonymousAggregate,
  saveIntakeResponse, updateIntakeFollowUp, getIntakeResponses,
  saveBenchmarks, approveBenchmarks
};
