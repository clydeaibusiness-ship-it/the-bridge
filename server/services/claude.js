const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Strip markdown formatting from Commander responses.
 * The chat window doesn't render markdown, so remove it server-side
 * to avoid stray asterisks and hash symbols in plain text.
 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')       // *italic* → italic
    .replace(/^#{1,3}\s+/gm, '')       // ### headers → nothing
    .replace(/^[\-•]\s+/gm, '')        // - or • bullets → clean lines
    .trim();
}

/**
 * Compute a short hash of soul.md content.
 * Used to tag messages so we know which soul version they belong to.
 * When soul.md changes, old assistant messages stop being sent to the API
 * — the Commander immediately adopts the new personality.
 */
function getSoulVersion() {
  try {
    const soulPath = path.join(__dirname, '../../system/soul.md');
    const content = fs.readFileSync(soulPath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 12);
  } catch (err) {
    return 'no-soul';
  }
}

/**
 * Read strategy book only — used by simulator, intake, debrief, summaries.
 */
function getStrategyPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '../../system/big-book-of-strategy.md'),
    'utf8'
  );
}

/**
 * Read soul.md and return as a string for assistant prefill.
 * When passed as the first assistant message, the model treats it
 * as something it already said — continuing from that identity
 * rather than deciding whether to adopt it.
 */
function getSoulPrimer() {
  try {
    const soul = fs.readFileSync(
      path.join(__dirname, '../../system/soul.md'),
      'utf8'
    );
    console.log('Soul primer loaded. First 50 chars:', soul.substring(0, 50));
    return soul;
  } catch (err) {
    console.error('SOUL PRIMER ERROR:', err.message);
    return ''; // empty string fallback — Commander will still work, just without soul
  }
}

/**
 * Read the compressed case study index from case-study-index.md.
 * Only the index section loads — not the full stories.
 */
function getCaseStudyIndex() {
  try {
    const fullFile = fs.readFileSync(
      path.join(__dirname, '../../system/case-study-index.md'),
      'utf8'
    );
    // Extract only the compressed index section
    const indexStart = fullFile.indexOf('## COMPRESSED INDEX');
    const indexEnd = fullFile.indexOf('## FULL STORIES');
    if (indexStart === -1) return '';
    const indexSection = indexEnd > indexStart
      ? fullFile.substring(indexStart, indexEnd)
      : fullFile.substring(indexStart);
    return indexSection.trim();
  } catch (err) {
    console.error('CASE STUDY INDEX ERROR:', err.message);
    return '';
  }
}

/**
 * Read Big Book of Strategy + compressed case study index.
 * Used as system prompt for Commander chat (soul is now in assistant prefill).
 * User context is appended by the caller.
 */
function getSystemPrompt() {
  try {
    const strategy = fs.readFileSync(
      path.join(__dirname, '../../system/big-book-of-strategy.md'),
      'utf8'
    );
    const caseStudyIndex = getCaseStudyIndex();
    if (caseStudyIndex) {
      return strategy + '\n\n---\n\nCASE STUDY LIBRARY — Available for retrieval when relevant:\n\n' + caseStudyIndex;
    }
    return strategy;
  } catch (err) {
    console.error('STRATEGY PROMPT ERROR:', err.message);
    return '';
  }
}

/**
 * Call Claude with strategy-only system context.
 * Used by simulator, intake, debrief, summaries — NOT Commander/Chart.
 */
