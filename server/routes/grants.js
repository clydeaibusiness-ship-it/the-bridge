const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const { extractUser, requireAuth } = require('../middleware/auth');
const {
  getClient,
  getIntake, upsertIntake
} = require('../services/supabase');
const { scanGrants } = require('../services/grants');
const {
  sendAdminVerificationEmail,
  sendWinVerifiedEmail,
  sendWinRejectedEmail
} = require('../services/email');

// Multer for file uploads (memory storage, 10MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and PDF files are allowed'), false);
    }
  }
});

router.use(extractUser);

// Signing secret derived from service key
const SIGN_SECRET = process.env.SUPABASE_SERVICE_KEY
  ? crypto.createHash('sha256').update(process.env.SUPABASE_SERVICE_KEY).digest('hex').slice(0, 32)
  : 'fallback-secret-key';

function signToken(payload) {
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString('base64url');
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SIGN_SECRET).update(encoded).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    // Check 72hr expiry
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// ---- Grant Radar Acknowledgment ----

router.get('/acknowledgment-status', requireAuth, async (req, res) => {
  try {
    const db = getClient();
    if (!db) return res.json({ acknowledged: false });

    const { data, error } = await db
      .from('user_intake')
      .select('grant_radar_acknowledged')
      .eq('user_id', req.dbUser.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ acknowledged: !!(data && data.grant_radar_acknowledged) });
  } catch (e) {
    console.error('Acknowledgment status error:', e.message);
    res.json({ acknowledged: false });
  }
});

router.post('/acknowledge', requireAuth, async (req, res) => {
  try {
    const db = getClient();
    if (!db) return res.status(503).json({ error: 'Database not configured' });

    const { error } = await db
      .from('user_intake')
      .upsert({
        user_id: req.dbUser.id,
        grant_radar_acknowledged: true
      }, { onConflict: 'user_id' });

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error('Acknowledge error:', e.message);
    res.status(500).json({ error: 'Failed to save acknowledgment' });
  }
});

// ---- Community Total (PUBLIC — no auth) ----

let cachedTotal = null;
let cachedTotalAt = 0;

router.get('/community-total', async (req, res) => {
  try {
    const now = Date.now();
    // Cache for 1 hour
    if (cachedTotal !== null && (now - cachedTotalAt) < 3600000) {
      return res.json({ total: cachedTotal });
    }

    const db = getClient();
    if (!db) return res.json({ total: 0 });

    const table = process.env.TEST_MODE === 'true' ? 'grant_wins_test' : 'grant_wins';
    // Only use grant_wins for counter (never grant_wins_test in production)
    const { data, error } = await db
      .from('grant_wins')
      .select('amount_received');

    if (error) throw error;

    const total = (data || []).reduce((sum, row) => sum + (parseFloat(row.amount_received) || 0), 0);
    cachedTotal = total;
    cachedTotalAt = now;

    res.json({ total });
  } catch (e) {
    console.error('Community total error:', e.message);
    res.json({ total: 0 });
  }
});

// ---- Grant Radar Intake Check ----

router.get('/intake-status', requireAuth, async (req, res) => {
  try {
    const intake = await getIntake(req.dbUser.id);
    const complete = intake && intake.grant_intake_complete === true;
    res.json({
      complete,
      intake: complete ? {
        city: intake.city,
        state: intake.state,
        legalEntity: intake.legal_entity,
        granularRevenue: intake.granular_revenue,
        ownerDemographics: intake.owner_demographics,
        grantFundUse: intake.grant_fund_use,
        samRegistration: intake.sam_registration,
        naicsCode: intake.naics_code,
        nextScanDate: intake.next_scan_date
      } : null
    });
  } catch (e) {
    console.error('Intake status error:', e.message);
    res.status(500).json({ error: 'Failed to check intake status' });
  }
});

// ---- Save Grant Radar Intake ----

