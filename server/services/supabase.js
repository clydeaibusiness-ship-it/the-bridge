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

// ---- Game State ----

async function saveGameState(userId, state) {
  const db = getClient();
  if (!db) return null;

  const record = {
    user_id: userId,
    ship_name: state.shipName,
    destination_name: state.destinationName,
    flavor_text: state.flavorText,
    current_sector: state.sector || 1,
    passenger_count: state.passengerCount || 0,
    lever_config: state.levers,
    momentum: state.stats?.momentum,
    resilience: state.stats?.resilience,
    clarity: state.stats?.clarity,
    run_number: state.runNumber || 1,
    last_saved: new Date().toISOString()
  };

  // Upsert — update if exists for this user
  const { data, error } = await db
    .from('game_state')
    .upsert(record, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getGameState(userId) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('game_state')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// ---- Run History ----

async function saveRunHistory(userId, run) {
  const db = getClient();
  if (!db) return null;

  const { data, error } = await db
    .from('run_history')
    .insert({
      user_id: userId,
      run_number: run.runNumber,
      threat_log: run.threatLog,
      lever_decisions: run.leverDecisions,
      final_momentum: run.finalStats?.momentum,
      final_resilience: run.finalStats?.resilience,
      final_clarity: run.finalStats?.clarity,
      killing_threat: run.killingThreat,
      debrief_text: run.debriefText
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getRunHistory(userId) {
  const db = getClient();
  if (!db) return [];

  const { data, error } = await db
    .from('run_history')
    .select('*')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false });

  if (error) throw error;
  return data || [];
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
  if (answers._simulatorResources) record.simulator_resources = answers._simulatorResources;

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

module.exports = {
  getClient,
  createUser, getUserByClerkId, updateMembershipTier, updateStripeCustomerId,
  saveGameState, getGameState,
  saveRunHistory, getRunHistory,
  upsertAnonymousEvent, getWeeklyEvents,
  getCommanderUsage, incrementCommanderUsage,
  saveCommanderMessage, getCommanderHistory, getLatestCommanderSessionId,
  getCommanderMessagesForApi,
  saveCommanderSummary, getLatestCommanderSummary,
  upsertIntake, getIntake,
  getCommanderSessionMessages, saveSessionNote, getSessionNotes, sessionNoteExists
};
