const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Read the Big Book of Strategy at call time (not startup)
 * so owner edits take effect immediately
 */
function getSystemPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '../../system/big-book-of-strategy.md'),
    'utf8'
  );
}

/**
 * Call Claude with the strategy framework as system context
 */
async function callClaude(userContent, additionalContext = '') {
  const systemPrompt = getSystemPrompt();
  const fullSystem = additionalContext
    ? `${systemPrompt}\n\n---\n\n${additionalContext}`
    : systemPrompt;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: fullSystem,
    messages: [{ role: 'user', content: userContent }]
  });

  return response.content[0].text;
}

/**
 * Intake personalization — generates ship name, destination, flavor text, and businessContext
 */
async function personalizeIntake(intakeAnswers) {
  const prompt = `A player has completed the business intake form. Based on their answers below and the Big Book of Strategy framework, generate a JSON object with no other text containing these fields:

1. "ship_name": A name for their business that reflects their industry and ambition. Two words maximum. Should feel distinctive.
2. "destination_name": A name for their destination — the success state they described. Three words maximum. Should feel like a milestone.
3. "industry_key": A snake_case key identifying their industry (e.g. "lawn_care", "consulting", "real_estate", "trades", "retail", "food_service", "professional_services", "construction"). Pick the closest match.
4. "flavor_text": Two sentences maximum. Address the business owner directly. Acknowledge their specific situation. Make them feel seen. Do not give advice yet. Do not mention the framework by name.
5. "businessContext": An object with these exact keys, each a short plain-English phrase derived from the player's answers:
   - "businessType": what they do (e.g. "commercial landscaping", "independent restaurant", "SaaS product for accountants")
   - "clientType": what their customers are called (e.g. "commercial property manager", "regular guest", "accounting firm")
   - "serviceType": what they deliver (e.g. "grounds maintenance contract", "dining experience", "software subscription")
   - "assetType": their most critical operational asset (e.g. "equipment", "kitchen", "software infrastructure")
   - "competitorThreat": what a competing business looks like (e.g. "national franchise", "chain restaurant", "larger software company")
   - "growthConstraint": what limits their growth (e.g. "crew capacity", "kitchen capacity", "engineering bandwidth")
   - "primaryUncertainty": pulled directly from their challenge/uncertainty answer

If the player provided a "businessName" field in their answers, use that exact name as the "ship_name" instead of generating one.

Player answers:
${JSON.stringify(intakeAnswers, null, 2)}`;

  const response = await callClaude(prompt);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(response);
  } catch (e) {
    console.error('Failed to parse intake personalization:', e.message);
    return {
      ship_name: 'The Venture',
      destination_name: 'North Star',
      flavor_text: 'Your business is waiting. The decisions ahead are yours to make.',
      businessContext: null
    };
  }
}

/**
 * Generate a single personalized situation using Claude API
 */
async function generateSituation(businessContext, situationNumber, previousThemes) {
  const themes = [
    'operational crisis requiring capital vs relationship tradeoff',
    'competitive threat requiring positioning vs price decision',
    'growth ceiling requiring systems decision',
    'client retention requiring information asymmetry response',
    'pricing decision under competitive pressure'
  ];

  const availableThemes = themes.filter(t => !previousThemes.includes(t));

  const prompt = `Generate a single business strategy situation for the simulator. Return ONLY a JSON object with no other text.

Player's business context:
${JSON.stringify(businessContext, null, 2)}

This is situation ${situationNumber} of 5.

Strategic theme for this situation: ${availableThemes[0] || themes[situationNumber - 1]}
Themes already covered: ${previousThemes.length ? previousThemes.join(', ') : 'none'}

CRITICAL RULES:
- Use the player's specific business type ("${businessContext.businessType}") and context throughout EVERY sentence — not generic business language
- The client type is "${businessContext.clientType}", service is "${businessContext.serviceType}", asset is "${businessContext.assetType}"
- Present a real strategic decision with no obviously correct answer
- Generate exactly 4 options (A, B, C, D)
- Each option must have different lever implications
- Include effect tags showing capital cost/gain and percentage changes to relevant levers
- Each option gets an outcomeType: "clean", "partial", or "missed"
- Include a case study for each option drawn from a NAMED real business or NAMED book — no unnamed statistics
- Use ONLY Big Book of Strategy framework language in outcomes — never game language
- At least one option should be "clean" and at least one should be "missed"

Return this exact JSON structure:
{
  "id": ${situationNumber},
  "title": "Short descriptive title",
  "turnLabel": "Situation ${situationNumber} of 5",
  "body": "2-4 sentences describing the situation using the player's specific business context",
  "crewComment": "1-2 sentences of strategic observation",
  "theme": "the theme string used",
  "options": [
    {
      "id": "A",
      "body": "What the player would do — 2-3 sentences using their business language",
      "tags": [
        { "text": "Capital +/-$X", "lever": "capital" },
        { "text": "LeverName +/-X%", "lever": "leverKey" }
      ],
      "difficulty": 1 or 2,
      "exceptional": true or false,
      "outcomeType": "clean" or "partial" or "missed",
      "outcomeBody": "3-5 sentences explaining what happened using framework language",
      "caseStudy": {
        "label": "What [Book/Source] says",
        "body": "2-3 sentences referencing a specific named book or business"
      },
      "resourceChanges": { "capital": 0, "customers": 0, "positioning": 0, "switchingCosts": 0 }
    }
  ]
}

resourceChanges must ONLY use these 4 keys: capital, customers, positioning, switchingCosts.
Capital changes should be realistic dollar amounts (-5000 to +5000 range).
Percentage changes for positioning/switchingCosts should be -20 to +20 range.
Customer changes should be -3 to +6 range.
Tags can reference other levers (informationAsymmetry, networkEffects, systems, habitDesign) for display but those do NOT go in resourceChanges.`;

  const response = await callClaude(prompt);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(response);
  } catch (e) {
    console.error('Failed to parse generated situation:', e.message);
    throw new Error('Parse failure');
  }
}