async function callClaude(userContent, additionalContext = '') {
  const systemPrompt = getStrategyPrompt();
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
async function commanderChat(message, gameState, runHistory, sessionContext, conversationHistory, summaryContext, sessionNotesContext) {
  // Build pure data context — no behavioral instructions.
  // The soul file is the ONLY source of behavioral directives.
  let context = '';
  if (sessionNotesContext) {
    context += sessionNotesContext + '\n\n';
  }
  if (summaryContext) {
    context += `Summary of previous conversation:\n${summaryContext}\n\n`;
  }
  if (sessionContext) {
    context += sessionContext + '\n\n';
  }
  const hasRunHistory = runHistory && runHistory.length > 0;
  if (hasRunHistory) {
    context += `Previous simulator runs:\n${JSON.stringify(runHistory, null, 2)}\n\n`;
  }

  const systemPrompt = getSystemPrompt();
  const fullSystem = context
    ? `${systemPrompt}\n\n---\n\n${context}`
    : systemPrompt;

  const soulPrimer = getSoulPrimer();

  // Build messages array: silent user prime, soul prefill, then history, then new message.
  // Anthropic API requires the first message to be role:user.
  const messages = [
    ...(soulPrimer ? [
      { role: 'user', content: '.' },
      { role: 'assistant', content: soulPrimer }
    ] : []),
    ...(conversationHistory || []),
    { role: 'user', content: message }
  ];

  // Debug: log role sequence so future issues are immediately visible in Railway logs
  console.log('Commander message roles:', messages.map(m => m.role).join(' → '));

  // Case study retrieval tool
  const tools = [
    {
      name: 'fetch_case_study',
      description: 'Fetch the full story of a relevant case study from the library when a story would help the member feel understood or when a strategic claim needs grounding. Only call this when a case study would genuinely serve the moment — not to perform knowledge.',
      input_schema: {
        type: 'object',
        properties: {
          lever_tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lever names from the Big Book of Strategy that are relevant to this moment'
          },
          problem_tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Problem type descriptors that match what the member is facing'
          }
        },
        required: ['lever_tags', 'problem_tags']
      }
    }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: fullSystem,
    messages,
    tools
  });

  // Check if the Commander wants to fetch a case study
  const toolUseBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'fetch_case_study');

  if (toolUseBlock) {
    // Fetch the case study from Supabase
    let caseStudyText = '';
    try {
      const { getClient } = require('./supabase');
      const db = getClient();
      if (db) {
        const { data } = await db
          .from('case_studies')
          .select('title, source_book, source_author, story, lever_tags, problem_tags');

        if (data && data.length > 0) {
          const inputTags = toolUseBlock.input;
          let bestMatch = null;
          let bestScore = 0;

          for (const cs of data) {
            let score = 0;
            if (inputTags.lever_tags && cs.lever_tags) {
              for (const tag of inputTags.lever_tags) {
                if (cs.lever_tags.some(lt => lt.toLowerCase() === tag.toLowerCase())) score += 2;
              }
            }
            if (inputTags.problem_tags && cs.problem_tags) {
              for (const tag of inputTags.problem_tags) {
                const tagLower = tag.toLowerCase();
                if (cs.problem_tags.some(pt => pt.toLowerCase().includes(tagLower) || tagLower.includes(pt.toLowerCase()))) score += 1;
              }
            }
            if (score > bestScore) { bestScore = score; bestMatch = cs; }
          }

          if (bestMatch) {
            caseStudyText = `[Case Study: ${bestMatch.title} — from ${bestMatch.source_book} by ${bestMatch.source_author}]\n${bestMatch.story}`;
          }
        }
      }
    } catch (csErr) {
      console.error('Case study fetch error:', csErr.message);
    }

    // Send the tool result back to get the final response
    const textBlock = response.content.find(b => b.type === 'text');
    const followUp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: fullSystem,
      messages: [
        ...messages,
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: caseStudyText || 'No matching case study found.'
          }]
        }
      ],
      tools
    });

    const finalText = followUp.content.find(b => b.type === 'text');
    return stripMarkdown(finalText ? finalText.text : (textBlock ? textBlock.text : ''));
  }

  // No tool call — return text directly
  const textBlock = response.content.find(b => b.type === 'text');
  return stripMarkdown(textBlock ? textBlock.text : '');
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

  // Navigation Chart keeps soul in system prompt (no prefill pattern here)
  const soulContent = getSoulPrimer();
  const strategyContent = getSystemPrompt();
  const chartSystemPrompt = soulContent
    ? `${soulContent}\n\n---\n\n${strategyContent}`
    : strategyContent;
  const fullSystem = additionalContext
    ? `${chartSystemPrompt}\n\n---\n\nAdditional context from the player's web presence:${additionalContext}`
    : chartSystemPrompt;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    system: fullSystem,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return JSON.parse(text);
}

/**
 * Extract structured knowledge from a completed Commander session.
 * Called when 30+ minutes of inactivity ends a session.
 * Returns { operator_insights, strategic_ground, unresolved_threads }
 */
async function compressSession(conversationMessages) {
  const formatted = conversationMessages.map(m => {
    const role = m.message_role === 'user' ? 'Member' : 'Commander';
    return `${role}: ${m.message_content}`;
  }).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: 'You are extracting meaningful knowledge from a business advisory conversation. Be precise and brief. Return only a JSON object with no markdown, no backticks, no prose.',
    messages: [{
      role: 'user',
      content: `Extract the following from this conversation and return as JSON:\n{\n  "operator_insights": [array of strings — personal observations about who this person is, how they think, what drives them, what they avoid],\n  "strategic_ground": [array of strings — specific levers discussed, recommendations made, decisions reached],\n  "unresolved_threads": [array of strings — open questions, problems named but not solved, things left hanging]\n}\n\nConversation:\n${formatted}`
    }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('compressSession: Claude returned non-JSON response: ' + text.substring(0, 200));
  }
  return JSON.parse(jsonMatch[0]);
}

module.exports = {
  callClaude,
  personalizeIntake,
  generateSituation,
  generateDebrief,
  commanderChat,
  generateConversationSummary,
  generateChart,
  getSoulVersion,
  getSoulPrimer,
  compressSession
};
