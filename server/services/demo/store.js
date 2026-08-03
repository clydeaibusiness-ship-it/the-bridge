/**
 * demo/store.js — Supabase persistence for sales-demo Earls.
 * One table (demos). Owner creates a draft, edits it, publishes it to a public
 * token, and can delete it. Public reads go by token and only when published
 * and unexpired.
 */

const crypto = require('crypto');
const { getClient } = require('../supabase');

/** Short, URL-safe, unguessable token. */
function mintToken() {
  return crypto.randomBytes(9).toString('base64url'); // ~12 chars
}

async function createDemo(row) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('demos')
    .insert({ token: mintToken(), ...row })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getById(id) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from('demos').select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

/** Public read: published, unexpired demo by token. */
async function getPublicByToken(token) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from('demos')
    .select('*')
    .eq('token', token)
    .eq('status', 'published')
    .limit(1);
  if (error || !data?.length) return null;
  const demo = data[0];
  if (demo.expires_at && new Date(demo.expires_at) < new Date()) return null;
  return demo;
}

async function updateDemo(id, patch) {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db.from('demos').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function listDemos({ limit = 50 } = {}) {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from('demos')
    .select('id, token, company_name, status, messages_used, message_cap, created_at, expires_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data;
}

async function deleteDemo(id) {
  const db = getClient();
  if (!db) return false;
  const { error } = await db.from('demos').delete().eq('id', id);
  return !error;
}

/** Atomic-ish message-cap increment. Returns the new count, or null if capped. */
async function bumpMessageCount(demo) {
  const db = getClient();
  if (!db) return null;
  if ((demo.messages_used || 0) >= (demo.message_cap || 40)) return null;
  const next = (demo.messages_used || 0) + 1;
  await db.from('demos').update({ messages_used: next }).eq('id', demo.id);
  return next;
}

module.exports = {
  mintToken, createDemo, getById, getPublicByToken,
  updateDemo, listDemos, deleteDemo, bumpMessageCount,
};
