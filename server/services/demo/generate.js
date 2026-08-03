/**
 * demo/generate.js — turn a prospect company's public info into a briefed Earl.
 *
 * Given a company name, a website (and optional Facebook page), and whatever the
 * owner already knows, this scrapes the public pages and generates the three
 * things a demo shows: a business context (how Earl understands the company), a
 * Navigation Chart (a real strategic read), and Earl's First Read. It reuses the
 * exact generators the real intake uses, so a demo Earl reasons about the
 * prospect the same way a member's Earl would.
 */

const {
  personalizeIntake, generateChartFromInterview, generateFirstRead,
} = require('../claude');

/** Fetch a URL and strip it to plain text. Mirrors /api/intake/scan-urls. */
async function fetchAndExtract(url) {
  if (!url || !url.trim()) return '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url.trim(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheBridge/1.0)' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return '';
    const html = await resp.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3500);
  } catch (e) {
    console.log(`[demo] scan failed for ${url}: ${e.message}`);
    return '';
  }
}

/** The answer map the intake generators expect, assembled from demo inputs. */
function toAnswers({ companyName, websiteUrl, notes, scanned }) {
  return {
    businessName: companyName,
    website_url: websiteUrl || '',
    what_i_know_about_this_business: notes || '',
    website_content: scanned.websiteContent || '',
    facebook_content: scanned.facebookContent || '',
  };
}

/**
 * Build a full draft: scrape, then generate business context + chart + first
 * read in parallel. Returns everything the owner reviews before publishing.
 */
async function buildDraft({ companyName, websiteUrl, facebookUrl, notes }) {
  const [websiteContent, facebookContent] = await Promise.all([
    fetchAndExtract(websiteUrl),
    fetchAndExtract(facebookUrl),
  ]);
  const scanned = { websiteContent, facebookContent };
  const answers = toAnswers({ companyName, websiteUrl, notes, scanned });

  const [personalized, chartSections, firstRead] = await Promise.all([
    personalizeIntake(answers).catch((e) => { console.error('[demo] personalize:', e.message); return {}; }),
    generateChartFromInterview(answers).catch((e) => { console.error('[demo] chart:', e.message); return []; }),
    generateFirstRead(answers).catch((e) => { console.error('[demo] firstRead:', e.message); return ''; }),
  ]);

  const businessContext = personalized.businessContext || {
    businessType: '', clientType: '', serviceType: '',
    assetType: '', competitorThreat: '', growthConstraint: '', primaryUncertainty: '',
  };

  return {
    scanned_content: scanned,
    business_context: businessContext,
    chart_sections: Array.isArray(chartSections) ? chartSections : [],
    first_read: firstRead || '',
  };
}

/**
 * The briefing block passed to commanderChat as the demo Earl's context, so he
 * speaks specifically about this company. No member memory exists (this is a
 * prospect, not a member), so this data block IS his knowledge of them.
 */
function buildDemoContext(demo) {
  const bc = demo.business_context || {};
  const parts = [`You are speaking with someone from ${demo.company_name}.`];

  const bcLines = Object.entries(bc)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}: ${v}`);
  if (bcLines.length) parts.push('WHAT YOU KNOW ABOUT THEIR BUSINESS:\n' + bcLines.join('\n'));

  if (demo.notes) parts.push(`ADDITIONAL CONTEXT THE OWNER GAVE YOU:\n${demo.notes}`);

  if (Array.isArray(demo.chart_sections) && demo.chart_sections.length) {
    const chart = demo.chart_sections
      .map((s) => `${s.title}: ${s.body}`)
      .join('\n');
    parts.push('YOUR STRATEGIC READ OF THEM (the Navigation Chart you already drew):\n' + chart);
  }

  parts.push(
    'This is a first conversation. You have been briefed on their business from public information, so some details may be rough or incomplete. Speak to what you genuinely see, ask about what you are unsure of, and be specific to THEIR business. If they correct a detail, take it.'
  );

  return parts.join('\n\n');
}

module.exports = { buildDraft, buildDemoContext, fetchAndExtract };
