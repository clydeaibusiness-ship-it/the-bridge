/**
 * sources.js — the survival taxonomy and the political-lean map.
 *
 * Newsletter Earl never pulls "top business news" and digs for a small-business
 * angle. He queries GDELT one survival topic at a time, so small-business
 * relevance is the INPUT, not a hoped-for output. A story can only be missed
 * if its topic is not a category below — so the categories are the thing to
 * get right, not the source.
 *
 * Each category becomes one GDELT query. The qualify step then keeps only
 * stories that appear across outlets of differing political lean.
 */

// ---------------------------------------------------------------------------
// The survival taxonomy. Every Mon/Wed/Fri run queries each of these.
// `query` is GDELT DOC 2.0 search syntax. Keep them tight to the lever that
// actually decides whether a Main Street business stays open.
// ---------------------------------------------------------------------------
const CATEGORIES = [
  {
    id: 'interest_rates',
    label: 'Interest rates and the Fed (cost of borrowing)',
    query: '("interest rates" OR "federal reserve" OR "rate cut" OR "rate hike" OR "fed decision")',
  },
  {
    id: 'small_business_lending',
    label: 'Small-business lending, SBA, credit availability',
    query: '("small business" (loan OR lending OR credit OR SBA))',
  },
  {
    id: 'wages_labor_law',
    label: 'Minimum wage, labor law, wage changes',
    query: '("minimum wage" OR "overtime rule" OR "labor law" OR "wage increase")',
  },
  {
    id: 'tariffs_trade',
    label: 'Tariffs, trade, import and supplier costs',
    query: '(tariff OR tariffs OR "import costs" OR "trade policy" OR "supply costs")',
  },
  {
    id: 'small_business_taxes',
    label: 'Taxes hitting small business',
    query: '("small business" (tax OR taxes OR deduction OR "tax filing" OR payroll))',
  },
  {
    id: 'consumer_spending',
    label: 'Consumer spending and confidence (demand)',
    query: '("consumer spending" OR "consumer confidence" OR "retail sales" OR "consumer demand")',
  },
  {
    id: 'inflation_costs',
    label: 'Inflation and input costs',
    query: '(inflation OR "producer prices" OR "cost of goods" OR "input costs")',
  },
  {
    id: 'energy_fuel',
    label: 'Energy and fuel costs',
    query: '("energy prices" OR "fuel costs" OR "gas prices" OR "electricity prices" OR "utility costs")',
  },
  {
    id: 'health_insurance',
    label: 'Health insurance and benefits costs',
    query: '("health insurance" (premium OR "small business" OR "employer")) ',
  },
  {
    id: 'commercial_rent',
    label: 'Commercial rent and real estate',
    query: '("commercial rent" OR "commercial real estate" OR "retail space" OR "lease costs")',
  },
  {
    id: 'payment_processing',
    label: 'Payment processing and card fees',
    query: '("swipe fees" OR "interchange fees" OR "credit card processing" OR "payment processing")',
  },
  {
    id: 'hiring_labor',
    label: 'Hiring, labor availability, unemployment',
    query: '("labor shortage" OR "hiring" OR "unemployment rate" OR "jobs report" OR "labor market")',
  },
  {
    id: 'regulation_compliance',
    label: 'Regulation and compliance aimed at small firms',
    query: '("small business" (regulation OR compliance OR mandate OR "new rule"))',
  },
  {
    id: 'supply_chain',
    label: 'Supply chain disruption',
    query: '("supply chain" (disruption OR shortage OR delay OR backlog))',
  },
  {
    id: 'insurance_costs',
    label: 'Insurance costs (property, liability)',
    query: '("business insurance" OR "property insurance" OR "liability insurance" OR "insurance premiums")',
  },
  {
    id: 'ai_small_business',
    label: 'AI and automation affecting small business',
    query: '("artificial intelligence" OR "AI tools" OR automation) ("small business" OR jobs OR workers OR "small businesses")',
  },
];

// ---------------------------------------------------------------------------
// Political-lean map. Domain → bucket. This powers the cross-spectrum filter:
// a story qualifies only when it shows up across at least two DIFFERENT
// buckets, so a fact that only one side is carrying gets dropped.
//
// Buckets follow common media-bias classifications (AllSides-style) at the
// outlet level. This is a starting set of major US outlets; it can grow.
// ---------------------------------------------------------------------------
const LEAN = {
  // left / lean-left
  'nytimes.com': 'left',
  'washingtonpost.com': 'left',
  'cnn.com': 'left',
  'msnbc.com': 'left',
  'nbcnews.com': 'left',
  'theguardian.com': 'left',
  'vox.com': 'left',
  'politico.com': 'left',
  'businessinsider.com': 'left',
  'huffpost.com': 'left',
  'cnbc.com': 'left', // news lean-left; still useful as one bucket

  // center
  'reuters.com': 'center',
  'apnews.com': 'center',
  'bbc.com': 'center',
  'bbc.co.uk': 'center',
  'thehill.com': 'center',
  'axios.com': 'center',
  'marketwatch.com': 'center',
  'bloomberg.com': 'center',
  'usatoday.com': 'center',
  'forbes.com': 'center',
  'cbsnews.com': 'center',
  'abcnews.go.com': 'center',
  'csmonitor.com': 'center',
  'newsnationnow.com': 'center',

  // right / lean-right
  'wsj.com': 'right', // news center-right; opinion right
  'foxbusiness.com': 'right',
  'foxnews.com': 'right',
  'nypost.com': 'right',
  'washingtontimes.com': 'right',
  'washingtonexaminer.com': 'right',
  'realclearmarkets.com': 'right',
  'nationalreview.com': 'right',
  'thedispatch.com': 'right',
  'epochtimes.com': 'right',
};

/**
 * Look up a domain's lean bucket. Strips a leading "www." and lowercases.
 * Returns 'left' | 'center' | 'right' | null (null = unknown outlet).
 */
function leanOf(domain) {
  if (!domain) return null;
  const d = String(domain).toLowerCase().replace(/^www\./, '');
  return LEAN[d] || null;
}

module.exports = { CATEGORIES, LEAN, leanOf };
