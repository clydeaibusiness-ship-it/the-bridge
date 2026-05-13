/**
 * Grant Search Service — Claude API powered grant matching
 */
const { callClaude } = require('./claude');

const US_STATES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'DC': 'District of Columbia',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois',
  'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana',
  'ME': 'Maine', 'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
  'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon',
  'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota',
  'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia',
  'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
};

/**
 * Build the member profile summary from intake data
 */
function buildProfileSummary(intake) {
  const stateName = US_STATES[intake.state] || intake.state || 'Unknown state';
  const demographics = Array.isArray(intake.owner_demographics) ? intake.owner_demographics : [];

  const county = intake.county || '';

  return `
MEMBER BUSINESS PROFILE:
- Business name: ${intake.business_name || 'Not provided'}
- Business description: ${intake.business_description || 'Not provided'}
- Industry: ${intake.industry || 'Not specified'}
- NAICS code: ${intake.naics_code || 'Not provided — estimate from business description'}
- City: ${intake.city || 'Not provided'}
- County/Township: ${county || 'Not provided'}
- State: ${stateName}
- Legal entity type: ${intake.legal_entity || 'Not provided'}
- Annual revenue: ${intake.granular_revenue || intake.revenue_range || 'Not provided'}
- Team size: ${intake.team_size || 'Not provided'}
- Years in operation: ${intake.years_operating || 'Not provided'}
- Owner demographics: ${demographics.length > 0 ? demographics.join(', ') : 'None selected'}
- SAM.gov registered: ${intake.sam_registration || 'Unknown'}
- Primary use of grant funds: ${intake.grant_fund_use || 'Not specified'}
- Website content summary: ${intake.website_content ? intake.website_content.substring(0, 500) : 'No website scanned'}
- Differentiator: ${intake.differentiator || 'Not provided'}
- Challenge: ${intake.challenge || 'Not provided'}
  `.trim();
}

/**
 * Scan for grants matching the member's profile
 */
