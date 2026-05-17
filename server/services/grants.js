/**
 * Grant Search Service — Claude extracts & structures grant data,
 * then calculateGrantMatch scores mathematically.
 *
 * Flow:
 * 1. Claude searches for grant opportunities and returns structured eligibility data
 * 2. calculateGrantMatch scores each grant against member profile (pure math)
 * 3. Only grants scoring 80+ (with no hard disqualifiers) are returned
 * 4. Server fetches each qualifying grant URL for detail_data
 */
const { callClaude } = require('./claude');
const { calculateGrantMatch, buildMemberProfile } = require('./grant-scoring');
const { fetchGrantDetailsBatch } = require('./grant-detail-fetcher');

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
 * Build profile summary for Claude's grant search.
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
- Annual revenue: $${(intake.exact_revenue || intake.granular_revenue || 0).toLocaleString()}
- Team size: ${intake.exact_employee_count || intake.team_size || 'Not provided'}
- Years in operation: ${intake.years_operating || 'Not provided'}
- Owner demographics: ${demographics.length > 0 ? demographics.join(', ') : 'None selected'}
- SAM.gov registered: ${intake.sam_registration || 'Unknown'}
- Primary use of grant funds: ${intake.grant_fund_use || 'Not specified'}
- Website content summary: ${intake.website_content ? intake.website_content.substring(0, 500) : 'No website scanned'}
- Differentiator: ${intake.differentiator || 'Not provided'}
- Challenge: ${intake.challenge || 'Not provided'}
- Community service programs: ${intake.community_service_programs || 'Not provided'}
  `.trim();
}

/**
 * Scan for grants — Claude finds opportunities, scoring function scores them.
 */
async function scanGrants(intake, grantRadarIntake) {
  const profile = buildProfileSummary(intake);
  const stateName = US_STATES[intake.state] || intake.state || 'their state';
  const city = intake.city || 'their city';
  const county = intake.county || '';

  // Build member profile for scoring
  const memberProfile = buildMemberProfile(intake, grantRadarIntake);

  const prompt = `You are a grant research specialist. Using the member profile below, identify government grants they may be eligible for. Search across federal (Grants.gov, SBA, USDA, etc.), state (${stateName}), and local (${city}${county ? ', ' + county : ''}) programs.

CRITICAL: You are NOT scoring or matching. You are finding grants and extracting their eligibility criteria in a structured format. A separate scoring engine will determine match percentages mathematically. Your job is accurate data extraction.

ACCURACY IS PARAMOUNT: Only include grant programs you are confident actually exist as real, named federal or state programs. If you cannot find real grants that match this profile, return an EMPTY ARRAY []. Returning zero results is correct behavior when no real grants exist. Inventing or hallucinating grant programs that do not exist is the worst possible outcome — a real person will click these links and waste hours on dead ends.

--- EXCLUSION RULES ---
1. Do NOT include SBIR/STTR unless the profile explicitly indicates formal R&D activity.
2. Only include grants that are currently open, have rolling applications, or reopen within 6 months.
3. Quality over quantity — 0 to 20 results. Zero is a valid answer.
4. GRANTS ONLY — Do NOT include loans, microloans, loan guarantees, or any program that requires repayment. SBA loans, USDA loans, CDC/504 loans, and similar debt instruments are NOT grants. If the word "loan" appears in the program name or description, exclude it.
5. DIRECT FUNDING ONLY — Do NOT include mentoring programs, counseling services, training workshops, business advisory centers, or outreach programs that do not provide direct monetary awards to the applicant. Programs like SCORE mentoring, Veterans Business Outreach Centers (VBOC), Small Business Development Centers (SBDC), and similar advisory services are NOT grants.
6. Every result must be a program that directly awards free money (a grant, cooperative agreement, or cash award) to the applicant with no repayment obligation.
7. Every URL must point to a real government website (.gov domain preferred). Do not guess URLs — if you are unsure of the exact URL, use the main program page on the awarding agency's website.

--- OUTPUT FORMAT ---

Return ONLY a valid JSON array. No markdown, no backticks, no prose outside the JSON.

