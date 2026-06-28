/**
 * newsletter.js — routes for Newsletter Earl.
 *
 * Admin endpoints are gated to the owner's Clerk account (requireOwner).
 * Cron endpoints are gated by a shared secret header (Railway Cron sends it).
 * Public subscribe/unsubscribe/webhook land in Milestone 3.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { extractUser, requireOwner } = require('../middleware/auth');
const store = require('../services/newsletter/store');
const { generateCandidates } = require('../services/newsletter');
const { regenerateSection } = require('../services/newsletter/write');
const { sendIssueToList } = require('../services/newsletter/send');
const { markUsed } = require('../services/newsletter/library');

// In-memory generation jobs (single dev instance). A job runs in the
// background after the request returns; the page polls its status.
const generationJobs = new Map();

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

/** Clean, keyword-aware slug from the story headline. */
function slugify(s) {
  return String(s || 'issue')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// Kick off generation in the background. Returns a jobId immediately; the
// page polls /admin/generate/status. Generation takes a couple minutes
// (GDELT spacing + writing + scoring), too long for one HTTP request.
router.post('/admin/generate', requireOwner, async (req, res) => {
  const jobId = crypto.randomUUID();
  const sendDate = req.body?.sendDate || nextSendDate();
  generationJobs.set(jobId, { status: 'running', stage: 'starting', startedAt: Date.now() });
  res.status(202).json({ jobId });

  (async () => {
    try {
      const { candidates, research } = await generateCandidates({
        count: 3,
        onProgress: (p) => {
          const j = generationJobs.get(jobId);
          if (j) { j.stage = p.stage; j.detail = p.detail; }
        },
      });
      if (!candidates.length) {
        generationJobs.set(jobId, { status: 'error', error: 'No qualifying stories found right now. Try again.' });
        return;
      }
      const run = await store.createRun({ sendDate, candidates, research });
      generationJobs.set(jobId, { status: 'done', runId: run.id });
    } catch (e) {
      generationJobs.set(jobId, { status: 'error', error: e.message });
    }
  })();
});

// Poll generation progress.
router.get('/admin/generate/status', requireOwner, (req, res) => {
  const job = generationJobs.get(req.query.jobId);
  res.json(job || { status: 'unknown' });
  // Clean up finished jobs shortly after they're read.
  if (job && (job.status === 'done' || job.status === 'error')) {
    setTimeout(() => generationJobs.delete(req.query.jobId), 30000);
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

// Send a candidate to the owner's own inbox to preview the real email.
// Does not create an issue, mark anything sent, or stamp rotation.
router.post('/admin/run/:id/test-send', requireOwner, async (req, res) => {
  try {
    const run = await store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'run not found' });
    const idx = Number.isInteger(req.body?.candidateIndex)
      ? req.body.candidateIndex
      : Number.isInteger(run.locked_index) ? run.locked_index : 0;
    const cand = run.candidates?.[idx];
    if (!cand) return res.status(422).json({ error: 'no candidate' });
    const iss = cand.issue || {};
    const story = cand.story || {};
    const fakeIssue = {
      id: 'test', slug: null, subject: iss.subject,
      section1: iss.section1, section2: iss.section2, section3: iss.section3,
      send_date: run.send_date,
    };
    const me = { email: req.dbUser.email, unsubscribe_token: 'test' };
    const result = await sendIssueToList({ issue: fakeIssue, sources: story.sources, resourceChosen: cand.resourceChosen, subscribers: [me] });
    res.json({ sent: result.sent, to: req.dbUser.email, error: result.error });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Past issues with their open/click stats.
router.get('/admin/issues', requireOwner, async (req, res) => {
  try {
    const issues = await store.listIssues({ limit: 60 });
    const stats = await store.getStatsForIssues(issues.map((i) => i.id));
    res.json({ issues: issues.map((i) => ({ ...i, stats: stats[i.id] || {} })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// One-time: subscribe every existing paid member to the newsletter.
router.post('/admin/backfill-members', requireOwner, async (req, res) => {
  try {
    const added = await store.backfillMembers();
    res.json({ added });
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

// Send day: take today's due run, finalize the locked (or leftmost) candidate
// into an issue, send to the list, stamp resource usage, mark the run sent.
router.post('/cron/send', requireCronSecret, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const run = await store.getDueRun(today);
    if (!run) return res.json({ status: 'nothing-due', date: today });

    const idx = Number.isInteger(run.locked_index) ? run.locked_index : 0;
    const cand = run.candidates?.[idx];
    if (!cand) return res.status(422).json({ error: 'no candidate to send' });

    const iss = cand.issue || {};
    const story = cand.story || {};
    const resource = cand.resourceChosen || null;
    const now = new Date();
    const publishAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // archive trails 7 days

    const issue = await store.createIssue({
      run_id: run.id,
      subject: iss.subject,
      section1: iss.section1,
      section2: iss.section2,
      section3: iss.section3,
      resource,
      principle: cand.principle,
      story: { headline: story.headline, categoryLabel: story.categoryLabel },
      sources: story.sources,
      score: cand.score,
      slug: `${slugify(story.headline || iss.subject)}-${today}`,
      send_date: today,
      sent_at: now.toISOString(),
      publish_at: publishAt.toISOString(),
      published: false,
    });

    // Stamp rotation only now, on send — not on the throwaway drafts.
    if (resource && resource.id) { try { markUsed(resource.id, now.toISOString()); } catch (_) {} }

    const subscribers = await store.getActiveSubscribers();
    const result = await sendIssueToList({ issue, sources: story.sources, resourceChosen: resource, subscribers });
    await store.markRunSent(run.id);

    res.json({ status: 'sent', issueId: issue.id, slug: issue.slug, recipients: result.sent, failed: result.failed });
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

// ---- Public ----

// Free signup (secondary CTA on the landing page).
router.post('/subscribe', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email.' });
    }
    await store.addSubscriber({ email, source: 'free' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Unsubscribe (link in every email). Flips the flag only; account untouched.
async function doUnsubscribe(req) {
  const token = req.query.token || req.body?.token;
  try { return await store.unsubscribeByToken(token); } catch { return null; }
}
router.get('/unsubscribe', async (req, res) => {
  const email = await doUnsubscribe(req);
  res
    .set('Content-Type', 'text/html')
    .send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
<body style="font-family:Georgia,serif;background:#f5f0e8;color:#1a1512;max-width:520px;margin:60px auto;padding:0 22px;text-align:center">
<h2 style="font-weight:600">You're unsubscribed.</h2>
<p style="line-height:1.6">${email ? escapeHtml(email) + ' will' : 'You will'} no longer receive Earl's newsletter. If you have a paid account, it is completely untouched.</p>
</body></html>`);
});
// One-click (List-Unsubscribe-Post) sends a POST to the same URL.
router.post('/unsubscribe', async (req, res) => {
  await doUnsubscribe(req);
  res.status(200).json({ ok: true });
});

// Resend webhook → record delivery/open/click/bounce/complaint per issue.
router.post('/webhook', async (req, res) => {
  try {
    const evt = req.body || {};
    const type = String(evt.type || '').replace(/^email\./, '');
    const allowed = ['delivered', 'opened', 'clicked', 'bounced', 'complained'];
    if (allowed.includes(type)) {
      const data = evt.data || {};
      const to = Array.isArray(data.to) ? data.to[0] : data.to;
      let issueId = null;
      const tags = data.tags;
      if (tags) {
        if (Array.isArray(tags)) issueId = tags.find((t) => t.name === 'issue_id')?.value || null;
        else if (typeof tags === 'object') issueId = tags.issue_id || null;
      }
      await store.recordEvent({ issueId, email: to, type });
    }
    res.json({ received: true });
  } catch (e) {
    // Never fail a webhook — Resend will retry and we don't want a loop.
    res.status(200).json({ received: true });
  }
});

module.exports = router;
