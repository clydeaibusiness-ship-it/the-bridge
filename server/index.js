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
        const redirect = clerkBase + '?redirect_url=' + encodeURIComponent(req.protocol + '://' + req.get('host') + '/dashboard') + (email ? '&email_address=' + encodeURIComponent(email) : '');
        return res.redirect(redirect);
      } catch (e) {
        console.error('Post-payment Stripe session lookup failed:', e.message);
      }
    }
    return res.redirect('/login?action=subscribe');
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

// Protected pages — must be logged in + paid. The member pages below also
// require Stage 1 of the interview to be complete (else → /intake).
// The chat-first shell is now the default landing after login.
app.get('/dashboard', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/app.html'));
});

app.get('/app', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/app.html'));
});

app.get('/intake', requirePaidMember, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/intake.html'));
});

app.get('/certificate', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/certificate.html'));
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
  // Warm the embedding model at boot so no member's first message ever
  // waits on the one-time model download after a deploy.
  require('./services/memory/embed').embed('warmup')
    .then(() => console.log('[memory] embedding model warm'))
    .catch((e) => console.error('[memory] embedding warmup failed:', e.message));
});

module.exports = app;
