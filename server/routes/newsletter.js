/**
 * newsletter.js — routes for Newsletter Earl.
 *
 * Admin endpoints are gated to the owner's Clerk account (requireOwner).
 * Cron endpoints are gated by a shared secret header (Railway Cron sends it).
 * Public subscribe/unsubscribe/webhook land in Milestone 3.
 */

const express = require('express');
const router = express.Router();

const { extractUser, requireOwner } = require('../middleware/auth');
const store = require('../services/newsletter/store');
const { generateCandidates } = require('../services/newsletter');
const { regenerateSection } = require('../services/newsletter/write');

router.use(extractUser);

// ---- helpers ----

function requireCronSecret(req, res, next) {
  const secret = process.env.NEWSLETTER_CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

/** Next Mon/Wed/Fri strictly after the given date, as YYYY-MM-DD. */
function nextSendDate(from = new Date()) {
  const d = new Date(from);
  const SEND_DAYS = new Set([1, 3, 5]); // Mon, Wed, Fri
  do {
    d.setDate(d.getDate() + 1);
  } while (!SEND_DAYS.has(d.getDay()));
  return d.toISOString().slice(0, 10);
}

// ---- Admin (owner only) ----

// The current draft (what the carousel shows). Null if none generated yet.
router.get('/admin/run', requireOwner, async (req, res) => {
  try {
    const run = await store.getLatestDraft();
    res.json({ run });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate a fresh run of three candidates now.
router.post('/admin/generate', requireOwner, async (req, res) => {
  try {
    const sendDate = req.body?.sendDate || nextSendDate();
    const { candidates, research } = await generateCandidates({ count: 3 });
    if (!candidates.length) {
      return res.status(422).json({ error: 'No qualifying stories found', research });
    }
    const run = await store.createRun({ sendDate, candidates, research });
    res.json({ run });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save edits and/or the locked-in candidate index.
router.patch('/admin/run/:id', requireOwner, async (req, res) => {
  try {
    const patch = {};
    if (Array.isArray(req.body?.candidates)) patch.candidates = req.body.candidates;
    if (Number.isInteger(req.body?.lockedIndex)) patch.locked_index = req.body.lockedIndex;
    if (req.body?.lockedIndex === null) patch.locked_index = null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
    const run = await store.updateRun(req.params.id, patch);
    res.json({ run });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Per-box reload: rewrite one section of one candidate from its own story.
router.post('/admin/run/:id/reload', requireOwner, async (req, res) => {
  try {
    const { candidateIndex, section } = req.body || {};
    if (!Number.isInteger(candidateIndex) || ![1, 2, 3].includes(Number(section))) {
      return res.status(400).json({ error: 'candidateIndex and section (1|2|3) required' });
    }
    const run = await store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    const cand = run.candidates?.[candidateIndex];
    if (!cand) return res.status(404).json({ error: 'candidate not found' });

    const { text, resourceId } = await regenerateSection({
      story: cand.story,
      principle: cand.principle,
      resources: cand.resources,
      section: Number(section),
    });

    cand.issue[`section${section}`] = text;
    if (Number(section) === 2 && resourceId) {
      cand.issue.resourceId = resourceId;
      cand.resourceChosen = (cand.resources || []).find((r) => r.id === resourceId) || cand.resourceChosen;
    }
    const updated = await store.updateRun(req.params.id, { candidates: run.candidates });
    res.json({ text, resourceId, run: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Past issues + (later) their open/click stats.
router.get('/admin/issues', requireOwner, async (req, res) => {
  try {
    const issues = await store.listIssues({ limit: 60 });
    res.json({ issues });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Cron (shared-secret) ----

// Evening-before generation: build the run for the next send date if absent.
router.post('/cron/generate', requireCronSecret, async (req, res) => {
  try {
    const sendDate = nextSendDate();
    const existing = await store.getDraftForSendDate(sendDate);
    if (existing) return res.json({ status: 'exists', runId: existing.id, sendDate });
    const { candidates, research } = await generateCandidates({ count: 3 });
    if (!candidates.length) return res.status(422).json({ error: 'no qualifying stories', research });
    const run = await store.createRun({ sendDate, candidates, research });
    res.json({ status: 'generated', runId: run.id, sendDate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Daily housekeeping: purge research older than 15 days.
router.post('/cron/purge', requireCronSecret, async (req, res) => {
  try {
    const purged = await store.purgeExpiredRuns();
    res.json({ status: 'ok', purged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
