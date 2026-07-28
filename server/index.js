require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const commanderRoutes = require('./routes/commander');
const newsletterRoutes = require('./routes/newsletter');

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_STARTED = new Date();

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://*.clerk.accounts.dev", "https://*.clerk.com", "https://*.captainsbridge.io"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://*.clerk.accounts.dev", "https://*.clerk.com", "https://*.captainsbridge.io"],
      imgSrc: ["'self'", "data:", "blob:", "https://*.clerk.accounts.dev", "https://img.clerk.com", "https://*.clerk.com", "https://*.captainsbridge.io"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://*.clerk.accounts.dev", "https://*.clerk.com", "https://*.captainsbridge.io"],
      connectSrc: ["'self'", "https://*.clerk.accounts.dev", "https://api.clerk.com", "https://*.clerk.dev", "https://*.clerk.com", "https://*.captainsbridge.io", "https://*.supabase.co"],
      frameSrc: ["'self'", "https://*.clerk.accounts.dev", "https://*.clerk.com", "https://*.captainsbridge.io"],
      workerSrc: ["'self'", "blob:"]
    }
  }
}));

app.use(cors());
app.use(cookieParser());

// Behind Railway's proxy — trust it so Clerk's handshake builds https URLs.
app.set('trust proxy', 1);

// Clerk handshake, app-wide. Must run before any auth gate so a signed-in
// member with a stale session cookie gets a fresh one instead of being
// bounced to login (the sign-in loop). No-op when Clerk isn't configured.
const { clerkPageMiddleware } = require('./middleware/auth');
app.use(clerkPageMiddleware);

// Stripe webhooks need raw body — must come before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));

// Parse JSON for everything else
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Block direct access to /system directory
app.use('/system', (req, res) => {
  res.status(403).send('Forbidden');
});



// Serve config.js from root (needed by frontend modules)
app.get('/config.js', (req, res) => {
  res.sendFile(path.join(__dirname, '../config.js'));
});



// Serve data files
app.use('/data', express.static(path.join(__dirname, '../public/data')));

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/commander', commanderRoutes);
app.use('/api/newsletter', newsletterRoutes);

// Auth + tier gate middleware for protected pages
const { extractUser } = require('./middleware/auth');
const { ensureMemberState } = require('./services/supabase');

async function requirePaidMember(req, res, next) {
  // Auth (and the Clerk handshake) was resolved upstream by clerkPageMiddleware.
  // extractUser just attaches the Supabase user. A missing req.dbUser here now
  // genuinely means signed-out, not a stale-cookie false negative — so we can
  // redirect without risking the sign-in loop.
  await new Promise((resolve) => extractUser(req, res, resolve));

  if (!req.dbUser) {
    // Not signed in. If Stripe just redirected here with session_id, the person
    // has paid but hasn't created their Clerk account yet. Look up their email
    // from Stripe and send them to Clerk sign-up with it pre-filled so the
    // pending activation fires the moment they create their account.
    const sessionId = req.query.session_id;
    if (sessionId && process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
        const email = stripeSession.customer_details?.email || stripeSession.customer_email || '';
        const isProd = req.hostname === 'captainsbridge.io' || req.hostname === 'www.captainsbridge.io';
        const clerkBase = isProd
          ? 'https://accounts.captainsbridge.io/sign-up'
          : 'https://obliging-python-5.accounts.dev/sign-up';
        const redirect = clerkBase + '?redirect_url=' + encodeURIComponent(req.protocol + '://' + req.get('host') + req.originalUrl) + (email ? '&email_address=' + encodeURIComponent(email) : '');
        return res.redirect(redirect);
      } catch (e) {
        console.error('Post-payment Stripe session lookup failed:', e.message);
      }
    }
    // Signed out. App routes get the app's own sign-in screen; everything else
    // keeps the marketing-side subscribe flow.
    const isAppRoute = req.path === '/app' || req.path === '/dashboard';
    return res.redirect(isAppRoute ? '/signin' : '/login?action=subscribe');
  }

  const tier = req.dbUser.membership_tier;
  if (tier !== 'ensign' && tier !== 'navigator' && tier !== 'captain') {
    return res.redirect('/subscribe');
  }

  next();
}

