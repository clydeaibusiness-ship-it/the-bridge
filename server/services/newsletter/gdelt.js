/**
 * gdelt.js — pulls articles from GDELT's free DOC 2.0 API, one survival
 * category at a time. No API key, no cost.
 *
 * Each article comes back tagged with its category and its political-lean
 * bucket so the qualify step can run the cross-spectrum check.
 */

const { CATEGORIES, leanOf } = require('./sources');

const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one category from GDELT.
 * Returns an array of normalized article records, or [] on any failure
 * (a single category failing never sinks the whole run).
 */
async function fetchCategory(category, { timespan = '2d', maxRecords = 100, sort = 'hybridrel', retries = 3 } = {}) {
  // Restrict to US English coverage so the lean map and survival framing apply.
  const fullQuery = `${category.query} sourcelang:english sourcecountry:US`;
  const params = new URLSearchParams({
    query: fullQuery,
    mode: 'artlist',
    maxrecords: String(maxRecords),
    timespan,
    format: 'json',
    // hybridrel blends relevance and recency, which surfaces the major
    // outlets the cross-spectrum filter needs better than pure datedesc.
    sort,
  });
  const url = `${GDELT_ENDPOINT}?${params.toString()}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'captainsbridge-newsletter/1.0 (Earl)' },
      });
      // GDELT rate-limits with 429. Back off and retry rather than give up.
      if (res.status === 429) {
        if (attempt < retries) {
          // GDELT asks for one request every 5 seconds. Back off past that.
          const wait = 6000 * (attempt + 1);
          console.warn(`[gdelt] ${category.id}: 429, backing off ${wait}ms`);
          await sleep(wait);
          continue;
        }
        console.warn(`[gdelt] ${category.id}: 429 after ${retries} retries, skipping`);
        return [];
      }
      if (!res.ok) {
        console.warn(`[gdelt] ${category.id}: HTTP ${res.status}`);
        return [];
      }
      const text = await res.text();
      // GDELT occasionally returns an HTML error page instead of JSON.
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.warn(`[gdelt] ${category.id}: non-JSON response, skipping`);
        return [];
      }
      const articles = Array.isArray(data.articles) ? data.articles : [];
      return articles.map((a) => ({
        title: (a.title || '').trim(),
        url: a.url,
        domain: a.domain,
        lean: leanOf(a.domain),
        seendate: a.seendate,
        categoryId: category.id,
        categoryLabel: category.label,
      }));
    } catch (err) {
      if (attempt < retries) {
        const wait = 6000 * (attempt + 1);
        console.warn(`[gdelt] ${category.id}: ${err.message}, retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      console.warn(`[gdelt] ${category.id}: ${err.message}`);
      return [];
    }
  }
  return [];
}

/**
 * Fetch every survival category. Sequential with a small delay to be a good
 * citizen on a free API. Three runs a week, so the ~15s total is a non-issue.
 *
 * Returns a flat array of all articles across all categories.
 */
async function fetchAll({ timespan = '2d', maxRecords = 100, sort = 'hybridrel', delayMs = 5500 } = {}) {
  const all = [];
  for (const category of CATEGORIES) {
    const batch = await fetchCategory(category, { timespan, maxRecords, sort });
    all.push(...batch);
    // GDELT allows one request per 5 seconds; space the category calls out.
    if (delayMs) await sleep(delayMs);
  }
  console.log(`[gdelt] pulled ${all.length} articles across ${CATEGORIES.length} categories`);
  return all;
}

module.exports = { fetchCategory, fetchAll };
