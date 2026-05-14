/**
 * Grant Radar Intake — Branching question form (20-45 questions)
 * Displays one question at a time with progress indicator.
 * Branch logic determined from business basics before form loads.
 */
(function () {
  'use strict';

  var clerkToken = null;
  var clerkInstance = null;
  var currentIndex = 0;
  var questions = [];
  var answers = {};
  var prefillData = {};  // from business basics
  var isEditMode = false;
  var existingIntake = null;

  // ---- Auth ----
  async function initAuth() {
    try {
      var clerk = window.Clerk;
      if (clerk && !clerk.loaded) await clerk.load();
      if (clerk && clerk.user && clerk.session) {
        clerkInstance = clerk;
        clerkToken = await clerk.session.getToken();
        return true;
      }
    } catch (e) { console.error('Auth:', e); }
    window.location.href = '/login';
    return false;
  }

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (clerkToken) h['Authorization'] = 'Bearer ' + clerkToken;
    return h;
  }

  // ---- Question Definitions ----
  function buildQuestions(branches) {
    var qs = [];

    // Core questions 1-20
    qs.push({ id: 'q1', label: 'What is the legal name of your business?', type: 'text', required: true, prefillKey: 'businessName' });
    qs.push({ id: 'q2', label: 'Do you have an Employer Identification Number (EIN)?', type: 'radio', options: ['Yes', 'No', 'I am not sure'], required: true,
      hint: { trigger: ['No', 'I am not sure'], text: 'An EIN is required for most federal grants. You can apply for one free at irs.gov/ein. We will flag grants that require one.' } });
    qs.push({ id: 'q3', label: 'Do you have a Unique Entity Identifier (UEI) and are you registered on SAM.gov?', type: 'radio', options: ['Yes', 'No', 'I am not sure'], required: true,
      hint: { trigger: ['No', 'I am not sure'], text: 'SAM.gov registration is required for most federal grants. It is free and takes about 30 minutes at sam.gov.' } });
    qs.push({ id: 'q4', label: 'What is your business\'s primary street address?', type: 'text', required: true,
      hint: { always: true, text: 'City and state are already known from your business profile.' } });
    qs.push({ id: 'q5', label: 'In one or two sentences, what does your business do and who do you do it for?', type: 'textarea', required: true, prefillKey: 'businessDescription' });
    qs.push({ id: 'q6', label: 'What specific problem does your business solve?', type: 'textarea', required: true });
    qs.push({ id: 'q7', label: 'What is the primary activity you would fund with a grant?', type: 'select', required: true,
      options: ['Hiring employees', 'Purchasing equipment or technology', 'Research and development', 'Opening or expanding a location', 'Marketing and customer acquisition', 'Workforce training', 'Community impact programs', 'General operating costs', 'Export or international trade', 'I am not sure yet'] });
    qs.push({ id: 'q8', label: 'What is your exact annual revenue from last year?', type: 'number', required: true, prefix: '$', placeholder: '0',
      hint: { always: true, text: 'Enter your actual revenue in dollars. If pre-revenue enter 0.' }, prefillKey: 'revenue' });
    qs.push({ id: 'q9', label: 'How many full-time equivalent employees do you have including yourself?', type: 'number', required: true, placeholder: '1', prefillKey: 'employees' });
    qs.push({ id: 'q10', label: 'How long has your business been operating?', type: 'select', required: true,
      options: ['Less than 1 year', '1 to 2 years', '3 to 5 years', '6 to 10 years', 'More than 10 years'], prefillKey: 'years' });
    qs.push({ id: 'q11', label: 'What is your legal business structure?', type: 'select', required: true,
      options: ['Sole proprietorship', 'LLC', 'S-corporation', 'C-corporation', 'Nonprofit 501(c)(3)', 'Nonprofit other', 'Not yet registered'], prefillKey: 'legalEntity' });
    qs.push({ id: 'q12', label: 'Which of the following apply to your business ownership? Select all that apply.', type: 'checkbox', required: false,
      options: ['Woman-owned (51%+)', 'Minority-owned (51%+)', 'Veteran-owned', 'Service-disabled veteran-owned', 'Located in a rural area', 'Located in an economically distressed area or opportunity zone', 'LGBTQ+-owned', 'None of the above'],
      noneOption: 'None of the above', prefillKey: 'demographics' });
    qs.push({ id: 'q13', label: 'Do you have a business bank account separate from your personal finances?', type: 'radio', options: ['Yes', 'No'], required: true });
    qs.push({ id: 'q14', label: 'Have you filed business tax returns for at least one year?', type: 'radio', options: ['Yes', 'No'], required: true });
    qs.push({ id: 'q15', label: 'Do you have a written business plan?', type: 'radio', options: ['Yes — complete plan', 'Partial or informal', 'No'], required: true });
    qs.push({ id: 'q16', label: 'What are the short-term goals of your business in the next 12 months?', type: 'textarea', required: true });
    qs.push({ id: 'q17', label: 'What metrics will you use to measure the success of a funded project?', type: 'textarea', required: true });
    qs.push({ id: 'q18', label: 'Have you applied for any government grants before?', type: 'radio', options: ['Yes and received', 'Yes but did not receive', 'No'], required: true,
      followup: { trigger: ['Yes and received', 'Yes but did not receive'], id: 'q18_detail', label: 'Briefly describe the grant and outcome.', type: 'textarea' } });
    qs.push({ id: 'q19', label: 'Are you currently receiving any other government funding or subsidies?', type: 'radio', options: ['Yes', 'No'], required: true });
    qs.push({ id: 'q20', label: 'What is your NAICS code if you know it?', type: 'text', required: false, placeholder: 'e.g. 561730 for Landscaping Services',
      hint: { always: true, text: 'Look up your NAICS code at <a href="https://www.census.gov/naics/" target="_blank">census.gov/naics</a> — it is the federal industry classification code used by most grant programs. If you do not know it we will estimate it from your business description.' } });

    // Branch A: Technology and Innovation
    if (branches.a) {
      qs.push({ id: 'q21', label: 'Does your business conduct formal research and development activities?', type: 'radio', options: ['Yes', 'No'], required: true, branch: 'A' });
      qs.push({ id: 'q22', label: 'Do you have any patents, trademarks, or proprietary technology?', type: 'radio', options: ['Yes', 'No', 'In progress'], required: true, branch: 'A' });
      qs.push({ id: 'q23', label: 'Do you have any university or research institution partnerships?', type: 'radio', options: ['Yes', 'No'], required: true, branch: 'A' });
    }

    // Branch B: Construction/Trades/Manufacturing
    if (branches.b) {
      qs.push({ id: 'q24', label: 'Do you hold any professional licenses or certifications relevant to your work?', type: 'radio', options: ['Yes', 'No'], required: true, branch: 'B',
        followup: { trigger: ['Yes'], id: 'q24_detail', label: 'List your licenses or certifications.', type: 'textarea' } });
      qs.push({ id: 'q25', label: 'Do you own or lease a physical facility for your operations?', type: 'radio', options: ['Own', 'Lease', 'Neither — I work from client sites or home'], required: true, branch: 'B' });
      qs.push({ id: 'q26', label: 'What is the approximate value of your major equipment assets?', type: 'number', required: true, prefix: '$', placeholder: '0', branch: 'B' });
    }

    // Branch C: Nonprofit
    if (branches.c) {
      qs.push({ id: 'q27', label: 'What is your organization\'s primary mission statement?', type: 'textarea', required: true, branch: 'C' });
      qs.push({ id: 'q28', label: 'What population or community does your organization serve?', type: 'textarea', required: true, branch: 'C' });
      qs.push({ id: 'q29', label: 'Do you have a board of directors?', type: 'radio', options: ['Yes', 'No'], required: true, branch: 'C' });
      qs.push({ id: 'q30', label: 'What is your organization\'s annual operating budget?', type: 'number', required: true, prefix: '$', placeholder: '0', branch: 'C' });
    }

    // Branch D: Rural/Distressed
    if (branches.d) {
      qs.push({ id: 'q31', label: 'What is the population of the area your business primarily serves?', type: 'select', required: true, branch: 'D',
        options: ['Under 2,500', '2,500 to 10,000', '10,000 to 50,000', 'Over 50,000'] });
      qs.push({ id: 'q32', label: 'Does your business create jobs for local residents?', type: 'radio', options: ['Yes', 'Plans to', 'No'], required: true, branch: 'D' });
    }

    // Branch E: Export/International
    if (branches.e) {
      qs.push({ id: 'q33', label: 'Do you currently export products or services outside the United States?', type: 'radio', options: ['Yes', 'No', 'Planning to'], required: true, branch: 'E' });
      qs.push({ id: 'q34', label: 'What countries or regions are your target export markets?', type: 'textarea', required: true, branch: 'E' });
    }

    // Branch F: Workforce/Training
    if (branches.f) {
      qs.push({ id: 'q35', label: 'How many employees would benefit from the training program?', type: 'number', required: true, placeholder: '1', branch: 'F' });
      qs.push({ id: 'q36', label: 'What skills or certifications would the training provide?', type: 'textarea', required: true, branch: 'F' });
    }

    // Final question (always)
    qs.push({ id: 'q37', label: 'Is there anything else about your business or project that you think is relevant to grant eligibility that we have not asked?', type: 'textarea', required: false });

    return qs;
  }

  // ---- Branch Detection ----
  function detectBranches(basics) {
    var industry = ((basics.industry || '') + ' ' + (basics.businessDescription || '')).toLowerCase();
    var entity = (basics.legalEntity || '').toLowerCase();
    var demos = (basics.demographics || []).map(function(d) { return d.toLowerCase(); });
    var fundUse = (basics.fundUse || '').toLowerCase();

    return {
      a: /software|ai|tech|platform|saas|app|digital|cyber|data/.test(industry),
      b: /construct|trade|manufactur|plumb|electr|hvac|weld|carpent|mason|roof/.test(industry),
      c: /nonprofit|501|non-profit/.test(entity),
      d: demos.some(function(d) { return d.includes('rural') || d.includes('distressed') || d.includes('opportunity zone'); }),
      e: fundUse.includes('export') || fundUse.includes('international'),
      f: fundUse.includes('training') || fundUse.includes('workforce')
    };
  }

  // ---- Render ----
  function renderQuestion(q, idx) {
    var div = document.createElement('div');
    div.className = 'gri-question' + (idx === 0 ? ' active' : '');
    div.dataset.id = q.id;

    var label = document.createElement('label');
    label.className = 'gri-label';
    label.textContent = q.label;
    div.appendChild(label);

    // Prefill notice
    var prefilled = false;
    if (q.prefillKey && prefillData[q.prefillKey]) {
      var notice = document.createElement('div');
      notice.className = 'gri-prefill-notice';
      notice.textContent = 'Pre-filled from your business profile';
      div.appendChild(notice);
      prefilled = true;
    }

    // Existing intake notice
    if (isEditMode && existingIntake && existingIntake[q.id] !== undefined && existingIntake[q.id] !== null) {
      if (!prefilled) {
        var enotice = document.createElement('div');
        enotice.className = 'gri-prefill-notice';
        enotice.textContent = 'Your previous answer is loaded';
        div.appendChild(enotice);
      }
    }

    if (q.type === 'text') {
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'gri-' + q.id;
      if (q.placeholder) input.placeholder = q.placeholder;
      input.value = getValue(q) || '';
      div.appendChild(input);
    } else if (q.type === 'number') {
      var wrap = document.createElement('div');
      if (q.prefix) {
        wrap.className = 'gri-revenue-wrap';
        var span = document.createElement('span');
        span.textContent = q.prefix;
        wrap.appendChild(span);
      }
      var numInput = document.createElement('input');
      numInput.type = 'number';
      numInput.id = 'gri-' + q.id;
      numInput.min = '0';
      numInput.step = '1';
      if (q.placeholder) numInput.placeholder = q.placeholder;
      numInput.value = getValue(q) || '';
      if (q.prefix) numInput.style.flex = '1';
      wrap.appendChild(numInput);
      div.appendChild(wrap);
    } else if (q.type === 'textarea') {
      var ta = document.createElement('textarea');
      ta.id = 'gri-' + q.id;
      ta.rows = 3;
      ta.value = getValue(q) || '';
      div.appendChild(ta);
    } else if (q.type === 'select') {
      var sel = document.createElement('select');
      sel.id = 'gri-' + q.id;
      var emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'Select one';
      sel.appendChild(emptyOpt);
      q.options.forEach(function(opt) {
        var o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        sel.appendChild(o);
      });
      sel.value = getValue(q) || '';
      div.appendChild(sel);
    } else if (q.type === 'radio') {
      var radios = document.createElement('div');
      radios.className = 'gri-radios';
      var currentVal = getValue(q) || '';
      q.options.forEach(function(opt) {
        var rl = document.createElement('label');
        var ri = document.createElement('input');
        ri.type = 'radio';
        ri.name = 'gri-' + q.id;
        ri.value = opt;
        if (currentVal === opt) ri.checked = true;
        rl.appendChild(ri);
        rl.appendChild(document.createTextNode(opt));
        radios.appendChild(rl);
      });
      div.appendChild(radios);

      // Conditional hint
      if (q.hint && q.hint.trigger) {
        var hintDiv = document.createElement('div');
        hintDiv.className = 'gri-hint';
        hintDiv.style.display = 'none';
        hintDiv.innerHTML = q.hint.text;
        div.appendChild(hintDiv);
        radios.addEventListener('change', function() {
          var selected = div.querySelector('input[name="gri-' + q.id + '"]:checked');
          if (selected && q.hint.trigger.indexOf(selected.value) >= 0) {
            hintDiv.style.display = 'block';
          } else {
            hintDiv.style.display = 'none';
          }
        });
        // Show on load if prefilled to trigger value
        if (currentVal && q.hint.trigger.indexOf(currentVal) >= 0) hintDiv.style.display = 'block';
      }

      // Followup question
      if (q.followup) {
        var fuDiv = document.createElement('div');
        fuDiv.style.display = 'none';
        fuDiv.style.marginTop = '12px';
        var fuLabel = document.createElement('label');
        fuLabel.className = 'gri-label';
        fuLabel.textContent = q.followup.label;
        fuDiv.appendChild(fuLabel);
        var fuInput = document.createElement('textarea');
        fuInput.id = 'gri-' + q.followup.id;
        fuInput.rows = 2;
        fuInput.value = (existingIntake && existingIntake[q.followup.id]) || '';
        fuDiv.appendChild(fuInput);
        div.appendChild(fuDiv);
        radios.addEventListener('change', function() {
          var selected = div.querySelector('input[name="gri-' + q.id + '"]:checked');
          if (selected && q.followup.trigger.indexOf(selected.value) >= 0) {
            fuDiv.style.display = 'block';
          } else {
            fuDiv.style.display = 'none';
          }
        });
        var fuVal = (existingIntake && existingIntake[q.followup.id]);
        if (fuVal && currentVal && q.followup.trigger.indexOf(currentVal) >= 0) fuDiv.style.display = 'block';
      }
    } else if (q.type === 'checkbox') {
      var cbs = document.createElement('div');
      cbs.className = 'gri-checkboxes';
      var currentVals = getValue(q) || [];
      q.options.forEach(function(opt) {
        var cl = document.createElement('label');
        var ci = document.createElement('input');
        ci.type = 'checkbox';
        ci.value = opt;
        ci.name = 'gri-' + q.id;
        if (Array.isArray(currentVals) && currentVals.indexOf(opt) >= 0) ci.checked = true;
        cl.appendChild(ci);
        cl.appendChild(document.createTextNode(opt));
        cbs.appendChild(cl);
      });
      div.appendChild(cbs);

      // "None of the above" logic
      if (q.noneOption) {
        cbs.addEventListener('change', function(e) {
          var target = e.target;
          if (target.value === q.noneOption && target.checked) {
            cbs.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
              if (cb !== target) cb.checked = false;
            });
          } else if (target.checked && target.value !== q.noneOption) {
            var none = cbs.querySelector('input[value="' + q.noneOption + '"]');
            if (none) none.checked = false;
          }
        });
      }
    }

    // Always-visible hint
    if (q.hint && q.hint.always) {
      var alwaysHint = document.createElement('div');
      alwaysHint.className = 'gri-hint';
      alwaysHint.innerHTML = q.hint.text;
      div.appendChild(alwaysHint);
    }

    return div;
  }

  function getValue(q) {
    // Priority: existing intake (edit mode) > prefill from business basics
    if (existingIntake && existingIntake[q.id] !== undefined && existingIntake[q.id] !== null) {
      return existingIntake[q.id];
    }
    if (q.prefillKey && prefillData[q.prefillKey] !== undefined) {
      return prefillData[q.prefillKey];
    }
    return null;
  }

  // ---- Collect Answer ----
  function collectAnswer(q) {
    var div = document.querySelector('.gri-question[data-id="' + q.id + '"]');
    if (!div) return null;

    if (q.type === 'text' || q.type === 'textarea') {
      var el = div.querySelector('#gri-' + q.id);
      return el ? el.value.trim() : null;
    } else if (q.type === 'number') {
      var el = div.querySelector('#gri-' + q.id);
      return el && el.value ? parseInt(el.value, 10) : null;
    } else if (q.type === 'select') {
      var el = div.querySelector('#gri-' + q.id);
      return el ? el.value : null;
    } else if (q.type === 'radio') {
      var checked = div.querySelector('input[name="gri-' + q.id + '"]:checked');
      var val = checked ? checked.value : null;
      // Also grab followup if applicable
      if (q.followup) {
        var fuEl = div.querySelector('#gri-' + q.followup.id);
        if (fuEl && fuEl.value.trim()) {
          answers[q.followup.id] = fuEl.value.trim();
        }
      }
      return val;
    } else if (q.type === 'checkbox') {
      var selected = [];
      div.querySelectorAll('input[name="gri-' + q.id + '"]:checked').forEach(function(cb) {
        selected.push(cb.value);
      });
      return selected;
    }
    return null;
  }

  // ---- Navigation ----
  function showQuestion(idx) {
    var allQs = document.querySelectorAll('.gri-question');
    allQs.forEach(function(q) { q.classList.remove('active'); });

    if (allQs[idx]) allQs[idx].classList.add('active');
    currentIndex = idx;

    // Progress
    var progress = document.getElementById('gri-progress');
    progress.textContent = 'Question ' + (idx + 1) + ' of approximately ' + questions.length;

    // Nav buttons
    document.getElementById('gri-back').style.display = idx > 0 ? 'inline-block' : 'none';
    var isLast = idx === questions.length - 1;
    document.getElementById('gri-next').style.display = isLast ? 'none' : 'inline-block';
    document.getElementById('gri-submit').style.display = isLast ? 'inline-block' : 'none';

    // Scroll to top
    window.scrollTo(0, 0);
  }

  function validate(q) {
    if (!q.required) return true;
    var val = collectAnswer(q);
    if (val === null || val === '' || (Array.isArray(val) && val.length === 0)) return false;
    return true;
  }

  // ---- Submit ----
  async function submitIntake() {
    var submitBtn = document.getElementById('gri-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    // Collect all answers
    questions.forEach(function(q) {
      answers[q.id] = collectAnswer(q);
    });

    try {
      var res = await fetch('/api/grant-radar/intake-full', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ answers: answers, isEdit: isEditMode })
      });
      if (!res.ok) throw new Error('Save failed');

      // Redirect to grant radar page for scanning
      window.location.href = '/grant-radar?scan=auto';
    } catch (e) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Find my grants →';
      alert('Failed to save. Please try again.');
    }
  }

  // ---- Init ----
  async function init() {
    var authed = await initAuth();
    if (!authed) return;

    isEditMode = new URLSearchParams(window.location.search).get('mode') === 'edit';

    // Load business basics for branch detection + prefill
    try {
      var resp = await fetch('/api/intake/data', { headers: authHeaders() });
      if (resp.ok) {
        var data = await resp.json();
        if (data.intake) {
          prefillData = {
            businessName: data.intake.businessName,
            businessDescription: data.intake.description,
            revenue: data.intake.revenue,
            employees: data.intake.employees,
            years: data.intake.years,
            legalEntity: data.intake.legalEntity || data.intake.entity,
            demographics: [],
            fundUse: ''
          };
        }
        // Use full intake for branch detection
        if (data.session) {
          prefillData.industry = data.session.industryKey || data.intake.industry;
        }
      }
    } catch (e) { console.warn('Prefill load failed:', e); }

    // Load grant radar intake status for branch detection
    try {
      var statusResp = await fetch('/api/grant-radar/intake-status', { headers: authHeaders() });
      if (statusResp.ok) {
        var statusData = await statusResp.json();
        if (statusData.complete && statusData.intake) {
          var si = statusData.intake;
          prefillData.legalEntity = si.legalEntity || prefillData.legalEntity;
          prefillData.demographics = si.ownerDemographics || prefillData.demographics;
          prefillData.fundUse = si.grantFundUse || prefillData.fundUse;
        }
      }
    } catch (e) { /* ok */ }

    // Load existing grant_radar_intake for edit mode
    if (isEditMode) {
      try {
        var eiResp = await fetch('/api/grant-radar/intake-full-status', { headers: authHeaders() });
        if (eiResp.ok) {
          var eiData = await eiResp.json();
          if (eiData.intake) existingIntake = eiData.intake;
        }
      } catch (e) { /* ok */ }
    }

    // Detect branches
    var branches = detectBranches({
      industry: prefillData.industry || prefillData.businessDescription || '',
      businessDescription: prefillData.businessDescription || '',
      legalEntity: prefillData.legalEntity || '',
      demographics: prefillData.demographics || [],
      fundUse: prefillData.fundUse || ''
    });

    // Build question list
    questions = buildQuestions(branches);

    // Render all questions
    var container = document.getElementById('gri-questions');
    questions.forEach(function(q, idx) {
      container.appendChild(renderQuestion(q, idx));
    });

    showQuestion(0);

    // Nav handlers
    document.getElementById('gri-next').addEventListener('click', function() {
      var q = questions[currentIndex];
      if (!validate(q)) {
        alert('Please answer this question before continuing.');
        return;
      }
      answers[q.id] = collectAnswer(q);
      showQuestion(currentIndex + 1);
    });

    document.getElementById('gri-back').addEventListener('click', function() {
      answers[questions[currentIndex].id] = collectAnswer(questions[currentIndex]);
      showQuestion(currentIndex - 1);
    });

    document.getElementById('gri-submit').addEventListener('click', function() {
      var q = questions[currentIndex];
      if (q.required && !validate(q)) {
        alert('Please answer this question before submitting.');
        return;
      }
      answers[q.id] = collectAnswer(q);
      submitIntake();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