router.post('/intake', async (req, res) => {
  // Log auth state for debugging
  console.log('Grant intake POST - dbUser:', req.dbUser?.id || 'NONE', 'userId:', req.userId || 'NONE');
  
  if (!req.dbUser) {
    console.error('Grant intake: No authenticated user. Cookie:', !!req.cookies?.__session, 'Auth header:', !!req.headers.authorization);
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const { city, state, county, legalEntity, granularRevenue, ownerDemographics, grantFundUse, samRegistration, naicsCode } = req.body;

    const db = getClient();
    if (!db) return res.status(503).json({ error: 'Database not configured' });

    console.log('Grant intake: saving for user', req.dbUser.id);

    const { error } = await db
      .from('user_intake')
      .upsert({
        user_id: req.dbUser.id,
        city,
        state,
        county: county || null,
        legal_entity: legalEntity,
        granular_revenue: granularRevenue,
        owner_demographics: ownerDemographics || [],
        grant_fund_use: Array.isArray(grantFundUse) ? grantFundUse.join(', ') : grantFundUse,
        sam_registration: samRegistration,
        naics_code: naicsCode || null,
        grant_intake_complete: true,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Grant intake: Supabase error:', error.message, error.code);
      throw error;
    }
    console.log('Grant intake: saved successfully');
    res.json({ saved: true });
  } catch (e) {
    console.error('Grant intake save error:', e.message);
    res.status(500).json({ error: 'Failed to save intake' });
  }
});

// ---- Scan for Grants ----

router.post('/scan', requireAuth, async (req, res) => {
  try {
    const intake = await getIntake(req.dbUser.id);
    if (!intake || !intake.grant_intake_complete) {
      return res.status(400).json({ error: 'Complete the Grant Radar intake first' });
    }

    // Check manual scan cooldown (7 days)
    const db = getClient();
    const { data: lastScan } = await db
      .from('grant_radar_results')
      .select('scan_date')
      .eq('user_id', req.dbUser.id)
      .order('scan_date', { ascending: false })
      .limit(1);

    if (lastScan && lastScan.length > 0 && req.body.manual) {
      const lastDate = new Date(lastScan[0].scan_date);
      const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return res.status(429).json({
          error: 'Manual scan available in ' + Math.ceil(7 - daysSince) + ' days',
          nextManualScan: new Date(lastDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }

    // Run the grant search
    const results = await scanGrants(intake);

    // Store results
    const { error: insertError } = await db
      .from('grant_radar_results')
      .insert({
        user_id: req.dbUser.id,
        results_json: results,
        scan_date: new Date().toISOString()
      });

    if (insertError) console.error('Failed to store scan results:', insertError.message);

    // Update next scan date (30 days)
    const nextScan = new Date();
    nextScan.setDate(nextScan.getDate() + 30);

    await db
      .from('user_intake')
      .update({ next_scan_date: nextScan.toISOString() })
      .eq('user_id', req.dbUser.id);

    res.json({ results, scanDate: new Date().toISOString(), nextScanDate: nextScan.toISOString() });
  } catch (e) {
    console.error('Grant scan error:', e.message);
    res.status(500).json({ error: 'Grant scan failed. Please try again.' });
  }
});

// ---- Get Latest Results ----

router.get('/results', requireAuth, async (req, res) => {
  try {
    const db = getClient();
    if (!db) return res.json({ results: null });

    const { data, error } = await db
      .from('grant_radar_results')
      .select('*')
      .eq('user_id', req.dbUser.id)
      .order('scan_date', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({ results: null });
    }

    // Get intake for next_scan_date
    const intake = await getIntake(req.dbUser.id);

    res.json({
      results: data[0].results_json,
      scanDate: data[0].scan_date,
      nextScanDate: intake?.next_scan_date || null
    });
  } catch (e) {
    console.error('Get results error:', e.message);
    res.status(500).json({ error: 'Failed to load results' });
  }
});

// ---- Saved Grants ----

router.get('/saved', requireAuth, async (req, res) => {
  try {
    const db = getClient();
    const { data, error } = await db
      .from('saved_grants')
      .select('*')
      .eq('user_id', req.dbUser.id)
      .order('date_saved', { ascending: false });

    if (error) throw error;
    res.json({ saved: data || [] });
  } catch (e) {
    console.error('Get saved grants error:', e.message);
    res.json({ saved: [] });
  }
});

router.post('/save', requireAuth, async (req, res) => {
  try {
    const { grantName, grantUrl, grantDescription, grantAmount, jurisdiction, fullResult } = req.body;
    const db = getClient();

    // Check if already saved
    const { data: existing } = await db
      .from('saved_grants')
      .select('id')
      .eq('user_id', req.dbUser.id)
      .eq('grant_name', grantName)
      .limit(1);

    if (existing && existing.length > 0) {
      // Unsave
      await db.from('saved_grants').delete().eq('id', existing[0].id);
      return res.json({ saved: false });
    }

    // Save
    const { error } = await db
      .from('saved_grants')
      .insert({
        user_id: req.dbUser.id,
        grant_name: grantName,
        grant_url: grantUrl,
        grant_description: grantDescription,
        grant_amount: grantAmount,
        jurisdiction,
        full_result_json: fullResult
      });

    if (error) throw error;
    res.json({ saved: true });
  } catch (e) {
    console.error('Save grant error:', e.message);
    res.status(500).json({ error: 'Failed to save grant' });
  }
});

// ---- Application Tracking ----

router.post('/apply', requireAuth, async (req, res) => {
  try {
    const { grantName, grantUrl, grantAmountAvailable, dateApplied } = req.body;
    const db = getClient();

    const { data, error } = await db
      .from('grant_applications')
      .insert({
        user_id: req.dbUser.id,
        grant_name: grantName,
        grant_url: grantUrl,
        grant_amount_available: grantAmountAvailable,
        date_applied: dateApplied,
        status: 'applied'
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ application: data });
  } catch (e) {
    console.error('Apply error:', e.message);
    res.status(500).json({ error: 'Failed to record application' });
  }
});

router.get('/applications', requireAuth, async (req, res) => {
  try {
    const db = getClient();
    const { data, error } = await db
      .from('grant_applications')
      .select('*')
      .eq('user_id', req.dbUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ applications: data || [] });
  } catch (e) {
    console.error('Get applications error:', e.message);
    res.json({ applications: [] });
  }
});

// ---- Upload Verification Document ----

router.post('/upload', requireAuth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { applicationId } = req.body;
    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId required' });
    }

    const db = getClient();
    const filePath = `${req.dbUser.id}/${applicationId}/${req.file.originalname}`;

    const { error: uploadError } = await db.storage
      .from('grant-verification-documents')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Update the application with the file path
    await db
      .from('grant_applications')
      .update({ verification_image_url: filePath })
      .eq('id', applicationId)
      .eq('user_id', req.dbUser.id);

    res.json({ filePath, uploaded: true });
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ---- Claim Grant Win (Submit for Verification) ----

router.post('/claim', requireAuth, async (req, res) => {
  try {
    const { applicationId, amountReceived } = req.body;
    if (!applicationId || !amountReceived) {
      return res.status(400).json({ error: 'applicationId and amountReceived required' });
    }

    const db = getClient();

    // Get the application
    const { data: app, error: appError } = await db
      .from('grant_applications')
      .select('*')
      .eq('id', applicationId)
      .eq('user_id', req.dbUser.id)
      .single();

    if (appError || !app) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (!app.verification_image_url) {
      return res.status(400).json({ error: 'Upload a verification document first' });
    }

    // Update application
    const { error: updateError } = await db
      .from('grant_applications')
      .update({
        amount_received: amountReceived,
        status: 'pending_review',
        outcome: 'awarded'
      })
      .eq('id', applicationId);

    if (updateError) throw updateError;

    // Generate signed document URL (72hr expiry)
    const { data: signedUrl } = await db.storage
      .from('grant-verification-documents')
      .createSignedUrl(app.verification_image_url, 72 * 60 * 60);

    // Generate admin action tokens (72hr expiry)
    const tokenPayload = {
      applicationId,
      userId: req.dbUser.id,
      exp: Date.now() + 72 * 60 * 60 * 1000
    };
    const approveToken = signToken({ ...tokenPayload, action: 'approve' });
    const rejectToken = signToken({ ...tokenPayload, action: 'reject' });

    // Get user info for email
    const { data: user } = await db
      .from('users')
      .select('email')
      .eq('id', req.dbUser.id)
      .single();

    // Get business name from intake
    const intake = await getIntake(req.dbUser.id);
    const businessName = intake?.business_name || 'A Bridge member';

    // Send admin email
    const baseUrl = process.env.BASE_URL || 'https://captainsbridge.io';
    await sendAdminVerificationEmail({
      adminEmail: process.env.ADMIN_EMAIL || 's.barton.ok@gmail.com',
      businessName,
      grantName: app.grant_name,
      amountClaimed: amountReceived,
      documentUrl: signedUrl?.signedUrl || '',
      approveUrl: `${baseUrl}/api/admin/grant-verify?token=${approveToken}`,
      rejectUrl: `${baseUrl}/api/admin/grant-verify?token=${rejectToken}`
    });

    res.json({ status: 'pending_review' });
  } catch (e) {
    console.error('Claim error:', e.message);
    res.status(500).json({ error: 'Failed to submit claim' });
  }
});

// ---- Admin Verify/Reject (from email link) ----

router.get('/grant-verify', async (req, res) => {
  // Redirect GET to a simple confirmation page
  const { token } = req.query;
  if (!token) return res.status(400).send('Invalid link');

  const payload = verifyToken(token);
  if (!payload) return res.status(403).send('This link has expired or is invalid.');

  const action = payload.action === 'approve' ? 'Approve' : 'Reject';
  const color = payload.action === 'approve' ? '#5a8a6a' : '#8a3a3a';

  res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${action} Grant Win — The Bridge</title>
    <style>body{font-family:'Space Grotesk',sans-serif;background:#f5f0e8;color:#0a0a0f;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}
    .card{max-width:400px;text-align:center;}.btn{display:inline-block;background:${color};color:#f0ebe0;padding:14px 32px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;border-radius:2px;border:none;cursor:pointer;}
    </style></head><body><div class="card">
    <h2>${action} this grant win?</h2>
    <p>This action cannot be undone.</p>
    <form method="POST" action="/api/admin/grant-verify">
      <input type="hidden" name="token" value="${token}">
      <button type="submit" class="btn">${action} this win</button>
    </form>
    </div></body></html>
  `);
});

router.post('/grant-verify', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { token } = req.body || req.query;
    if (!token) return res.status(400).send('Missing token');

    const payload = verifyToken(token);
    if (!payload) return res.status(403).send('This link has expired or is invalid.');

    const { applicationId, userId, action } = payload;
    const db = getClient();

    if (action === 'approve') {
      // Get application details
      const { data: app } = await db
        .from('grant_applications')
        .select('*')
        .eq('id', applicationId)
        .single();

      if (!app) return res.status(404).send('Application not found');

      // Update application
      await db
        .from('grant_applications')
        .update({ verified: true, status: 'verified' })
        .eq('id', applicationId);

      // Determine target table
      const winsTable = process.env.TEST_MODE === 'true' ? 'grant_wins_test' : 'grant_wins';

      // Write to grant_wins
      await db
        .from(winsTable)
        .insert({
          user_id: userId,
          grant_name: app.grant_name,
          amount_received: app.amount_received,
          jurisdiction: null // Will be set from saved grant data if available
        });

      // Invalidate counter cache
      cachedTotal = null;
      cachedTotalAt = 0;

      // Send member confirmation email
      const { data: user } = await db
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

      if (user?.email) {
        await sendWinVerifiedEmail(user.email);
      }

      res.send(`
        <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Win Approved — The Bridge</title>
        <style>body{font-family:'Space Grotesk',sans-serif;background:#f5f0e8;color:#0a0a0f;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}</style>
        </head><body><div style="text-align:center;max-width:400px;">
        <h2 style="color:#5a8a6a;">✓ Win Approved</h2>
        <p>The grant win has been verified and added to the community counter. The member has been notified.</p>
        </div></body></html>
      `);
    } else {
      // Reject
      await db
        .from('grant_applications')
        .update({ status: 'rejected' })
        .eq('id', applicationId);

      // Send rejection email
      const { data: user } = await db
        .from('users')
        .select('email')
        .eq('id', userId)
        .single();

      if (user?.email) {
        await sendWinRejectedEmail(user.email);
      }

      res.send(`
        <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Submission Rejected — The Bridge</title>
        <style>body{font-family:'Space Grotesk',sans-serif;background:#f5f0e8;color:#0a0a0f;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}</style>
        </head><body><div style="text-align:center;max-width:400px;">
        <h2>Submission Rejected</h2>
        <p>The member has been notified with instructions to resubmit.</p>
        </div></body></html>
      `);
    }
  } catch (e) {
    console.error('Admin verify error:', e.message);
    res.status(500).send('Something went wrong. Please try the link again.');
  }
});

module.exports = router;
