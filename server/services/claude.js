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
 * Read strategy book only — used by, intake, debrief, summaries.
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
 * Used by intake, debrief, summaries — NOT Commander/Chart.
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
 * Commander chat — strategic advice with full business context.
 * Now supports conversation history passed as messages array.
 */
async function commanderChat(message, gameState, sessionContext, conversationHistory, summaryContext, sessionNotesContext, persist = {}) {
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

  // Tools the Commander can call.
  // fetch_case_study: read-only retrieval, executed and returned to the model.
  // save_action_step: side-effecting, persists the member's commitment.
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
    },
    {
      name: 'save_action_step',
      description: "Call this when the member commits to a specific, concrete action they will take before your next conversation. Save it in their exact words, not your paraphrase. Do not invent action steps the member did not volunteer, and never save more than two in a single conversation. After saving, confirm to the member in your own voice.",
      input_schema: {
        type: 'object',
        properties: {
          step_text: {
            type: 'string',
            description: "The action the member committed to, in their exact words"
          },
          target_date: {
            type: 'string',
            description: "Optional target completion date in YYYY-MM-DD form, only if the member gave one"
          }
        },
        required: ['step_text']
      }
    }
  ];

  // Tool loop: keep returning tool results until the model produces a final
  // text answer (or we hit the safety guard). Handles multiple tools per turn.
  let response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    system: fullSystem,
    messages,
    tools
  });

  let guard = 0;
  while (guard < 4) {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length === 0) break;
    guard++;
    const toolResults = [];

    for (const block of toolUseBlocks) {
      if (block.name === 'fetch_case_study') {
        const story = await fetchCaseStudyStory(block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: story || 'No matching case study found.'
        });
      } else if (block.name === 'save_action_step') {
        if (persist && persist.userId) {
          try {
            const { saveActionStep } = require('./supabase');
            await saveActionStep(
              persist.userId,
              block.input.step_text,
              persist.sessionId || null,
              block.input.target_date || null
            );
          } catch (asErr) {
            console.error('save_action_step error:', asErr.message);
          }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Action step saved.'
        });
      } else {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'OK.'
        });
      }
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: fullSystem,
      messages,
      tools
    });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  return stripMarkdown(textBlock ? textBlock.text : '');
}

/**
 * Score the case study library against the model's lever/problem tags and
 * return the best-matching story formatted for a tool_result, or '' if none.
 */
async function fetchCaseStudyStory(inputTags) {
  try {
    const { getClient } = require('./supabase');
    const db = getClient();
    if (!db) return '';

    const { data } = await db
      .from('case_studies')
      .select('title, source_book, source_author, story, lever_tags, problem_tags');

    if (!data || data.length === 0) return '';

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

    if (bestMatch && bestScore > 0) {
      return `[Case Study: ${bestMatch.title} — from ${bestMatch.source_book} by ${bestMatch.source_author}]\n${bestMatch.story}`;
    }
    return '';
  } catch (csErr) {
    console.error('Case study fetch error:', csErr.message);
    return '';
  }
}

/**
 * Background debrief (Haiku) — runs after a Commander response without
 * blocking the member-facing reply. Produces a short member-facing summary,
 * a meaningful-shift signal, and one unresolved thread for the next session.
 * Returns { summary, shift_detected, unresolved_item }.
 */
