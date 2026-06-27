/**
 * qualify.js — turns a pile of GDELT articles into ranked candidate STORIES.
 *
 * The cross-spectrum rule from the spec: a story only qualifies when the same
 * fact shows up across outlets of differing political lean. If it only appears
 * on one side, it gets dropped. That stripped-out partisanship is the whole
 * non-partisan filter.
 *
 * Articles are clustered by headline similarity, then each cluster is judged on
 * how many distinct lean buckets and outlets it spans.
 */

const STOPWORDS = new Set(
  ('a an the of to in on for and or but with as at by from is are was were be been being this that these those it its ' +
    'how why what when who will would could should can may might said says new amid over under into out up down off ' +
    'his her their our your they them he she we you i us not no yes more most less than then so if about after before')
    .split(' ')
);

/** Tokenize a headline into a set of meaningful lowercase words. */
function tokenize(title) {
  return new Set(
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Greedy clustering: each article joins the first cluster whose representative
 * headline is similar enough, otherwise it starts a new cluster.
 */
function cluster(articles, threshold = 0.34) {
  const clusters = [];
  for (const art of articles) {
    const tokens = tokenize(art.title);
    if (tokens.size === 0) continue;
    let placed = false;
    for (const c of clusters) {
      if (jaccard(tokens, c.tokens) >= threshold) {
        c.articles.push(art);
        // Grow the representative token set so the cluster stays cohesive.
        for (const t of tokens) c.tokens.add(t);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ tokens: new Set(tokens), articles: [art] });
  }
  return clusters;
}

/** Pick the cleanest headline in a cluster (prefer a lean-mapped outlet). */
function pickHeadline(articles) {
  const mapped = articles.filter((a) => a.lean);
  const pool = mapped.length ? mapped : articles;
  // Longest title tends to be the most complete/least truncated.
  return pool.slice().sort((a, b) => (b.title || '').length - (a.title || '').length)[0].title;
}

function recencyScore(articles) {
  // seendate like "20260627T120000Z"; newer = higher.
  const times = articles
    .map((a) => Date.parse((a.seendate || '').replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z')))
    .filter((t) => !Number.isNaN(t));
  if (!times.length) return 0;
  const newest = Math.max(...times);
  const ageHours = (Date.now() - newest) / 3.6e6;
  return Math.max(0, 48 - ageHours) / 48; // 1.0 brand new, 0 at 48h+
}

/**
 * Qualify and rank stories.
 * @returns {Array} candidate stories, best first. Each:
 *   { headline, categoryId, categoryLabel, sources, leanBuckets, distinctDomains, crossSpectrum, score }
 */
function qualifyStories(articles, { minLeanBuckets = 2 } = {}) {
  const clusters = cluster(articles);

  const stories = clusters.map((c) => {
    const domains = new Set(c.articles.map((a) => a.domain));
    const leanBuckets = new Set(c.articles.map((a) => a.lean).filter(Boolean));
    // Dominant category = the categoryId most represented in the cluster.
    const catCount = {};
    for (const a of c.articles) catCount[a.categoryId] = (catCount[a.categoryId] || 0) + 1;
    const categoryId = Object.keys(catCount).sort((x, y) => catCount[y] - catCount[x])[0];
    const categoryLabel = c.articles.find((a) => a.categoryId === categoryId)?.categoryLabel || '';

    const crossSpectrum = leanBuckets.size >= minLeanBuckets;
    const score =
      leanBuckets.size * 3 + // cross-spectrum agreement weighs most
      Math.min(domains.size, 8) + // breadth of coverage
      recencyScore(c.articles) * 4; // freshness

    return {
      headline: pickHeadline(c.articles),
      categoryId,
      categoryLabel,
      sources: c.articles.map((a) => ({ domain: a.domain, lean: a.lean, url: a.url, title: a.title })),
      leanBuckets: [...leanBuckets],
      distinctDomains: domains.size,
      crossSpectrum,
      score: Math.round(score * 100) / 100,
    };
  });

  // Cross-spectrum stories first, then by score.
  return stories.sort((a, b) => {
    if (a.crossSpectrum !== b.crossSpectrum) return a.crossSpectrum ? -1 : 1;
    return b.score - a.score;
  });
}

module.exports = { qualifyStories, cluster, tokenize, jaccard };
