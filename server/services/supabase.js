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

module.exports = {
  getClient,
  createUser, getUserByClerkId, updateMembershipTier, updateStripeCustomerId,
  saveGameState, getGameState,
  saveRunHistory, getRunHistory,
  upsertAnonymousEvent, getWeeklyEvents,
  getCommanderUsage, incrementCommanderUsage
};
