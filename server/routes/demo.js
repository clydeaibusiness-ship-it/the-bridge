/**
 * demo.js — sales-demo Earls.
 *
 * Owner endpoints (requireOwner) build, edit, publish, list, and delete demos.
 * Public endpoints (by token, no auth) let a prospect view their demo and chat
 * with the briefed Earl, bounded by a per-demo message cap.
 */

const express = require('express');
const router = express.Router();

const { extractUser, requireOwner } = require('../middleware/auth');
const store = require('../services/demo/store');
const { buildDraft, buildDemoContext } = require('../services/demo/generate');
const { commanderChat } = require('../services/claude');

router.use(extractUser);

// ---- Owner: build & manage ----

/** POST /api/demo — scrape + generate a draft demo, save it, return it. */
router.post('/', requireOwner, async (req, res) => {
  try {
    const { companyName, websiteUrl, facebookUrl, notes } = req.body || {};
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ error: 'Company name is required.' });
    }
    const draft = await buildDraft({
      companyName: companyName.trim(),
      websiteUrl: (websiteUrl || '').trim(),
      facebookUrl: (facebookUrl || '').trim(),
      notes: (notes || '').trim(),
    });
    const demo = await store.createDemo({
      company_name: companyName.trim(),
      website_url: (websiteUrl || '').trim() || null,
      facebook_url: (facebookUrl || '').trim() || null,
      notes: (notes || '').trim() || null,
      ...draft,
    });
    res.json({ demo });
  } catch (e) {
    console.error('[demo] create failed:', e.message);
    res.status(500).json({ error: 'Could not build the demo.' });
  }
});

/** PATCH /api/demo/:id — save owner edits to the draft. */
router.patch('/:id', requireOwner, async (req, res) => {
  try {
    const patch = {};
    const b = req.body || {};
    if (b.company_name !== undefined) patch.company_name = String(b.company_name).trim();
    if (b.business_context !== undefined) patch.business_context = b.business_context;
    if (b.chart_sections !== undefined) patch.chart_sections = b.chart_sections;
    if (b.first_read !== undefined) patch.first_read = String(b.first_read);
    if (b.notes !== undefined) patch.notes = String(b.notes);
    const demo = await store.updateDemo(req.params.id, patch);
    res.json({ demo });
  } catch (e) {
    console.error('[demo] patch failed:', e.message);
    res.status(500).json({ error: 'Could not save.' });
  }
});

/** POST /api/demo/:id/regenerate — re-scrape and regenerate from current inputs. */
router.post('/:id/regenerate', requireOwner, async (req, res) => {
  try {
    const demo = await store.getById(req.params.id);
    if (!demo) return res.status(404).json({ error: 'Not found' });
    const draft = await buildDraft({
      companyName: demo.company_name,
      websiteUrl: demo.website_url,
      facebookUrl: demo.facebook_url,
      notes: demo.notes,
    });
    const updated = await store.updateDemo(demo.id, draft);
    res.json({ demo: updated });
  } catch (e) {
    console.error('[demo] regenerate failed:', e.message);
    res.status(500).json({ error: 'Could not regenerate.' });
  }
});

/** POST /api/demo/:id/publish — go live, return the shareable link. */
router.post('/:id/publish', requireOwner, async (req, res) => {
  try {
    const demo = await store.updateDemo(req.params.id, { status: 'published' });
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ demo, url: `${base}/demo/${demo.token}` });
  } catch (e) {
    console.error('[demo] publish failed:', e.message);
    res.status(500).json({ error: 'Could not publish.' });
  }
});

/** GET /api/demo/list — all demos for the owner dashboard. */
router.get('/list', requireOwner, async (req, res) => {
  try {
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const demos = (await store.listDemos()).map((d) => ({ ...d, url: `${base}/demo/${d.token}` }));
    res.json({ demos });
  } catch (e) {
    res.json({ demos: [] });
  }
});

/** GET /api/demo/:id — full row, for the owner editor. */
router.get('/:id', requireOwner, async (req, res) => {
  const demo = await store.getById(req.params.id);
  if (!demo) return res.status(404).json({ error: 'Not found' });
  res.json({ demo });
});

/** DELETE /api/demo/:id */
router.delete('/:id', requireOwner, async (req, res) => {
  const ok = await store.deleteDemo(req.params.id);
  res.json({ ok });
});

// ---- Public: the prospect's view + chat ----

/** GET /api/demo/public/:token — what the prospect sees. No internals. */
router.get('/public/:token', async (req, res) => {
  try {
    const demo = await store.getPublicByToken(req.params.token);
    if (!demo) return res.status(404).json({ error: 'This demo is not available.' });
    res.json({
      demo: {
        companyName: demo.company_name,
        firstRead: demo.first_read || '',
        chartSections: Array.isArray(demo.chart_sections) ? demo.chart_sections : [],
        messagesLeft: Math.max(0, (demo.message_cap || 40) - (demo.messages_used || 0)),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the demo.' });
  }
});

/** POST /api/demo/public/:token/chat — chat with the briefed Earl. */
router.post('/public/:token/chat', async (req, res) => {
  try {
    const demo = await store.getPublicByToken(req.params.token);
    if (!demo) return res.status(404).json({ error: 'This demo is not available.' });

    const message = String((req.body && req.body.message) || '').trim();
    if (!message) return res.status(400).json({ error: 'Say something first.' });

    const bumped = await store.bumpMessageCount(demo);
    if (bumped === null) {
      return res.status(429).json({ error: 'This demo has reached its message limit.', messagesLeft: 0 });
    }

    // Sanitize the client-supplied history to alternating role/content turns.
    const raw = Array.isArray(req.body.history) ? req.body.history.slice(-20) : [];
    const history = raw
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }));

    const context = buildDemoContext(demo);
    // Briefed Earl: full soul + library via commanderChat, the demo context as
    // the business data block, NO member memory, NO persistence (persist:{}).
    const reply = await commanderChat(message, {}, context, history, null, null, {});

    res.json({ reply, messagesLeft: Math.max(0, (demo.message_cap || 40) - bumped) });
  } catch (e) {
    console.error('[demo] chat failed:', e.message);
    res.status(500).json({ error: 'Earl hit a snag.' });
  }
});

module.exports = router;
