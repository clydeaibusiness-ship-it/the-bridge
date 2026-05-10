/**
 * Grant Radar — Frontend Logic
 * Handles intake, scanning, results display, save/apply/claim flows
 */
(function () {
  'use strict';

  // State
  let clerkToken = null;
  let savedGrantNames = new Set();
  let applications = {};  // grantName -> application record
  let currentResults = null;

  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
    'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
    'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
    'VT','VA','WA','WV','WI','WY'
  ];
  const STATE_NAMES = {
    'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
    'CO':'Colorado','CT':'Connecticut','DE':'Delaware','DC':'District of Columbia',
    'FL':'Florida','GA':'Georgia','HI':'Hawaii','ID':'Idaho','IL':'Illinois',
    'IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana',
    'ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota',
    'MS':'Mississippi','MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada',
    'NH':'New Hampshire','NJ':'New Jersey','NM':'New Mexico','NY':'New York',
    'NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon',
    'PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota',
    'TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia',
    'WA':'Washington','WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming'
  };

  // ---- Auth ----
  var clerkInstance = null;

  async function initAuth() {
    // Strategy 1: Use Clerk from inline page script
    try {
      if (window.__grClerkReady) {
        clerkInstance = await window.__grClerkReady;
      }
      if (clerkInstance && clerkInstance.session) {
        clerkToken = await clerkInstance.session.getToken();
        console.log('Auth: Clerk token obtained');
        return true;
      }
    } catch (e) {
      console.error('Clerk auth failed:', e);
    }

    // Strategy 2: Use existing window.Clerk instance (CDN creates it)
    try {
      if (window.Clerk && !clerkInstance) {
        clerkInstance = window.Clerk;
        if (!clerkInstance.loaded) await clerkInstance.load();
        if (clerkInstance.user && clerkInstance.session) {
          clerkToken = await clerkInstance.session.getToken();
          console.log('Auth: Clerk token obtained (existing instance)');
          return true;
        }
      }
    } catch (e) {
      console.error('Clerk instance auth failed:', e);
    }

    // Strategy 3: Cookie-based auth (Clerk __session cookie may exist)
    try {
      var resp = await fetch('/api/auth/me');
      if (resp.ok) {
        console.log('Auth: cookie fallback succeeded');
        clerkToken = null;
        return true;
      }
    } catch (e) {
      console.error('Cookie auth failed:', e);
    }

    // All strategies failed
    console.error('All auth strategies failed — redirecting to login');
    window.location.href = '/login';
    return false;
  }

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (clerkToken) h['Authorization'] = 'Bearer ' + clerkToken;
    return h;
  }

  // ---- Helpers ----
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ---- Init ----
  async function init() {
    const authed = await initAuth();
    if (!authed) return;

    populateStateDropdown();
    setupFormListeners();

    // Check intake status
    const statusRes = await fetch('/api/grant-radar/intake-status', { headers: authHeaders() });
    const status = await statusRes.json();

    if (status.complete) {
      // Check if auto-rescan needed
      const nextScan = status.intake.nextScanDate ? new Date(status.intake.nextScanDate) : null;
      const needsAutoScan = nextScan && new Date() >= nextScan;

      // Load existing results
      const resultsRes = await fetch('/api/grant-radar/results', { headers: authHeaders() });
      const resultsData = await resultsRes.json();

      if (needsAutoScan || !resultsData.results) {
        // Run auto scan
        showLoading();
        await runScan(false);
      } else {
        // Show existing results
        showResults(resultsData.results, resultsData.scanDate, resultsData.nextScanDate);
      }
    } else {
      showIntake();
      // Pre-populate from existing intake data
      await prefillFromExistingIntake();
    }
  }

  async function prefillFromExistingIntake() {
    try {
      var resp = await fetch('/api/intake/data', { headers: authHeaders() });
      if (!resp.ok) return;
      var data = await resp.json();
      if (!data.intake) return;
      var a = data.intake;
      // Pre-fill fields that already have answers
      if (a.city) { var el = $('#intake-city'); if (el) el.value = a.city; }
      if (a.state) { var el = $('#intake-state'); if (el) el.value = a.state; }
      if (a.legalEntity) { var el = $('#intake-entity'); if (el) el.value = a.legalEntity; }
      if (a.revenue) { var el = $('#intake-revenue'); if (el) el.value = a.revenue; }
    } catch (e) {
      console.warn('Prefill failed:', e);
    }
  }

  function populateStateDropdown() {
    const sel = $('#intake-state');
    US_STATES.forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = STATE_NAMES[code] || code;
      sel.appendChild(opt);
    });
  }

  function setupFormListeners() {
    // SAM.gov "What is SAM.gov?" info button
    var samWhat = $('#sam-what');
    if (samWhat) {
      samWhat.addEventListener('click', function () {
        var explain = $('#sam-explain');
        if (explain) {
          explain.classList.toggle('visible');
        }
      });
    }

    // "None of the above" clears other checkboxes
    var demoNone = $('#demo-none');
    if (demoNone) {
      demoNone.addEventListener('change', function () {
        if (this.checked) {
          $$('#field-demographics input[type="checkbox"]').forEach(function (cb) {
            if (cb !== demoNone) cb.checked = false;
          });
        }
      });
      $$('#field-demographics input[type="checkbox"]').forEach(function (cb) {
        if (cb !== demoNone) {
          cb.addEventListener('change', function () {
            if (this.checked) demoNone.checked = false;
          });
        }
      });
    }

    // Form submit
    var form = $('#grant-intake-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitIntake();
      });
    }

    // Rescan button
    var rescanBtn = $('#rescan-btn');
    if (rescanBtn) {
      rescanBtn.addEventListener('click', function () {
        showLoading();
        runScan(true);
      });
    }

    // Saved grants toggle
    var savedToggle = $('#saved-toggle');
    if (savedToggle) {
      savedToggle.addEventListener('click', function () {
        var list = $('#saved-list');
        if (list) list.classList.toggle('open');
      });
    }
  }

  // ---- Intake ----
  function showIntake() {
    $('#intake-section').style.display = 'block';
    $('#loading-section').style.display = 'none';
    $('#results-section').style.display = 'none';
    $('#rescan-btn').style.display = 'none';
  }

  async function submitIntake() {
    var btn = $('#intake-submit');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    var demographics = [];
    $$('#field-demographics input[type="checkbox"]:checked').forEach(function (cb) {
      demographics.push(cb.value);
    });

    var samVal = '';
    $$('input[name="sam"]').forEach(function (r) {
      if (r.checked) samVal = r.value;
    });

    var data = {
      city: $('#intake-city').value.trim(),
      state: $('#intake-state').value,
      legalEntity: $('#intake-entity').value,
      granularRevenue: $('#intake-revenue').value,
      ownerDemographics: demographics,
      grantFundUse: $('#intake-fund-use').value,
      samRegistration: samVal || 'No',
      naicsCode: $('#intake-naics').value.trim() || null
    };

    try {
      var res = await fetch('/api/grant-radar/intake', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Save failed');

      showLoading();
      await runScan(false);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Start scanning →';
      alert('Failed to save intake. Please try again.');
    }
  }

  // ---- Scanning ----
  function showLoading() {
    $('#intake-section').style.display = 'none';
    $('#loading-section').style.display = 'block';
    $('#results-section').style.display = 'none';
  }

  async function runScan(manual) {
    try {
      var res = await fetch('/api/grant-radar/scan', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ manual: !!manual })
      });

      if (res.status === 429) {
        var err = await res.json();
        alert(err.error);
        // Show existing results instead
        var existingRes = await fetch('/api/grant-radar/results', { headers: authHeaders() });
        var existingData = await existingRes.json();
        if (existingData.results) {
          showResults(existingData.results, existingData.scanDate, existingData.nextScanDate);
        }
        return;
      }

      if (!res.ok) throw new Error('Scan failed');

      var data = await res.json();
      if (manual) {
        var banner = $('#refresh-banner');
        if (banner) { banner.classList.add('visible'); }
      }
      showResults(data.results, data.scanDate, data.nextScanDate);
    } catch (e) {
      $('#loading-section').style.display = 'none';
      alert('Grant scan failed. Please try again.');
    }
  }

  // ---- Results Display ----
  async function showResults(results, scanDate, nextScanDate) {
    currentResults = results;

    $('#intake-section').style.display = 'none';
    $('#loading-section').style.display = 'none';
    $('#results-section').style.display = 'block';
    $('#rescan-btn').style.display = 'inline-block';

    // Scan info
    if (scanDate) {
      $('#last-scan').textContent = 'Last scanned: ' + formatDate(scanDate);
    }
    if (nextScanDate) {
      $('#next-scan').textContent = 'Next automatic scan: ' + formatDate(nextScanDate);
    }

    // Load saved grants and applications
    await loadSavedGrants();
    await loadApplications();

    // Section headers
    var stateHeader = $('#state-header');
    var localHeader = $('#local-header');
    if (results.stateName) {
      stateHeader.textContent = (results.stateName.toUpperCase()) + ' STATE GRANTS';
    }
    if (results.city) {
      localHeader.textContent = (results.city.toUpperCase()) + ' AND SURROUNDING LOCAL GRANTS';
    }

    // Render sections
    renderGrantSection('federal-results', results.federal || []);
    renderGrantSection('state-results', results.state || []);
    renderGrantSection('local-results', results.local || []);
  }

  async function loadSavedGrants() {
    try {
      var res = await fetch('/api/grant-radar/saved', { headers: authHeaders() });
      var data = await res.json();
      savedGrantNames = new Set((data.saved || []).map(function (g) { return g.grant_name; }));

      // Render saved section
      var section = $('#saved-section');
      var toggle = $('#saved-toggle');
      var list = $('#saved-list');

      if (data.saved && data.saved.length > 0) {
        section.style.display = 'block';
        toggle.textContent = 'SAVED GRANTS (' + data.saved.length + ')';
        list.innerHTML = '';
        data.saved.forEach(function (grant) {
          var grantObj = grant.full_result_json || {
            name: grant.grant_name,
            url: grant.grant_url,
            description: grant.grant_description,
            amount: grant.grant_amount,
            jurisdiction: grant.jurisdiction
          };
          var card = createGrantCard(grantObj, true);
          // Add saved date
          var dateEl = document.createElement('div');
          dateEl.className = 'gr-saved-date';
          dateEl.textContent = 'Saved ' + formatDate(grant.date_saved);
          card.insertBefore(dateEl, card.firstChild);
          list.appendChild(card);
        });
      } else {
        section.style.display = 'none';
      }
    } catch (e) {
      console.error('Failed to load saved grants:', e);
    }
  }

  async function loadApplications() {
    try {
      var res = await fetch('/api/grant-radar/applications', { headers: authHeaders() });
      var data = await res.json();
      applications = {};
      (data.applications || []).forEach(function (app) {
        applications[app.grant_name] = app;
      });
    } catch (e) {
      console.error('Failed to load applications:', e);
    }
  }

  function renderGrantSection(containerId, grants) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';

    if (!grants || grants.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'gr-empty-section';
      empty.textContent = 'No active grants found in this category matching your current profile. Check back after your next scan or update your profile to expand eligibility.';
      container.appendChild(empty);
      return;
    }

    grants.forEach(function (grant) {
      container.appendChild(createGrantCard(grant, false));
    });
  }

  function createGrantCard(grant, isSaved) {
    var card = document.createElement('div');
    card.className = 'gr-card';

    var isSavedGrant = isSaved || savedGrantNames.has(grant.name);

    // Bookmark button
    var bookmark = document.createElement('button');
    bookmark.className = 'gr-bookmark' + (isSavedGrant ? ' saved' : '');
    bookmark.innerHTML = '<svg viewBox="0 0 16 20"><path class="bm-unsaved" d="M2 1h12v18l-6-4-6 4V1z"/><path class="bm-saved" d="M2 1h12v18l-6-4-6 4V1z"/></svg>';
    bookmark.addEventListener('click', function () {
      toggleSave(grant, bookmark);
    });
    card.appendChild(bookmark);

    // Row 1: Title + amount
    var row1 = document.createElement('div');
    row1.className = 'gr-card-row1';
    var title = document.createElement('div');
    title.className = 'gr-card-title';
    if (grant.url) {
      var link = document.createElement('a');
      link.href = grant.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = grant.name;
      title.appendChild(link);
    } else {
      title.textContent = grant.name;
    }
    row1.appendChild(title);

    if (grant.amount) {
      var amountChip = document.createElement('span');
      amountChip.className = 'gr-amount-chip';
      amountChip.textContent = grant.amount;
      row1.appendChild(amountChip);
    }
    card.appendChild(row1);

    // Row 2: Description
    if (grant.description) {
      var desc = document.createElement('div');
      desc.className = 'gr-card-desc';
      desc.textContent = grant.description;
      card.appendChild(desc);
    }

    // Row 3: Chips
    var chips = document.createElement('div');
    chips.className = 'gr-card-chips';

    if (grant.matchPercent) {
      var matchChip = document.createElement('span');
      matchChip.className = 'gr-chip ' + (grant.matchPercent >= 90 ? 'gr-chip-match-high' : 'gr-chip-match-med');
      matchChip.textContent = grant.matchPercent + '% match';
      chips.appendChild(matchChip);
    }

    if (grant.status) {
      var statusChip = document.createElement('span');
      var statusLower = grant.status.toLowerCase();
      if (statusLower === 'open now') {
        statusChip.className = 'gr-chip gr-chip-open';
      } else if (statusLower === 'rolling applications') {
        statusChip.className = 'gr-chip gr-chip-rolling';
      } else if (statusLower.indexOf('closed') === 0) {
        statusChip.className = 'gr-chip gr-chip-closed';
      } else {
        statusChip.className = 'gr-chip gr-chip-deadline';
      }
      statusChip.textContent = grant.status;
      chips.appendChild(statusChip);
    }

    if (grant.requiresSAM) {
      var samChip = document.createElement('span');
      samChip.className = 'gr-chip gr-chip-sam';
      samChip.textContent = 'Requires SAM.gov';
      chips.appendChild(samChip);
    }

    card.appendChild(chips);

    // Row 4: What to shift (expandable inline — does NOT navigate)
    if (grant.gaps && grant.gaps.length > 0 && grant.matchPercent < 100) {
      var trigger = document.createElement('button');
      trigger.className = 'gr-expand-trigger';
      trigger.type = 'button';
      trigger.textContent = 'What would bring this to 100%? ▸';
      var content = document.createElement('div');
      content.className = 'gr-expand-content';
      var ul = document.createElement('ul');
      grant.gaps.forEach(function (gap) {
        var li = document.createElement('li');
        li.textContent = gap;
        ul.appendChild(li);
      });
      content.appendChild(ul);
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        content.classList.toggle('open');
        trigger.textContent = content.classList.contains('open')
          ? 'What would bring this to 100%? ▾'
          : 'What would bring this to 100%? ▸';
      });
      card.appendChild(trigger);
      card.appendChild(content);
    }

    // Row 5: Action buttons
    var actions = document.createElement('div');
    actions.className = 'gr-card-actions';

    // View application button
    if (grant.url) {
      var viewBtn = document.createElement('a');
      viewBtn.className = 'gr-btn-view';
      viewBtn.href = grant.url;
      viewBtn.target = '_blank';
      viewBtn.rel = 'noopener';
      viewBtn.textContent = 'View application →';
      actions.appendChild(viewBtn);
    }

    // "I applied for this" / "I received this grant" buttons
    var app = applications[grant.name];

    var applyBtn = document.createElement('button');
    if (app && app.status !== 'applied') {
      // Already in some status beyond applied
    }
    if (app) {
      applyBtn.className = 'gr-btn-applied';
      applyBtn.textContent = 'Applied ✓';
      actions.appendChild(applyBtn);

      // Verification status chip
      if (app.status === 'pending_review') {
        var vChip = document.createElement('span');
        vChip.className = 'gr-verification-chip gr-verification-pending';
        vChip.textContent = 'Verification pending';
        actions.appendChild(vChip);
      } else if (app.status === 'verified') {
        var vChip2 = document.createElement('span');
        vChip2.className = 'gr-verification-chip gr-verification-verified';
        vChip2.textContent = 'Win verified ✓';
        actions.appendChild(vChip2);
      } else if (app.status === 'rejected') {
        var vChip3 = document.createElement('span');
        vChip3.className = 'gr-verification-chip gr-verification-rejected';
        vChip3.textContent = 'Resubmit document';
        actions.appendChild(vChip3);
      }

      // "I received this grant" button
      if (app.status === 'applied' || app.status === 'rejected') {
        var receiveBtn = document.createElement('button');
        receiveBtn.className = 'gr-btn-received';
        receiveBtn.textContent = 'I received this grant';
        receiveBtn.addEventListener('click', function () {
          showClaimFlow(grant, app, card, receiveBtn);
        });
        actions.appendChild(receiveBtn);
      }
    } else {
      applyBtn.className = 'gr-btn-apply';
      applyBtn.textContent = 'I applied for this';
      applyBtn.addEventListener('click', function () {
        showApplyForm(grant, card, applyBtn, actions);
      });
      actions.appendChild(applyBtn);

      // Disabled receive button
      var receiveDisabled = document.createElement('button');
      receiveDisabled.className = 'gr-btn-received';
      receiveDisabled.textContent = 'I received this grant';
      receiveDisabled.disabled = true;
      actions.appendChild(receiveDisabled);
    }

    card.appendChild(actions);
    return card;
  }

  // ---- Save/Unsave ----
  async function toggleSave(grant, btn) {
    try {
      var res = await fetch('/api/grant-radar/save', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          grantName: grant.name,
          grantUrl: grant.url,
          grantDescription: grant.description,
          grantAmount: grant.amount,
          jurisdiction: grant.jurisdiction,
          fullResult: grant
        })
      });
      var data = await res.json();
      if (data.saved) {
        btn.classList.add('saved');
        savedGrantNames.add(grant.name);
      } else {
        btn.classList.remove('saved');
        savedGrantNames.delete(grant.name);
      }
      // Refresh saved section
      await loadSavedGrants();
    } catch (e) {
      console.error('Save toggle failed:', e);
    }
  }

  // ---- Apply Form ----
  function showApplyForm(grant, card, applyBtn, actionsContainer) {
    // Replace button with form
    applyBtn.style.display = 'none';

    var form = document.createElement('div');
    form.className = 'gr-inline-form';
    form.innerHTML = '<label>When did you apply?</label>' +
      '<input type="date" id="apply-date-' + encodeId(grant.name) + '" value="' + todayISO() + '">' +
      '<button class="gr-inline-save" id="apply-save-' + encodeId(grant.name) + '">Save</button>';
    card.appendChild(form);

    var saveBtn = form.querySelector('button');
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      var dateInput = form.querySelector('input[type="date"]');
      try {
        var res = await fetch('/api/grant-radar/apply', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            grantName: grant.name,
            grantUrl: grant.url,
            grantAmountAvailable: grant.amount,
            dateApplied: dateInput.value
          })
        });
        if (!res.ok) throw new Error('Failed');

        var data = await res.json();
        applications[grant.name] = data.application;

        // Update UI
        card.removeChild(form);
        applyBtn.className = 'gr-btn-applied';
        applyBtn.textContent = 'Applied ✓';
        applyBtn.style.display = '';

        // Enable receive button
        var receiveBtns = actionsContainer.querySelectorAll('.gr-btn-received');
        receiveBtns.forEach(function (rb) {
          rb.disabled = false;
          rb.addEventListener('click', function () {
            showClaimFlow(grant, data.application, card, rb);
          });
        });
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        alert('Failed to save. Try again.');
      }
    });
  }

  // ---- Claim Flow ----
  function showClaimFlow(grant, application, card, receiveBtn) {
    receiveBtn.style.display = 'none';

    var flow = document.createElement('div');
    flow.className = 'gr-inline-form';

    // Step 1: Amount
    var step1 = document.createElement('div');
    step1.innerHTML = '<label>Congratulations. How much were you awarded?</label>' +
      '<div style="display:flex;align-items:center;gap:4px;">' +
      '<span style="font-size:1rem;font-weight:500;">$</span>' +
      '<input type="number" id="claim-amount" min="1" step="0.01" placeholder="10,000" style="width:150px;">' +
      '</div>';
    flow.appendChild(step1);

    // Step 2: Upload
    var step2 = document.createElement('div');
    step2.style.marginTop = '12px';
    step2.innerHTML = '<label>Upload proof of award to verify your win.</label>' +
      '<input type="file" id="claim-file" accept=".jpg,.jpeg,.png,.pdf">' +
      '<div class="gr-upload-note">This can be your official award letter, a grant agreement, a check image, a bank deposit confirmation, or any government document showing the grant amount and your business name. Your document is stored privately and is only reviewed by The Bridge team. It is never shared publicly. Your name is never displayed on the counter — only the dollar total changes.</div>';
    flow.appendChild(step2);

    // Step 3: Submit
    var submitBtn = document.createElement('button');
    submitBtn.className = 'gr-submit-claim';
    submitBtn.textContent = 'Submit for verification →';
    submitBtn.disabled = true;
    flow.appendChild(submitBtn);

    card.appendChild(flow);

    // Enable submit when both fields filled
    var amountInput = flow.querySelector('#claim-amount');
    var fileInput = flow.querySelector('#claim-file');

    function checkReady() {
      submitBtn.disabled = !(amountInput.value && parseFloat(amountInput.value) > 0 && fileInput.files && fileInput.files.length > 0);
    }
    amountInput.addEventListener('input', checkReady);
    fileInput.addEventListener('change', checkReady);

    submitBtn.addEventListener('click', async function () {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading...';

      try {
        // Upload file first
        // Refresh token before upload
        if (clerkInstance && clerkInstance.session) {
          clerkToken = await clerkInstance.session.getToken();
        }

        var formData = new FormData();
        formData.append('document', fileInput.files[0]);
        formData.append('applicationId', application.id);

        var uploadHeaders = {};
        if (clerkToken) uploadHeaders['Authorization'] = 'Bearer ' + clerkToken;

        var uploadRes = await fetch('/api/grant-radar/upload', {
          method: 'POST',
          headers: uploadHeaders,
          body: formData
        });
        if (!uploadRes.ok) throw new Error('Upload failed');

        // Submit claim
        submitBtn.textContent = 'Submitting...';
        var claimRes = await fetch('/api/grant-radar/claim', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            applicationId: application.id,
            amountReceived: parseFloat(amountInput.value)
          })
        });
        if (!claimRes.ok) throw new Error('Claim failed');

        // Update UI
        card.removeChild(flow);
        var chip = document.createElement('span');
        chip.className = 'gr-verification-chip gr-verification-pending';
        chip.textContent = 'Verification pending';
        var actionsDiv = card.querySelector('.gr-card-actions');
        if (actionsDiv) actionsDiv.appendChild(chip);

        applications[grant.name].status = 'pending_review';
      } catch (e) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit for verification →';
        alert('Submission failed. Please try again.');
      }
    });
  }

  // ---- Utilities ----
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function encodeId(str) {
    return (str || '').replace(/[^a-zA-Z0-9]/g, '-').substring(0, 40);
  }

  // ---- Start ----
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