For each grant return this exact structure:
{
  "name": "Official grant program name",
  "url": "Most specific direct URL to the solicitation or application page",
  "amount": "Funding amount as string (e.g. '$10,000', 'Up to $500,000', 'Varies')",
  "description": "Two sentences max. What the grant is for and who it serves.",
  "jurisdiction": "Federal" | "State" | "Local",
  "status": "Open now" | "Rolling applications" | "Deadline: June 30, 2025" | "Closed — check back January 2026",
  "requiresSAM": true | false,

  "eligibility": {
    "entityTypes": ["LLC", "S-Corporation", "Sole proprietorship", "Nonprofit", "Any"],
    "revenueMin": null,
    "revenueMax": null,
    "eligibleNAICS": ["541512", "541519"],
    "eligibleIndustries": ["technology", "software", "information services"],
    "eligibleLocations": ["Nationwide"] or ["Oklahoma", "Texas"],
    "demographicPriorities": ["woman-owned", "minority-owned"] or [],
    "requiresEIN": true,
    "requiresSAM": true,
    "eligibleUses": ["hiring employees", "purchasing equipment", "research and development"]
  },

  "link_quality": "direct" | "program_page" | "homepage"
}

For eligibility fields:
- revenueMin/revenueMax: exact dollar integers or null if no limit. Extract from the grant text. Example: if grant says "businesses with less than $1 million in annual revenue" then revenueMax = 1000000.
- entityTypes: list all explicitly eligible types. Use "Any" if no restriction stated.
- eligibleNAICS: specific NAICS codes if stated. Empty array if not specified.
- eligibleIndustries: industry keywords if stated. Empty array if any industry qualifies.
- eligibleLocations: ["Nationwide"] if no geographic restriction, otherwise list states/regions.
- demographicPriorities: only include if grant explicitly prioritizes certain demographics.
- eligibleUses: what the grant funds can be used for.

If a field is not specified in the grant, use null for numbers and empty arrays for lists. Do NOT guess — only extract what the grant explicitly states.

${profile}`;

  const response = await callClaude(prompt);

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('No JSON array found in Claude response');
      return { federal: [], state: [], local: [], stateName, city, county };
    }

    const rawGrants = JSON.parse(jsonMatch[0]);

    // ---- SCORE EACH GRANT MATHEMATICALLY ----
    const scoredGrants = [];

    for (const grant of rawGrants) {
      const grantCriteria = {
        eligibleEntityTypes: grant.eligibility?.entityTypes || [],
        revenueMin: grant.eligibility?.revenueMin,
        revenueMax: grant.eligibility?.revenueMax,
        eligibleNAICS: grant.eligibility?.eligibleNAICS || [],
        eligibleIndustries: grant.eligibility?.eligibleIndustries || [],
        eligibleLocations: grant.eligibility?.eligibleLocations || [],
        demographicPriorities: grant.eligibility?.demographicPriorities || [],
        requiresSAM: grant.eligibility?.requiresSAM !== false,
        requiresEIN: grant.eligibility?.requiresEIN !== false,
        eligibleUses: grant.eligibility?.eligibleUses || []
      };

      const scoreResult = calculateGrantMatch(memberProfile, grantCriteria);

      // Only include if score >= 80 and no hard disqualifiers
      if (!scoreResult.excluded && scoreResult.totalScore >= 80) {
        scoredGrants.push({
          name: grant.name,
          url: grant.url,
          amount: grant.amount,
          description: grant.description,
          jurisdiction: grant.jurisdiction,
          status: grant.status,
          requiresSAM: grant.requiresSAM,
          link_quality: grant.link_quality || 'program_page',
          // Scoring data (calculated, not Claude-generated)
          matchPercent: scoreResult.totalScore,
          scoreDimensions: scoreResult.dimensions,
          gaps: scoreResult.improvements,
          memberMeets: Object.entries(scoreResult.dimensions)
            .filter(([, v]) => v.score === v.max)
            .map(([, v]) => v.detail),
          requirements: Object.entries(scoreResult.dimensions)
            .map(([k, v]) => `${k}: ${v.detail}`)
        });
      }
    }

    // Sort by match percentage descending
    scoredGrants.sort((a, b) => b.matchPercent - a.matchPercent);

    // ---- FETCH DETAIL DATA for each qualifying grant ----
    const grantsWithDetails = await fetchGrantDetailsBatch(scoredGrants);

    // Organize by jurisdiction
    return {
      federal: grantsWithDetails.filter(g => g.jurisdiction === 'Federal'),
      state: grantsWithDetails.filter(g => g.jurisdiction === 'State'),
      local: grantsWithDetails.filter(g => g.jurisdiction === 'Local'),
      stateName,
      city,
      county
    };
  } catch (e) {
    console.error('Failed to parse/score grant results:', e.message);
    return { federal: [], state: [], local: [], stateName, city, county };
  }
}

module.exports = { scanGrants };
