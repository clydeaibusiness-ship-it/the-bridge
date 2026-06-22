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

const app = express();
const PORT = process.env.PORT || 3000;

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

// Auth + tier gate middleware for protected pages
const { extractUser } = require('./middleware/auth');
const { ensureMemberState } = require('./services/supabase');

async function requirePaidMember(req, res, next) {
  // Check if there's a session cookie — if not, serve the page
  // and let Clerk JS handle auth client-side (sets the cookie)
  const token = req.cookies?.__session || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    // No cookie yet — serve the page so Clerk JS can initialize
    // The page's client-side JS will redirect to /login if needed
    return next();
  }

  // Cookie exists — verify and check tier
  await new Promise((resolve) => extractUser(req, res, resolve));
  
  if (!req.dbUser) {
    // Cookie invalid/expired — let page load, Clerk JS will handle
    return next();
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

app.get('/navigation-chart', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/navigation-chart.html'));
});

app.get('/progress', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/progress.html'));
});

// Profile is now a modal inside the app shell — redirect the old page.
app.get('/profile', (req, res) => res.redirect('/app'));

app.get('/certificate', requirePaidMember, requireInterviewStarted, (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/certificate.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/terms.html'));
});

app.get('/config-panel', (req, res) => {
  res.sendFile(path.join(__dirname, '../pages/config-panel.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
});

module.exports = app;
