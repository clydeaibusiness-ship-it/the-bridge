/**
 * Grant Detail Fetcher — fetches official grant pages and extracts
 * forms, submission info, contact info, and deadline.
 */

const FORM_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
const FORM_DOMAINS = ['forms.gov', 'grants.gov/forms'];

/**
 * Fetch a grant URL and extract detail_data.
 * Returns the detail_data object or null on failure.
 */
async function fetchGrantDetails(grantUrl) {
  if (!grantUrl) return { fetchFailed: true, detailData: {} };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(grantUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TheBridge/1.0; +https://captainsbridge.io)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.log(`Grant detail fetch failed for ${grantUrl}: HTTP ${resp.status}`);
      return { fetchFailed: true, detailData: {} };
    }

    const html = await resp.text();
    return { fetchFailed: false, detailData: extractDetailsFromHTML(html, grantUrl) };
  } catch (e) {
    console.log(`Grant detail fetch error for ${grantUrl}: ${e.message}`);
    return { fetchFailed: true, detailData: {} };
  }
}

/**
 * Extract structured detail data from raw HTML.
 */
function extractDetailsFromHTML(html, sourceUrl) {
  const detail = {
    forms: [],
    submission: { method: null, url: null, email: null, address: null },
    contact: { name: null, email: null, phone: null },
    deadline: null,
    notes: null,
    page_fetched_at: new Date().toISOString(),
    source_url: sourceUrl
  };

  // ---- Extract form links ----
  // Match <a> tags with href pointing to downloadable forms
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const seenUrls = new Set();

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const linkText = match[2].replace(/<[^>]+>/g, '').trim();

    // Check if it's a downloadable form
    const isForm = FORM_EXTENSIONS.some(ext => href.toLowerCase().endsWith(ext)) ||
      FORM_DOMAINS.some(domain => href.toLowerCase().includes(domain));

    if (isForm && !seenUrls.has(href)) {
      seenUrls.add(href);
      // Resolve relative URLs
      let fullUrl = href;
      if (href.startsWith('/')) {
        try {
          const base = new URL(sourceUrl);
          fullUrl = base.origin + href;
        } catch (e) { /* keep as-is */ }
      } else if (!href.startsWith('http')) {
        try {
          fullUrl = new URL(href, sourceUrl).href;
        } catch (e) { /* keep as-is */ }
      }

      detail.forms.push({
        name: linkText || guessFormName(href),
        url: fullUrl,
        description: guessFormDescription(linkText, href)
      });
    }
  }

  // ---- Extract submission method ----
  const htmlLower = html.toLowerCase();

  // Check for Grants.gov submission
  if (htmlLower.includes('grants.gov') && (htmlLower.includes('submit') || htmlLower.includes('apply'))) {
    detail.submission.method = 'online';
    // Look for apply link
    const applyMatch = html.match(/href\s*=\s*["'](https?:\/\/[^"']*(?:apply|submit)[^"']*)["']/i);
    if (applyMatch) {
      detail.submission.url = applyMatch[1];
    } else {
      detail.submission.url = sourceUrl;
    }
  }

  // Check for email submission
  const emailSubmitMatch = html.match(/(?:submit|send|email)\s*(?:to|at|:)\s*(?:<[^>]+>)*\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (emailSubmitMatch && !detail.submission.method) {
    detail.submission.method = 'email';
    detail.submission.email = emailSubmitMatch[1];
  }

  // ---- Extract contact info ----
  // Look for email addresses in contact sections
  const contactEmails = html.match(/(?:contact|program\s*officer|point\s*of\s*contact|poc)[^]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (contactEmails) {
    detail.contact.email = contactEmails[1];
  }

  // Look for phone numbers
  const phoneMatch = html.match(/(?:phone|tel|call)[^]*?(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/i);
  if (phoneMatch) {
    detail.contact.phone = phoneMatch[1];
  }

  // Look for contact name
  const nameMatch = html.match(/(?:contact|program\s*officer|poc)[^]*?(?:name|:)\s*([A-Z][a-z]+ [A-Z][a-z]+)/);
  if (nameMatch) {
    detail.contact.name = nameMatch[1];
  }

  // ---- Extract deadline ----
  const deadlineMatch = html.match(/(?:deadline|due\s*date|close[sd]?|closing)[^]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})/i);
  if (deadlineMatch) {
    detail.deadline = deadlineMatch[1].trim();
  }

  // ---- Extract notes ----
  // Look for eligibility notes
  const eligMatch = html.match(/(?:eligib|requir|must\s*be)[^.]*\./gi);
  if (eligMatch && eligMatch.length > 0) {
    detail.notes = eligMatch.slice(0, 3).join(' ').replace(/<[^>]+>/g, '').trim();
    if (detail.notes.length > 500) detail.notes = detail.notes.substring(0, 500) + '...';
  }

  return detail;
}

/**
 * Guess a form name from the URL if link text is empty.
 */
function guessFormName(url) {
  const filename = url.split('/').pop().split('?')[0];
  const name = filename.replace(/[-_]/g, ' ').replace(/\.\w+$/, '');
  if (name.match(/^sf.?424/i)) return 'SF-424 Application for Federal Assistance';
  if (name.match(/^sf.?425/i)) return 'SF-425 Federal Financial Report';
  if (name.match(/^sf.?lll/i)) return 'SF-LLL Disclosure of Lobbying Activities';
  return name || 'Application Form';
}

/**
 * Guess a form description from context.
 */
function guessFormDescription(linkText, url) {
  const lower = (linkText + ' ' + url).toLowerCase();
  if (lower.includes('sf-424') || lower.includes('sf424')) return 'Required for all federal grant applications';
  if (lower.includes('sf-425') || lower.includes('sf425')) return 'Financial reporting form';
  if (lower.includes('budget')) return 'Budget detail or justification form';
  if (lower.includes('narrative') || lower.includes('abstract')) return 'Project narrative or abstract';
  if (lower.includes('assurance') || lower.includes('certification')) return 'Assurances and certifications';
  return '';
}

/**
 * Fetch details for multiple grants in parallel (with concurrency limit).
 */
async function fetchGrantDetailsBatch(grants, concurrency = 3) {
  const results = [];
  for (let i = 0; i < grants.length; i += concurrency) {
    const batch = grants.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (grant) => {
        const { fetchFailed, detailData } = await fetchGrantDetails(grant.url);
        return { ...grant, detail_data: detailData, fetch_failed: fetchFailed };
      })
    );
    results.push(...batchResults);
  }
  return results;
}

module.exports = {
  fetchGrantDetails,
  fetchGrantDetailsBatch,
  extractDetailsFromHTML
};