/**
 * Force a member who has not completed Stage 1 of the interview into /intake.
 * Runs after requirePaidMember (which populates req.dbUser when a valid cookie
 * exists). When req.dbUser is absent (no cookie yet) it lets the page load and
 * the client-side guard handles it once Clerk sets the cookie.
 */
async function requireInterviewStarted(req, res, next) {
  if (!req.dbUser) return next();
  try {
    const state = await ensureMemberState(req.dbUser.id);
    if (!state || !state.stage_1_complete) {
      return res.redirect('/intake');
    }
  } catch (e) {
    // On any error, don't block access.
  }
  next();
}

// Public pages — no gate
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/login.html'));
});

app.get('/subscribe', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/subscribe.html'));
});

// The app's own sign-in screen. Signing out of the installed app lands here
// rather than on the marketing site.
app.get('/signin', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/signin.html'));
});

// Clears the Clerk session client-side, then lands on /signin.
app.get('/signout', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/signout.html'));
});

// Post-purchase install-the-app offer. Paid members only, but NOT behind the
// interview gate — this is shown right after checkout, before the interview.
app.get('/welcome', requirePaidMember, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/welcome.html'));
});

// Protected pages — must be logged in + paid. The member pages below also
// require Stage 1 of the interview to be complete (else → /intake).
// The chat-first shell is now the default landing after login.
app.get('/dashboard', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/app.html'));
});

app.get('/app', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/app.html'));
});

// The interview: Stage 1 is free — any signed-in person can take it. The
// paywall lives at the Stage 1 → Stage 2 boundary (Earl's First Read + the
// door), enforced in the interview API.
app.get('/intake', async (req, res) => {
  await new Promise((resolve) => extractUser(req, res, resolve));
  if (!req.dbUser) return res.redirect('/login?return=/intake');
  res.sendFile(path.join(__dirname, '../pages/intake.html'));
});

app.get('/certificate', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/certificate.html'));
});