/**
 * Run-end debrief — generates Navigation Chart lite
 */
async function generateDebrief(runHistory, intakeAnswers) {
  const prompt = `A captain's ship has been destroyed. Based on their full run history below and the Big Book of Strategy framework, produce a structured debrief in the following exact format. Be direct, specific, and compassionate. Reference their actual decisions, not generic advice.

## What Destroyed Your Ship
One paragraph. Name the specific lever gap that caused the fatal hit. Explain what that means for their real business in plain English.

## The Pattern
One paragraph. Looking across all threats they encountered, what is the underlying strategic weakness this run revealed? Name the lever. Name the consequence.

## The One Thing
One sentence. The single most important lever they should raise before their next run — and why.

## A Real Business Did This
Two to three sentences. A specific case study of a real business that faced the same lever gap, what happened to them, and what they did about it.

## Your Next Run
One paragraph. What would a smarter configuration look like given what they now know? Do not give them the answer — give them the question to ask themselves.

Captain's run history:
${JSON.stringify(runHistory, null, 2)}

Captain's intake answers:
${JSON.stringify(intakeAnswers, null, 2)}`;

  return await callClaude(prompt);
}

/**
 * Commander chat — strategic advice with full business context.
 * Now supports conversation history passed as messages array.
 */
async function commanderChat(message, gameState, runHistory, sessionContext, conversationHistory, summaryContext) {
  let context = '';
  if (summaryContext) {
    context += `Summary of previous conversation:\n${summaryContext}\n\n`;
  }
  if (sessionContext) {
    context += sessionContext + '\n\n';
  }
  context += `The player's current game state:
${JSON.stringify(gameState, null, 2)}

Their run history:
${JSON.stringify(runHistory, null, 2)}

IMPORTANT: The player has already completed their intake. You have their full business context above. Do NOT ask them what business they are in, what they do, their revenue, team size, or any intake questions. Jump straight into strategic advice using the Big Book of Strategy framework. Address them directly and reference their specific business context in every response.`;

  // If we have conversation history, use multi-turn messages
  if (conversationHistory && conversationHistory.length > 0) {
    const systemPrompt = getSystemPrompt();
    const fullSystem = context
      ? `${systemPrompt}\n\n---\n\n${context}`
      : systemPrompt;

    // Build messages array: history + new message
    const messages = [
      ...conversationHistory,
      { role: 'user', content: message }
    ];

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: fullSystem,
      messages
    });

    return response.content[0].text;
  }

  return await callClaude(message, context);
}

/**
 * Generate a summary of a conversation for long-term context
 */
async function generateConversationSummary(messages) {
  const formatted = messages.map(m =>
    `${m.role === 'user' ? 'Member' : 'Commander'}: ${m.content}`
  ).join('\n\n');

  const prompt = `Summarize this conversation between a business owner (Member) and their strategic advisor (Commander) in exactly three sentences. Focus on: what was discussed, what was decided or recommended, and any action items. Be specific to their business.\n\nConversation:\n${formatted}`;

  return await callClaude(prompt);
}

/**
 * Generate Navigation Chart from intake answers + businessContext
 */
async function generateChart(businessContext, intakeAnswers, scannedContent) {
  let additionalContext = '';
  if (scannedContent) {
    if (scannedContent.websiteContent) {
      additionalContext += `\n\nContent scraped from the player's website:\n${scannedContent.websiteContent}`;
    }
    if (scannedContent.facebookContent) {
      additionalContext += `\n\nContent scraped from the player's Facebook page:\n${scannedContent.facebookContent}`;
    }
  }

  const prompt = `Generate a Navigation Chart — a strategic assessment for this business owner. Return ONLY a JSON object with no other text.

Business context:
${JSON.stringify(businessContext, null, 2)}

Intake answers:
${JSON.stringify(intakeAnswers, null, 2)}
${additionalContext ? '\nAdditional context scraped from the player\'s own public web presence — use this to make the personalization more specific and accurate:' + additionalContext : ''}

Return this exact JSON structure with 6 sections. Each section has a "title" and "body". Write 3-5 sentences per body. Be direct, specific, reference their actual business. Use Big Book of Strategy framework language.

{
  "sections": [
    { "title": "Ship Status", "body": "Current state of the business based on everything they told you" },
    { "title": "Kill Risk", "body": "The single most dangerous vulnerability that could destroy this business in the next 12 months" },
    { "title": "Lever Map", "body": "Which of the 8 strategic levers are strong, which are weak, and which are missing entirely" },
    { "title": "Leverage Sequence", "body": "The specific order in which they should address their lever gaps" },
    { "title": "What to Stop", "body": "What they are currently doing that is actively hurting their strategic position" },
    { "title": "90-Day Focus", "body": "Exactly one thing to focus on for the next 90 days and what measurable outcome to target" }
  ]
}`;

  const response = await callClaude(prompt);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return JSON.parse(response);
}

module.exports = {
  callClaude,
  personalizeIntake,
  generateSituation,
  generateDebrief,
  commanderChat,
  generateConversationSummary,
  generateChart
};