async function scanGrants(intake) {
  const profile = buildProfileSummary(intake);
  const stateName = US_STATES[intake.state] || intake.state || 'their state';
  const city = intake.city || 'their city';
  const county = intake.county || '';

  const prompt = `You are a grant research specialist with deep knowledge of the current landscape of federal, state, and local small business grants in the United States.

Using the member profile below, identify government grants they are likely eligible for. Search across:

1. FEDERAL: Grants.gov programs, SBA programs (Community Advantage, 8(a)), USDA programs (especially if rural), federal agency-specific grants (DOE, DOD, HHS, NSF, DOL, etc.)
2. STATE (${stateName}): State economic development agency grants, state small business programs, state-specific industry grants, state innovation funds, state workforce development grants
3. LOCAL (${city}${county ? ', ' + county : ''} and surrounding area): City, county, and township economic development grants, local business development incentives, community development block grants, local chamber programs, township-level grants

--- ELIGIBILITY EXCLUSION RULES (MANDATORY) ---

Do NOT surface any grant that requires ANY of the following unless the member's profile EXPLICITLY confirms they meet the criteria:

1. SBIR/STTR EXCLUSION: Do not surface SBIR or STTR grants unless the member's profile explicitly indicates they conduct formal research and development with documented methodology, have research partnerships, or have university affiliations. An AI platform, advisory service, software tool, service business, contractor, or retail business does NOT qualify for SBIR/STTR.

2. SAM.gov: If the member indicated they are NOT registered for SAM.gov, you may still surface grants requiring SAM.gov but you MUST flag it prominently and reduce the match percentage by at least 20 points.

3. REVENUE THRESHOLDS: If a grant requires revenue under a certain amount and the member's stated revenue exceeds it, exclude the grant entirely.

4. INDUSTRY MISMATCH: Do not surface agricultural grants for software companies, manufacturing grants for service businesses, or any grant whose industry requirements clearly do not match the member's business type.

5. WHEN IN DOUBT, EXCLUDE. A result that wastes the member's time is worse than no result. Quality over quantity on every scan.

--- MATCH PERCENTAGE RULES (MANDATORY) ---

The match percentage must reflect PRACTICAL eligibility, not surface-level keyword overlap.

For each unmet hard prerequisite (SAM.gov registration, R&D documentation, formal research partnerships, specific licensing, specific certifications), reduce the match percentage by at least 20 percentage points.

A grant with two or more unmet prerequisites CANNOT exceed 60% match regardless of other criteria alignment.

Only return grants with a final match percentage of 80% or higher AFTER applying these deductions.

--- URL RULES (MANDATORY) ---

For the "url" field: provide the most specific, direct URL to the actual open solicitation or application page — NOT the program homepage. The member should land on a page where they can immediately see the deadline, award amount, and application instructions.

Bad example: https://www.sbir.gov/ (homepage — member wastes 20 minutes)
Good example: https://ies.ed.gov/funding/research/programs/small-business-innovation-research-sbir/solicitation-information (specific solicitation page)

For each grant, also assess the URL quality and return a "link_quality" field with one of these exact values:
- "direct" — URL goes directly to the specific open solicitation or application form
- "program_page" — URL goes to a program page that contains a link to the current application
- "homepage" — URL is a top-level program homepage and the member will need to explore

If the link_quality is "homepage", append this sentence to the description: "Note: this link goes to the program homepage. Navigate to find the current open solicitation before applying."

--- GAPS / "WHAT WOULD BRING THIS TO 100%" RULES ---

Order gap items by EASE OF COMPLETION — quickest wins first, most difficult last.

For each gap item, include a plain-English time/effort estimate. Examples:
- "Register for SAM.gov — free, takes about 30 minutes"
- "Form an LLC — costs $50-$200 depending on state, takes 1-2 weeks"
- "Develop a technical research proposal — significant time investment, consider whether this grant is worth pursuing"

This helps the member decide whether to pursue the grant at all.

--- OUTPUT FORMAT ---

For each grant return a JSON object with these exact fields:
- "name": Official grant program name
- "url": The most specific direct URL to the open solicitation or application (NOT a homepage)
- "amount": Funding amount as a string (e.g. "$10,000", "Up to $500,000", "Varies")
- "description": Two sentences maximum. Plain English. What the grant is for and who it primarily serves. If link_quality is "homepage", append the navigation note.
- "matchPercent": Integer 80-100 AFTER applying prerequisite deductions
- "jurisdiction": Exactly one of "Federal", "State", "Local"
- "status": Exactly one of "Open now", "Rolling applications", or a deadline string like "Deadline: June 30, 2025" or "Closed — check back January 2026"
- "requirements": Array of strings — key eligibility requirements
- "memberMeets": Array of strings — which requirements the member already satisfies
- "gaps": Array of strings — ordered by ease of completion (quickest first), each with a time/effort estimate
- "requiresSAM": Boolean — true if SAM.gov registration is needed
- "link_quality": Exactly one of "direct", "program_page", or "homepage"

${intake.legal_entity === 'Nonprofit — 501(c)(3)' ? 'Include nonprofit-specific grants (foundation grants, 501(c)(3) federal programs) alongside or instead of for-profit results.' : ''}

Only include grants that are currently open, have rolling applications, or have a known reopening date within 6 months. Aim for 5-15 total results across all three jurisdictions.

Return ONLY a valid JSON array. No markdown, no backticks, no prose outside the JSON.

${profile}`;

  const response = await callClaude(prompt);

  try {
    // Extract JSON array from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const results = JSON.parse(jsonMatch[0]);
      // Organize by jurisdiction
      return {
        federal: results.filter(g => g.jurisdiction === 'Federal'),
        state: results.filter(g => g.jurisdiction === 'State'),
        local: results.filter(g => g.jurisdiction === 'Local'),
        stateName,
        city,
        county
      };
    }
    return { federal: [], state: [], local: [], stateName, city, county };
  } catch (e) {
    console.error('Failed to parse grant results:', e.message);
    console.error('Raw response:', response.substring(0, 500));
    return { federal: [], state: [], local: [], stateName, city, county };
  }
}

module.exports = { scanGrants };
