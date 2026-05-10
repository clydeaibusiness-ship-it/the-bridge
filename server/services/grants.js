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

  return `
MEMBER BUSINESS PROFILE:
- Business name: ${intake.business_name || 'Not provided'}
- Business description: ${intake.business_description || 'Not provided'}
- Industry: ${intake.industry || 'Not specified'}
- NAICS code: ${intake.naics_code || 'Not provided — estimate from business description'}
- City: ${intake.city || 'Not provided'}
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

  const prompt = `You are a grant research specialist with deep knowledge of the current landscape of federal, state, and local small business grants in the United States.

Using the member profile below, identify government grants they are likely eligible for with an 80% match or higher. Search across:

1. FEDERAL: Grants.gov programs, SBA programs (including SBIR/STTR, Community Advantage, 8(a)), USDA programs (especially if rural), federal agency-specific grants (DOE, DOD, HHS, NSF, DOL, etc.)
2. STATE (${stateName}): State economic development agency grants, state small business programs, state-specific industry grants, state innovation funds, state workforce development grants
3. LOCAL (${city} and surrounding county): City and county economic development grants, local business development incentives, community development block grants, local chamber programs

For each grant return a JSON object with these exact fields:
- "name": Official grant program name
- "url": The official URL where the member can find the application or program details
- "amount": Funding amount as a string (e.g. "$10,000", "Up to $500,000", "Varies")
- "description": Two sentences maximum. Plain English. What the grant is for and who it primarily serves.
- "matchPercent": Integer 80-100 based on how well the member's profile fits
- "jurisdiction": Exactly one of "Federal", "State", "Local"
- "status": Exactly one of "Open now", "Rolling applications", or a deadline string like "Deadline: June 30, 2025" or "Closed — check back January 2026"
- "requirements": Array of strings — key eligibility requirements
- "memberMeets": Array of strings — which requirements the member already satisfies
- "gaps": Array of strings — what the member would need to change or add to reach 100%. Only include actionable gaps. Never include demographic or structural gaps that cannot be changed. Frame every gap as an achievable step.
- "requiresSAM": Boolean — true if SAM.gov registration is needed

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
        city
      };
    }
    return { federal: [], state: [], local: [], stateName, city };
  } catch (e) {
    console.error('Failed to parse grant results:', e.message);
    console.error('Raw response:', response.substring(0, 500));
    return { federal: [], state: [], local: [], stateName, city };
  }
}

module.exports = { scanGrants };
