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
const { buildMemberProfile } = require('../services/grant-scoring');
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

// ---- Preview Scan (PUBLIC — no auth, landing page hero) ----

const previewScanCache = new Map(); // key: industry+state -> { result, cachedAt }

router.post('/preview-scan', async (req, res) => {
  try {
    const { industry, state, revenue_range, entity_type, fund_use, business_description } = req.body;
    if (!industry || !state) {
      return res.json({ match_count: 0, average_award: '$0', has_results: false });
    }

    const descKey = (business_description || '').toLowerCase().trim().substring(0, 50);
    const cacheKey = `${industry}::${state}::${entity_type || ''}::${descKey}`.toLowerCase();
    const cached = previewScanCache.get(cacheKey);
    if (cached && (Date.now() - cached.cachedAt < 3600000)) {
      return res.json(cached.result);
    }

    // Query Grants.gov API — grants only, filter by entity type eligibility
    // Eligibility codes: 23=small biz, 22=for-profit, 12=501c3, 13=non-501c3 nonprofit, 99=unrestricted
    let eligCodes = '23|22|99';  // default: small business + for-profit + unrestricted

    const et = (entity_type || '').toLowerCase();
    if (et.includes('nonprofit 501c3')) {
      eligCodes = '12|99';  // 501c3 nonprofits + unrestricted
    } else if (et.includes('nonprofit other')) {
      eligCodes = '13|99';  // non-501c3 nonprofits + unrestricted
    } else if (et === 'sole proprietorship' || et === 'not yet registered' || et === 'i am not sure') {
      eligCodes = '23|99';  // small business + unrestricted only (excludes formal entity requirements)
    } else if (et === 'c-corporation') {
      eligCodes = '22|23|99';  // for-profit + small biz + unrestricted
    }

    // Also use nonprofit eligibility if the industry is nonprofit regardless of entity selection
    if (industry.toLowerCase().includes('nonprofit') && !et.includes('nonprofit')) {
      eligCodes = '12|13|99';
    }

    // Build keyword from industry + business description for more targeted results
    let keyword = industry.replace(/ and /g, ' ');
    if (business_description && business_description.trim()) {
      keyword = business_description.trim() + ' ' + keyword;
    }

    const searchPayload = {
      keyword,
      oppStatuses: 'forecasted|posted',
      fundingInstruments: 'G',
      eligibilities: eligCodes,
      rows: 100,
      sortBy: 'openDate|desc'
    };

    let matchCount = 0;
    let avgFormatted = '$0';

    // Define which eligibility codes each entity type requires to be present
    const nonprofitCodes = new Set(['12', '13']);
    const smallBizCodes = new Set(['23']);
    const forProfitCodes = new Set(['22', '23']);
    const govOnlyCodes = new Set(['00', '01', '02', '06', '07', '08', '20', '21', '25']);

    function grantMatchesEntityType(grantEligibilities, entityType) {
      // grantEligibilities is a string like "12|23|99" or an object — normalize to a Set of code strings
      let codes;
      if (typeof grantEligibilities === 'string') {
        codes = new Set(grantEligibilities.split('|').map(c => c.trim()));
      } else if (Array.isArray(grantEligibilities)) {
        codes = new Set(grantEligibilities.map(c => String(c).trim()));
      } else {
        // If we can't parse eligibilities, include the grant (don't exclude on bad data)
        return true;
      }

      // Unrestricted (99) always passes
      if (codes.has('99')) return true;

      const etLower = (entityType || '').toLowerCase();

      if (etLower.includes('nonprofit 501c3') || etLower.includes('nonprofit other')) {
        // Keep only if grant has a nonprofit code (12 or 13)
        for (const c of codes) {
          if (nonprofitCodes.has(c)) return true;
        }
        return false;
      }

      if (etLower === 'sole proprietorship' || etLower === 'not yet registered' || etLower === 'i am not sure') {
        // Keep only if grant has small business code (23)
        return codes.has('23');
      }

      if (etLower === 'llc' || etLower === 's-corporation' || etLower === 'c-corporation') {
        // Keep only if grant has for-profit (22) or small biz (23)
        for (const c of codes) {
          if (forProfitCodes.has(c)) return true;
        }
        return false;
      }

      // Unknown entity type — include the grant
      return true;
    }

    try {
      const resp = await fetch('https://apply07.grants.gov/grantsws/rest/opportunities/search/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload),
        signal: AbortSignal.timeout(8000)
      });

      if (resp.ok) {
        const data = await resp.json();
        const allHits = data.oppHits || [];

        // Post-filter: only keep grants where entity type genuinely matches
        const filtered = allHits.filter(grant => {
          const grantElig = grant.eligibilities || grant.eligibility || '';
          return grantMatchesEntityType(grantElig, entity_type);
        });

        matchCount = filtered.length;

        // Calculate average award from filtered results if award amounts are available
        if (matchCount > 0) {
          const awards = filtered
            .map(g => parseFloat(g.awardCeiling || g.estimatedFunding || 0))
            .filter(a => a > 0);
          if (awards.length > 0) {
            const avg = awards.reduce((sum, a) => sum + a, 0) / awards.length;
            if (avg >= 1000) {
              avgFormatted = '$' + Math.round(avg).toLocaleString('en-US');
            } else {
              // Fallback to industry estimate if award data is too low / missing
              const awardEstimates = {
                'Agriculture and farming': '$150,000',
                'Software and technology': '$250,000',
                'Manufacturing': '$200,000',
                'Nonprofit organization': '$100,000',
                'Healthcare and therapy': '$175,000',
                'Education and tutoring': '$125,000',
                'Construction and renovation': '$150,000'
              };
              avgFormatted = awardEstimates[industry] || '$100,000';
            }
          } else {
            // No award data in results — use industry estimates
            const awardEstimates = {
              'Agriculture and farming': '$150,000',
              'Software and technology': '$250,000',
              'Manufacturing': '$200,000',
              'Nonprofit organization': '$100,000',
              'Healthcare and therapy': '$175,000',
              'Education and tutoring': '$125,000',
              'Construction and renovation': '$150,000'
            };
            avgFormatted = awardEstimates[industry] || '$100,000';
          }
        }
      }
    } catch (fetchErr) {
      console.error('Grants.gov API error:', fetchErr.message);
      matchCount = 0;
    }

    const result = {
      match_count: matchCount,
      average_award: avgFormatted,
      has_results: matchCount > 0
    };

    previewScanCache.set(cacheKey, { result, cachedAt: Date.now() });
    res.json(result);
  } catch (e) {
    console.error('Preview scan error:', e.message);
    res.json({ match_count: 0, average_award: '$0', has_results: false });
  }
});

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

