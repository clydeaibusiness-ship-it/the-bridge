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
    max_tokens: 1000,
    system: fullSystem,
    messages: [{ role: 'user', content: userContent }]
  });

  return response.content[0].text;
}

/**
 * Intake personalization — generates ship name, destination, flavor text
 */
async function personalizeIntake(intakeAnswers) {
  const prompt = `A player has completed the business intake form. Based on their answers below and the Big Book of Strategy framework, generate exactly four things in JSON format with no other text:
1. "ship_name": A name for their business that reflects their industry and ambition. Two words maximum. Should feel distinctive.
2. "destination_name": A name for their destination — the success state they described. Three words maximum. Should feel like a milestone.
3. "industry_key": A snake_case key identifying their industry (e.g. "lawn_care", "consulting", "real_estate", "trades", "retail", "food_service", "professional_services", "construction"). Pick the closest match.
4. "flavor_text": Two sentences maximum. Address the business owner directly. Acknowledge their specific situation. Make them feel seen. Do not give advice yet. Do not mention the framework by name.

Player answers:
${JSON.stringify(intakeAnswers, null, 2)}`;

  const response = await callClaude(prompt);

  try {
    // Extract JSON from response (handle markdown code blocks)
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
      flavor_text: 'Your ship awaits, Captain. The course is yours to set.'
    };
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
 * Commander chat — strategic advice with full business context
 */
async function commanderChat(message, gameState, runHistory) {
  const context = `The captain's current ship state:
${JSON.stringify(gameState, null, 2)}

Their run history:
${JSON.stringify(runHistory, null, 2)}`;

  return await callClaude(message, context);
}

module.exports = {
  callClaude,
  personalizeIntake,
  generateDebrief,
  commanderChat
};