// The accountability friend opting out of the monthly note. Public, no login:
// they hold a signed link from the email. Clearing the friend frees the member
// to invite someone else.
app.get('/friend/opt-out', async (req, res) => {
  const page = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Georgia,serif;background:#f5f0e8;color:#1a1512;margin:0;">
<div style="max-width:460px;margin:0 auto;padding:64px 24px;text-align:center;">
<h2 style="font-size:22px;margin:0 0 12px;">${title}</h2>
<p style="font-size:15px;line-height:1.7;color:#6a5c4a;margin:0;">${body}</p>
</div></body></html>`;
  try {
    const { verifyFriendOptOut } = require('./services/replytoken');
    const userId = verifyFriendOptOut(req.query.t);
    if (!userId) {
      return res.status(400).set('Content-Type', 'text/html')
        .send(page('That link did not work', 'It may have been altered in transit. You can reply to the email instead and let them know.'));
    }
    const { updateMemberState } = require('./services/supabase');
    await updateMemberState(userId, {
      friend_name: null, friend_email: null, friend_from_name: null, friend_invited_at: null,
    });
    res.set('Content-Type', 'text/html').send(
      page('Done. No more notes.', 'You will not hear from Earl again. Nothing was shared about you, and your friend has not been told, though they will see they can invite someone else.')
    );
  } catch (e) {
    console.error('Friend opt-out error:', e.message);
    res.status(500).set('Content-Type', 'text/html')
      .send(page('Something went wrong', 'Try the link again in a moment.'));
  }
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/terms.html'));
});

app.get('/config-panel', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/config-panel.html'));
});

// Newsletter admin desk — Clerk-gated client-side; the API enforces owner-only.
app.get('/newsletter-admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/newsletter-admin.html'));
});

// OG image generator — opens in browser, click Download PNG, put in /public/assets/og-image.png
app.get('/og-generate', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/og-generate.html'));
});

// Public newsletter archive (server-rendered for SEO/AIO). Fully free, no wall.
app.get('/newsletter', async (req, res) => {
  try {
    const store = require('./services/newsletter/store');
    const { renderArchiveIndex } = require('./services/newsletter/archive');
    const issues = await store.listPublishedIssues({ limit: 200 });
    res.set('Content-Type', 'text/html').send(renderArchiveIndex(issues));
  } catch (e) {
    res.status(500).send('Archive unavailable.');
  }
});

app.get('/newsletter/:slug', async (req, res) => {
  try {
    const store = require('./services/newsletter/store');
    const { renderArchivePost } = require('./services/newsletter/archive');
    const issue = await store.getPublishedIssueBySlug(req.params.slug);
    if (!issue) {
      return res.status(404).set('Content-Type', 'text/html').send(
        `<div style="font-family:Georgia,serif;background:#f5f0e8;color:#1a1512;max-width:520px;margin:60px auto;text-align:center;padding:0 20px"><h2>Issue not found</h2><p><a href="/newsletter">Back to the archive →</a></p></div>`
      );
    }
    res.set('Content-Type', 'text/html').send(renderArchivePost(issue));
  } catch (e) {
    res.status(500).send('Issue unavailable.');
  }
});

// Sitemap + robots for the archive.
app.get('/sitemap.xml', async (req, res) => {
  try {
    const store = require('./services/newsletter/store');
    const base = process.env.PUBLIC_BASE_URL || 'https://captainsbridge.io';
    const issues = await store.listPublishedIssues({ limit: 500 });
    const urls = [`${base}/`, `${base}/newsletter`, ...issues.map((i) => `${base}/newsletter/${i.slug}`)];
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
      `\n</urlset>`;
    res.set('Content-Type', 'application/xml').send(xml);
  } catch (e) {
    res.status(500).send('');
  }
});

app.get('/robots.txt', (req, res) => {
  const base = process.env.PUBLIC_BASE_URL || 'https://captainsbridge.io';
  res.set('Content-Type', 'text/plain').send(`User-agent: *\nAllow: /\nDisallow: /newsletter-admin\n\nSitemap: ${base}/sitemap.xml\n`);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version
app.get('/api/version', (req, res) => {
  const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' };
  res.json({ version: SERVER_STARTED.toLocaleString('en-US', opts) });
});

// 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../pages/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`The Bridge is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  // Newsletter Earl's in-process scheduler (generate/send/purge on Central time).
  try {
    require('./services/newsletter/scheduler').start();
  } catch (e) {
    console.error('Newsletter scheduler failed to start:', e.message);
  }
  // Earl's memory worker (derive ended sessions, nightly profile reflection).
  try {
    require('./services/memory/worker').start();
  } catch (e) {
    console.error('Memory worker failed to start:', e.message);
  }
  // Earl reaching out first — proactive check-ins pushed to members' phones.
  try {
    require('./services/checkin-worker').start();
  } catch (e) {
    console.error('Check-in worker failed to start:', e.message);
  }
  // Warm the embedding model at boot so no member's first message waits on
  // the one-time model load. Retry a few times: if the first pull hiccups,
  // keep trying rather than leaving the model cold until a member triggers it.
  (async () => {
    const { embed } = require('./services/memory/embed');
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await embed('warmup');
        console.log('[memory] embedding model warm');
        return;
      } catch (e) {
        console.error(`[memory] embedding warmup attempt ${attempt} failed:`, e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    console.error('[memory] embedding warmup gave up; retrieval will warm lazily on first use');
  })();
});

module.exports = app;