async function generateSessionDebrief(conversationMessages) {
  const formatted = conversationMessages.map(m => {
    const role = (m.role || m.message_role) === 'user' ? 'Member' : 'Commander';
    return `${role}: ${m.content || m.message_content}`;
  }).join('\n\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 400,
    system: 'You are quietly reflecting on a conversation between a small-business owner (Member) and their advisor (Commander). Return only a JSON object, no markdown, no backticks, no prose.',
    messages: [{
      role: 'user',
      content: `From this conversation, return JSON exactly in this shape:
{
  "summary": "two or three sentences, written for the member, naming what was decided or uncovered",
  "shift_detected": true or false — true only if the member reported completing something significant, described a notable change, or began asking a qualitatively different kind of question than before,
  "unresolved_item": "one open thread to surface at the start of the next session, or null if nothing is open"
}

Conversation:
${formatted}`
    }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('generateSessionDebrief: non-JSON response: ' + text.substring(0, 200));
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * Periodic report (every ~28 days) — a short 3-5 sentence reflection letter
 * from the Commander, in voice, naming what has shifted, what is still
 * unresolved, and what it is watching for next. Built from the benchmark arc,
 * action step history, and recent session debriefs.
 */
async function generatePeriodicReport({ memberName, benchmarks = [], actionSteps = [], debriefs = [] }) {
  const benchLines = benchmarks.map(b =>
    `- "${b.statement}" — started at ${b.starting_rating ?? '?'}/10, now ${b.current_rating ?? b.starting_rating ?? '?'}/10`
  ).join('\n') || '(no benchmarks set yet)';

  const completed = actionSteps.filter(a => a.status === 'completed');
  const active = actionSteps.filter(a => a.status === 'active');
  const actionSummary =
    `Completed ${completed.length}, still open ${active.length}.` +
    (completed.length ? '\nRecently completed: ' + completed.slice(0, 3).map(a => `"${a.step_text}"`).join('; ') : '') +
    (active.length ? '\nStill open: ' + active.slice(0, 3).map(a => `"${a.step_text}"`).join('; ') : '');

  const debriefLines = debriefs.slice(0, 6).map(d => `- ${d.summary}`).join('\n') || '(no session reflections yet)';

  const prompt = `Write a short reflection letter to ${memberName || 'this member'} as the Commander. Three to five sentences. Name what has shifted since they started, what is still unresolved, and what you are watching for next. Speak in your own voice — direct, warm, specific to what you see below. Do not use headers, bullet points, or a signature. Do not mention ratings as numbers; speak to the movement behind them.

Their success statements and movement:
${benchLines}

Action steps:
${actionSummary}

Recent session reflections:
${debriefLines}`;

  const soulPrimer = getSoulPrimer();
  const messages = [
    ...(soulPrimer ? [{ role: 'user', content: '.' }, { role: 'assistant', content: soulPrimer }] : []),
    { role: 'user', content: prompt }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return stripMarkdown(textBlock ? textBlock.text : '');
}

/**
 * Interviewing Commander — generate one follow-up question (Haiku) in the
 * soul voice when an answer is judged vague. No strategy library, no case
 * studies — just the voice and the instruction.
 */
async function generateIntakeFollowUp(questionText, answer, instruction) {
  const soul = getSoulPrimer();
  const prompt = `You are interviewing a small business owner, one question at a time. You just asked: "${questionText}". They answered: "${answer}". ${instruction}

Ask exactly one short follow-up question in your own voice. Output only the question — no preamble, no explanation, nothing else.`;

  const messages = [
    ...(soul ? [{ role: 'user', content: '.' }, { role: 'assistant', content: soul }] : []),
    { role: 'user', content: prompt }
  ];

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    messages
  });
  const t = response.content.find(b => b.type === 'text');
  return stripMarkdown(t ? t.text : '').trim();
}

/**
 * Generate the initial benchmark after Stage 2: 3-5 success statements in the
 * member's own language, each with a low starting 1-10 rating, plus a hidden
 * operational-metrics object for the Commander's context.
 * `answers` is a { field: text } map of intake responses.
 * Returns { statements: [{ statement, starting_rating }], hidden_metrics: {} }.
 */
async function generateBenchmark(answers) {
  const get = (f) => (answers && answers[f]) ? answers[f] : '';

  const prompt = `A member has completed enough of their intake to set their benchmark. Using their own words, write 3 to 5 success statements that capture what they are working toward. Each statement must be drawn directly from what they said — not reworded into abstractions. If they said "take a Saturday off without everything falling apart," that is the statement, not "operational independence."

Give each statement a starting rating from 1 to 10 reflecting where they are NOW (these should be low — they reflect the current gap, not the goal).

Also return a hidden_metrics object summarizing their operational baseline for internal use.

Return ONLY JSON, no markdown:
{
  "statements": [ { "statement": "their words", "starting_rating": 3 } ],
  "hidden_metrics": {
    "annual_revenue": "", "knows_break_even": "", "cash_runway": "",
    "raised_prices": "", "knows_margin": "", "customer_concentration": "",
    "time_trapped": "", "isolation": ""
  }
}

What they want from The Bridge: ${get('desired_outcome')}
Their three-to-five year vision: ${get('north_star')}
What their actual life would look like in success: ${get('life_success_definition')}

Operational baseline:
- Annual revenue: ${get('annual_revenue')}
- Break-even known: ${get('break_even')}
- Cash runway: ${get('cash_runway')}
- Raised prices recently: ${get('pricing_history')}
- Profit margin known: ${get('profit_margin')}
- Customer concentration: ${get('customer_concentration')}
- Time usage: ${get('time_usage')}
- Support network: ${get('support_network')}
- Peer network: ${get('peer_network')}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    system: 'You extract a member benchmark from intake answers. Use the member\'s own language. Return only a JSON object — no markdown, no backticks, no prose.',
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('generateBenchmark: non-JSON response: ' + text.substring(0, 200));
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.statements)) parsed.statements = [];
  // Clamp to 3-5 and sane ratings.
  parsed.statements = parsed.statements.slice(0, 5).map(s => ({
    statement: String(s.statement || '').trim(),
    starting_rating: Math.min(10, Math.max(1, parseInt(s.starting_rating, 10) || 2))
  })).filter(s => s.statement);
  return parsed;
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
  commanderChat,
  generateConversationSummary,
  generateChart,
  getSoulVersion,
  getSoulPrimer,
  compressSession,
  generateSessionDebrief,
  generatePeriodicReport,
  generateIntakeFollowUp,
  generateBenchmark
};

