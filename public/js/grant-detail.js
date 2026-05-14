/**
 * Grant Detail Page — shows documents, submission info, contact, score breakdown
 */
(function () {
  'use strict';

  var clerkToken = null;
  var clerkInstance = null;
  var grantData = null;

  async function initAuth() {
    try {
      var clerk = window.Clerk;
      if (clerk && !clerk.loaded) await clerk.load();
      if (clerk && clerk.user && clerk.session) {
        clerkInstance = clerk;
        clerkToken = await clerk.session.getToken();
        return true;
      }
    } catch (e) {}
    window.location.href = '/login';
    return false;
  }

  function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (clerkToken) h['Authorization'] = 'Bearer ' + clerkToken;
    return h;
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(function() {
      var orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function() { btn.textContent = orig; }, 1500);
    });
  }

  async function init() {
    var authed = await initAuth();
    if (!authed) return;

    // Get grant ID from URL
    var pathParts = window.location.pathname.split('/');
    var grantId = decodeURIComponent(pathParts[pathParts.length - 1]);

    if (!grantId) {
      document.getElementById('gd-content').innerHTML = '<div class="gd-text-muted">No grant specified.</div>';
      return;
    }

    // Fetch grant data
    try {
      var res = await fetch('/api/grant-radar/detail/' + encodeURIComponent(grantId), { headers: authHeaders() });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (!data.grant) throw new Error('Grant not found');
      grantData = data.grant;
      renderDetail(grantData);
    } catch (e) {
      document.getElementById('gd-content').innerHTML = '<div class="gd-text-muted">Could not load grant details. <a href="/grant-radar">← Back to results</a></div>';
    }
  }

  function renderDetail(grant) {
    var detail = grant.detail_data || {};
    var container = document.getElementById('gd-content');
    container.innerHTML = '';

    // ---- Header ----
    var title = document.createElement('h1');
    title.className = 'gd-title';
    title.textContent = grant.name;
    container.appendChild(title);

    var chips = document.createElement('div');
    chips.className = 'gd-chips';
    if (grant.amount) {
      var ac = document.createElement('span');
      ac.className = 'gd-chip gd-chip-amount';
      ac.textContent = grant.amount;
      chips.appendChild(ac);
    }
    if (grant.matchPercent) {
      var mc = document.createElement('span');
      mc.className = 'gd-chip ' + (grant.matchPercent >= 90 ? 'gd-chip-match-high' : 'gd-chip-match-med');
      mc.textContent = grant.matchPercent + '% match';
      chips.appendChild(mc);
    }
    if (grant.status) {
      var sc = document.createElement('span');
      var sl = grant.status.toLowerCase();
      sc.className = 'gd-chip ' + (sl === 'open now' ? 'gd-chip-open' : sl === 'rolling applications' ? 'gd-chip-rolling' : sl.indexOf('closed') === 0 ? 'gd-chip-closed' : 'gd-chip-deadline');
      sc.textContent = grant.status;
      chips.appendChild(sc);
    }
    container.appendChild(chips);

    // Source URL
    var sourceUrl = detail.source_url || grant.url;
    if (sourceUrl) {
      var src = document.createElement('div');
      src.className = 'gd-source';
      src.innerHTML = 'Official source: <a href="' + sourceUrl + '" target="_blank" rel="noopener">' + sourceUrl + '</a>';
      container.appendChild(src);
    }

    // Stale notice (30+ days old)
    if (detail.page_fetched_at) {
      var fetchedDate = new Date(detail.page_fetched_at);
      var daysSince = (Date.now() - fetchedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) {
        var stale = document.createElement('div');
        stale.className = 'gd-stale-notice';
        stale.textContent = 'This information was last verified on ' + formatDate(detail.page_fetched_at) + '. Grant pages change — visit the official source to confirm current details.';
        container.appendChild(stale);
      }
    }

    // ---- Section 1: Required Documents ----
    var docTitle = document.createElement('div');
    docTitle.className = 'gd-section-title';
    docTitle.textContent = 'REQUIRED DOCUMENTS';
    container.appendChild(docTitle);

    var disclaimer = document.createElement('div');
    disclaimer.className = 'gd-disclaimer';
    disclaimer.textContent = 'The Bridge has identified the following documents from the official grant page. We do not guarantee that every required document has been discovered. Always visit the official grant page using the link above to confirm you have everything you need before submitting.';
    container.appendChild(disclaimer);

    if (grant.fetch_failed) {
      var ff = document.createElement('div');
      ff.className = 'gd-text-muted';
      ff.textContent = 'Document information is not available for this grant. Visit the official grant page using the link above.';
      container.appendChild(ff);
    } else if (!detail.forms || detail.forms.length === 0) {
      var nf = document.createElement('div');
      nf.className = 'gd-text-muted';
      nf.textContent = 'We were unable to automatically identify downloadable forms for this grant. Visit the official grant page using the link above to find application documents.';
      container.appendChild(nf);
    } else {
      detail.forms.forEach(function(form) {
        var card = document.createElement('div');
        card.className = 'gd-form-card';
        var name = document.createElement('div');
        name.className = 'gd-form-name';
        name.textContent = form.name;
        card.appendChild(name);
        if (form.description) {
          var desc = document.createElement('div');
          desc.className = 'gd-form-desc';
          desc.textContent = form.description;
          card.appendChild(desc);
        }
        var dl = document.createElement('a');
        dl.className = 'gd-form-dl';
        dl.href = form.url;
        dl.target = '_blank';
        dl.rel = 'noopener';
        dl.textContent = 'Download form →';
        card.appendChild(dl);
        container.appendChild(card);
      });
    }

    // ---- Section 2: How to Submit ----
    var subTitle = document.createElement('div');
    subTitle.className = 'gd-section-title';
    subTitle.textContent = 'HOW TO SUBMIT';
    container.appendChild(subTitle);

    var submission = detail.submission || {};
    if (submission.method === 'online') {
      var onlineText = document.createElement('div');
      onlineText.className = 'gd-text';
      onlineText.textContent = 'This grant is submitted online.';
      container.appendChild(onlineText);
      if (submission.url) {
        var portalBtn = document.createElement('a');
        portalBtn.className = 'gd-btn-primary';
        portalBtn.href = submission.url;
        portalBtn.target = '_blank';
        portalBtn.rel = 'noopener';
        portalBtn.textContent = 'Go to submission portal →';
        portalBtn.style.marginTop = '8px';
        container.appendChild(portalBtn);
      }
    } else if (submission.method === 'email' && submission.email) {
      var emailText = document.createElement('div');
      emailText.className = 'gd-text';
      emailText.textContent = 'Submit your application by email to:';
      container.appendChild(emailText);
      var emailRow = document.createElement('div');
      emailRow.style.marginTop = '8px';
      var emailAddr = document.createElement('span');
      emailAddr.style.fontFamily = 'var(--font-data)';
      emailAddr.style.fontSize = '13px';
      emailAddr.textContent = submission.email;
      emailRow.appendChild(emailAddr);
      var copyBtn = document.createElement('button');
      copyBtn.className = 'gd-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', function() { copyToClipboard(submission.email, copyBtn); });
      emailRow.appendChild(copyBtn);
      container.appendChild(emailRow);
    } else if (submission.method === 'mail' && submission.address) {
      var mailText = document.createElement('div');
      mailText.className = 'gd-text';
      mailText.textContent = 'Submit your application by mail to:';
      container.appendChild(mailText);
      var addrDiv = document.createElement('div');
      addrDiv.className = 'gd-text';
      addrDiv.style.marginTop = '8px';
      addrDiv.style.whiteSpace = 'pre-line';
      addrDiv.textContent = submission.address;
      container.appendChild(addrDiv);
    } else {
      var noSub = document.createElement('div');
      noSub.className = 'gd-text-muted';
      noSub.textContent = 'Submission instructions were not found automatically. Visit the official grant page for submission details.';
      container.appendChild(noSub);
    }

    // ---- Section 3: Program Contact ----
    var contactTitle = document.createElement('div');
    contactTitle.className = 'gd-section-title';
    contactTitle.textContent = 'PROGRAM CONTACT';
    container.appendChild(contactTitle);

    var contact = detail.contact || {};
    if (contact.name || contact.email || contact.phone) {
      if (contact.name) {
        var nameRow = document.createElement('div');
        nameRow.className = 'gd-contact-row';
        nameRow.innerHTML = '<span class="gd-contact-label">NAME</span><br>' + contact.name;
        container.appendChild(nameRow);
      }
      if (contact.email) {
        var emailContactRow = document.createElement('div');
        emailContactRow.className = 'gd-contact-row';
        emailContactRow.innerHTML = '<span class="gd-contact-label">EMAIL</span><br>';
        var ceAddr = document.createElement('span');
        ceAddr.textContent = contact.email;
        emailContactRow.appendChild(ceAddr);
        var ceCopy = document.createElement('button');
        ceCopy.className = 'gd-copy-btn';
        ceCopy.textContent = 'Copy';
        ceCopy.addEventListener('click', function() { copyToClipboard(contact.email, ceCopy); });
        emailContactRow.appendChild(ceCopy);
        container.appendChild(emailContactRow);
      }
      if (contact.phone) {
        var phoneRow = document.createElement('div');
        phoneRow.className = 'gd-contact-row';
        phoneRow.innerHTML = '<span class="gd-contact-label">PHONE</span><br>' + contact.phone;
        container.appendChild(phoneRow);
      }
    } else {
      var noContact = document.createElement('div');
      noContact.className = 'gd-text-muted';
      noContact.textContent = 'No program contact information was found on the official grant page. Contact the awarding agency directly for questions.';
      container.appendChild(noContact);
    }

    // ---- Section 4: Match Analysis ----
    var matchTitle = document.createElement('div');
    matchTitle.className = 'gd-section-title';
    matchTitle.textContent = 'YOUR MATCH ANALYSIS';
    container.appendChild(matchTitle);

    var dims = grant.scoreDimensions || {};
    var dimLabels = {
      entityType: 'Entity type',
      revenue: 'Revenue eligibility',
      industry: 'Industry match',
      location: 'Location eligibility',
      demographic: 'Demographic bonus',
      registration: 'Registration status',
      fundUse: 'Fund use alignment'
    };

    var totalScore = 0;
    var totalMax = 0;

    Object.keys(dimLabels).forEach(function(key) {
      var dim = dims[key];
      if (!dim) return;
      totalScore += dim.score;
      totalMax += dim.max;

      var row = document.createElement('div');
      row.className = 'gd-score-row';
      var labelSpan = document.createElement('span');
      labelSpan.className = 'gd-score-label';
      labelSpan.textContent = dimLabels[key];
      row.appendChild(labelSpan);
      var valSpan = document.createElement('span');
      valSpan.className = 'gd-score-value ' + (dim.score === dim.max ? 'gd-score-full' : dim.score === 0 ? 'gd-score-zero' : 'gd-score-partial');
      valSpan.textContent = dim.score + '/' + dim.max;
      row.appendChild(valSpan);
      container.appendChild(row);
    });

    var totalRow = document.createElement('div');
    totalRow.className = 'gd-score-row gd-score-total';
    totalRow.innerHTML = '<span>TOTAL</span><span class="gd-score-value ' + (totalScore >= 90 ? 'gd-score-full' : 'gd-score-partial') + '">' + totalScore + '/' + totalMax + '</span>';
    container.appendChild(totalRow);

    // Improvements
    if (grant.gaps && grant.gaps.length > 0) {
      var improveList = document.createElement('ul');
      improveList.className = 'gd-improve-list';
      grant.gaps.forEach(function(gap) {
        var li = document.createElement('li');
        li.textContent = gap;
        improveList.appendChild(li);
      });
      container.appendChild(improveList);
    }

    // ---- Section 5: Application Tracking ----
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'gd-actions';

    var applyBtn = document.createElement('button');
    applyBtn.className = 'gd-btn-apply';
    applyBtn.textContent = 'I applied for this';
    applyBtn.addEventListener('click', function() { handleApply(grant, actionsDiv, applyBtn); });
    actionsDiv.appendChild(applyBtn);

    var receiveBtn = document.createElement('button');
    receiveBtn.className = 'gd-btn-received';
    receiveBtn.textContent = 'I received this grant';
    receiveBtn.disabled = true;
    actionsDiv.appendChild(receiveBtn);

    container.appendChild(actionsDiv);
  }

  async function handleApply(grant, actionsDiv, applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Saving...';

    try {
      var res = await fetch('/api/grant-radar/apply', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          grantName: grant.name,
          grantUrl: grant.url,
          grantAmountAvailable: grant.amount,
          dateApplied: new Date().toISOString().split('T')[0]
        })
      });
      if (!res.ok) throw new Error('Failed');

      applyBtn.textContent = 'Applied ✓';
      applyBtn.style.color = '#5a8a6a';
      applyBtn.style.borderColor = '#5a8a6a';

      // Enable receive button
      var recBtn = actionsDiv.querySelector('.gd-btn-received');
      if (recBtn) {
        recBtn.disabled = false;
        var appData = await res.json();
        recBtn.addEventListener('click', function() {
          alert('To claim and verify this grant win, go to Grant Radar results and use the "I received this grant" flow there.');
        });
      }
    } catch (e) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'I applied for this';
      alert('Failed to save. Try again.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