let cachedAvailable = null;
let cachedAvailableAt = 0;

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

// ---- Total Available Funding Identified (PUBLIC — no auth) ----

function parseGrantAmount(amountStr) {
  if (!amountStr || typeof amountStr !== 'string') return 0;
  const lower = amountStr.toLowerCase();
  if (lower === 'varies' || lower === 'variable' || lower === 'n/a') return 0;

  // Extract the largest number from strings like "Up to $500,000" or "$10,000 - $50,000"
  const matches = amountStr.match(/[\d,]+\.?\d*/g);
  if (!matches || matches.length === 0) return 0;

  // Take the largest number found
  let max = 0;
  for (const m of matches) {
    const val = parseFloat(m.replace(/,/g, ''));
    if (!isNaN(val) && val > max) max = val;
  }

  // Check for million/billion suffixes
  if (/million/i.test(amountStr)) max *= 1000000;
  if (/billion/i.test(amountStr)) max *= 1000000000;

  return max;
}

router.get('/total-available', async (req, res) => {
  try {
    const now = Date.now();
    // Cache for 1 hour
    if (cachedAvailable !== null && (now - cachedAvailableAt) < 3600000) {
      return res.json({ total: cachedAvailable });
    }

    const db = getClient();
    if (!db) return res.json({ total: 0 });

    const { data, error } = await db
      .from('grant_radar_results')
      .select('results_json');

    if (error) throw error;

    // Deduplicate grants by name across all scans, sum unique amounts
    const seenGrants = new Map(); // grant name -> parsed amount

    for (const row of (data || [])) {
      const results = row.results_json;
      if (!results) continue;

      // results_json has { federal: [...], state: [...], local: [...] }
      const allGrants = [
        ...(results.federal || []),
        ...(results.state || []),
        ...(results.local || [])
      ];

      for (const grant of allGrants) {
        if (!grant.name) continue;
        const key = grant.name.toLowerCase().trim();
        if (!seenGrants.has(key)) {
          seenGrants.set(key, parseGrantAmount(grant.amount));
        }
      }
    }

    let total = 0;
    for (const amount of seenGrants.values()) {
      total += amount;
    }

    cachedAvailable = total;
    cachedAvailableAt = now;

    res.json({ total });
  } catch (e) {
    console.error('Total available error:', e.message);
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
        county: intake.county,
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

// In-memory scan status tracking
const activeScanUsers = new Map(); // userId -> { status: 'scanning'|'done'|'error', startedAt }

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

    // Profile-updated scans bypass the cooldown — member changed their intake
    if (lastScan && lastScan.length > 0 && req.body.manual && !req.body.profileUpdated) {
      const lastDate = new Date(lastScan[0].scan_date);
      const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return res.status(429).json({
          error: 'Manual scan available in ' + Math.ceil(7 - daysSince) + ' days',
          nextManualScan: new Date(lastDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }

    // If a scan is already running for this user, don't start another
    const existing = activeScanUsers.get(req.dbUser.id);
    if (existing && existing.status === 'scanning' && (Date.now() - existing.startedAt < 120000)) {
      return res.json({ status: 'scanning' });
    }

    // Mark scan as started and respond immediately
    activeScanUsers.set(req.dbUser.id, { status: 'scanning', startedAt: Date.now() });
    res.json({ status: 'scanning' });

    // Run scan in background (no await — response already sent)
    (async () => {
      try {
        // Load grant radar intake if it exists
        let grantRadarIntake = null;
        try {
          const { data: griData } = await db
            .from('grant_radar_intake')
            .select('*')
            .eq('user_id', req.dbUser.id)
            .single();
          grantRadarIntake = griData;
        } catch (e) { /* table may not exist yet */ }

        // Run the grant search with scoring
        const results = await scanGrants(intake, grantRadarIntake);

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

        activeScanUsers.set(req.dbUser.id, { status: 'done', startedAt: Date.now() });
        console.log('Background scan complete for user:', req.dbUser.id);
      } catch (e) {
        console.error('Background scan error:', e.message);
        activeScanUsers.set(req.dbUser.id, { status: 'error', startedAt: Date.now() });
      }
    })();
  } catch (e) {
    console.error('Grant scan error:', e.message);
    res.status(500).json({ error: 'Grant scan failed. Please try again.' });
  }
});

// ---- Scan Status (for polling) ----
router.get('/scan-status', requireAuth, async (req, res) => {
  const status = activeScanUsers.get(req.dbUser.id);
  if (!status || status.status !== 'scanning') {
    // Not scanning — check if results exist
    const db = getClient();
    const { data } = await db
      .from('grant_radar_results')
      .select('scan_date')
      .eq('user_id', req.dbUser.id)
      .order('scan_date', { ascending: false })
      .limit(1);
    res.json({ status: 'ready', hasResults: !!(data && data.length > 0) });
  } else {
    res.json({ status: 'scanning' });
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

// ---- Full Grant Radar Intake (new 20-45 question form) ----

router.get('/intake-full-status', requireAuth, async (req, res) => {
  try {
    const db = getClient();
    if (!db) return res.json({ intake: null });

    const { data, error } = await db
      .from('grant_radar_intake')
      .select('*')
      .eq('user_id', req.dbUser.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return res.json({ intake: null });

    // Map DB columns to question IDs
    const intake = {};
    const colMap = {
      q1: 'q1_legal_name', q2: 'q2_has_ein', q3: 'q3_sam_registered',
      q4: 'q4_street_address', q5: 'q5_business_description', q6: 'q6_problem_solved',
      q7: 'q7_primary_fund_use', q8: 'q8_annual_revenue', q9: 'q9_employee_count',
      q10: 'q10_years_operating', q11: 'q11_legal_structure', q12: 'q12_owner_demographics',
      q13: 'q13_separate_bank_account', q14: 'q14_filed_tax_returns', q15: 'q15_business_plan',
      q16: 'q16_short_term_goals', q17: 'q17_success_metrics', q18: 'q18_prior_grants',
      q18_detail: 'q18_prior_grants_detail', q19: 'q19_current_gov_funding', q20: 'q20_naics_code',
      q21: 'q21_conducts_rd', q22: 'q22_has_ip', q23: 'q23_university_partnerships',
      q24: 'q24_professional_licenses', q24_detail: 'q24_licenses_detail', q25: 'q25_facility',
      q26: 'q26_equipment_value', q27: 'q27_mission_statement', q28: 'q28_population_served',
      q29: 'q29_has_board', q30: 'q30_annual_budget', q30a: 'community_service_programs',
      q4_city: 'city', q4_state: 'state', q4_county: 'county',
      q31: 'q31_area_population',
      q32: 'q32_creates_local_jobs', q33: 'q33_currently_exports', q34: 'q34_target_markets',
      q35: 'q35_training_employee_count', q36: 'q36_training_skills', q37: 'q37_additional_info'
    };
    for (const [qId, col] of Object.entries(colMap)) {
      intake[qId] = data[col];
    }
    res.json({ intake, completedAt: data.completed_at });
  } catch (e) {
    console.error('Full intake status error:', e.message);
    res.json({ intake: null });
  }
});

router.post('/intake-full', requireAuth, async (req, res) => {
  try {
    const { answers, isEdit } = req.body;
    if (!answers) return res.status(400).json({ error: 'Answers required' });

    const db = getClient();
    if (!db) return res.status(503).json({ error: 'Database not configured' });

    // Parse state abbreviation from full name
    const STATE_ABBREVS = {'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'};
    const cityVal = answers.q4_city || null;
    const stateFullName = answers.q4_state || null;
    const stateAbbrev = stateFullName ? (STATE_ABBREVS[stateFullName] || stateFullName) : null;
    const countyVal = answers.q4_county || null;

    const record = {
      user_id: req.dbUser.id,
      q1_legal_name: answers.q1 || null,
      q2_has_ein: answers.q2 || null,
      q3_sam_registered: answers.q3 || null,
      q4_street_address: answers.q4 || null,
      q5_business_description: answers.q5 || null,
      q6_problem_solved: answers.q6 || null,
      q7_primary_fund_use: answers.q7 || null,
      q8_annual_revenue: answers.q8 != null ? parseInt(answers.q8, 10) : null,
      q9_employee_count: answers.q9 != null ? parseInt(answers.q9, 10) : null,
      q10_years_operating: answers.q10 || null,
      q11_legal_structure: answers.q11 || null,
      q12_owner_demographics: Array.isArray(answers.q12) ? answers.q12 : [],
      q13_separate_bank_account: answers.q13 || null,
      q14_filed_tax_returns: answers.q14 || null,
      q15_business_plan: answers.q15 || null,
      q16_short_term_goals: answers.q16 || null,
      q17_success_metrics: answers.q17 || null,
      q18_prior_grants: answers.q18 || null,
      q18_prior_grants_detail: answers.q18_detail || null,
      q19_current_gov_funding: answers.q19 || null,
      q20_naics_code: answers.q20 || null,
      q21_conducts_rd: answers.q21 || null,
      q22_has_ip: answers.q22 || null,
      q23_university_partnerships: answers.q23 || null,
      q24_professional_licenses: answers.q24 || null,
      q24_licenses_detail: answers.q24_detail || null,
      q25_facility: answers.q25 || null,
      q26_equipment_value: answers.q26 != null ? parseInt(answers.q26, 10) : null,
      q27_mission_statement: answers.q27 || null,
      q28_population_served: answers.q28 || null,
      q29_has_board: answers.q29 || null,
      q30_annual_budget: answers.q30 != null ? parseInt(answers.q30, 10) : null,
      q31_area_population: answers.q31 || null,
      q32_creates_local_jobs: answers.q32 || null,
      q33_currently_exports: answers.q33 || null,
      q34_target_markets: answers.q34 || null,
      q35_training_employee_count: answers.q35 != null ? parseInt(answers.q35, 10) : null,
      q36_training_skills: answers.q36 || null,
      q37_additional_info: answers.q37 || null,
      community_service_programs: answers.q30a || null,
      city: answers.q4_city || null,
      state: stateAbbrev || null,
      county: answers.q4_county || null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await db
      .from('grant_radar_intake')
      .upsert(record, { onConflict: 'user_id' });

    if (error) throw error;

    // Also update the old user_intake grant fields for backward compat
    await db.from('user_intake').upsert({
      user_id: req.dbUser.id,
      grant_intake_complete: true,
      exact_revenue: record.q8_annual_revenue,
      exact_employee_count: record.q9_employee_count,
      naics_code: record.q20_naics_code,
      sam_registration: record.q3_sam_registered,
      legal_entity: record.q11_legal_structure,
      owner_demographics: record.q12_owner_demographics,
      grant_fund_use: record.q7_primary_fund_use,
      city: cityVal,
      state: stateAbbrev,
      county: countyVal,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    res.json({ saved: true });
  } catch (e) {
    console.error('Full intake save error:', e.message);
    res.status(500).json({ error: 'Failed to save intake' });
  }
});

// ---- Grant Detail (for detail page) ----

router.get('/detail/:grantName', requireAuth, async (req, res) => {
  try {
    const grantName = decodeURIComponent(req.params.grantName);
    const db = getClient();
    if (!db) return res.status(503).json({ error: 'Database not configured' });

    // Get latest results for this user
    const { data, error } = await db
      .from('grant_radar_results')
      .select('results_json')
      .eq('user_id', req.dbUser.id)
      .order('scan_date', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) return res.json({ grant: null });

    const results = data[0].results_json;
    const allGrants = [
      ...(results.federal || []),
      ...(results.state || []),
      ...(results.local || [])
    ];

    const grant = allGrants.find(g => g.name === grantName);
    if (!grant) return res.json({ grant: null });

    res.json({ grant });
  } catch (e) {
    console.error('Grant detail error:', e.message);
    res.status(500).json({ error: 'Failed to load grant details' });
  }
});

module.exports = router;
