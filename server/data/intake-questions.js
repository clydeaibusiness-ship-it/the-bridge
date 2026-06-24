/**
 * The Interviewing Earl — question set and flow control.
 *
 * Source of truth for the conversational intake. Each question maps to exactly
 * one field saved in intake_responses. The server drives the flow from this
 * module; the page only renders what the server returns.
 *
 * Vagueness check is two-stage:
 *   1. Rule-based string check (free) — `check` below.
 *   2. If the answer is judged vague AND the follow-up is `kind: 'api'`, a
 *      Haiku call generates one follow-up question in the soul voice.
 * After a follow-up is answered, the next question always appears.
 */

// Stage framing messages (shown once before the first question of each stage).
const STAGE_FRAMING = {
  1: `Before anything else, a few basics. These first questions are straightforward and take about five minutes. Once you finish this stage you can start talking with Earl right away.

The more honest your answers are throughout this entire interview, the less likely Earl is to give you advice that sounds good on paper but does not fit your actual situation. There is no right answer to any of these questions. The goal is accuracy, not impressiveness.`,
  2: `This stage goes into the operational reality of your business. Some of these questions will ask you to look at numbers you might not look at often. Some will ask you to be honest about things that are not working.

That discomfort is the point. Earl cannot help you with what it cannot see. The people who tend to get the most out of their conversations are the ones who are straight here, even when the answers are not what they wish they were.

Take your time with these.`,
  3: `This last stage is the most personal. These questions go deeper than most business tools ever ask, and some of them may take a moment to sit with before you answer honestly.

Earl uses what you share here to understand the fuller context of who you are and what you are actually carrying, not to give you life advice, but so that the business advice it gives you fits your real life rather than some version of it that looks good on a strategy document.

The more honest you are here, the less generic Earl becomes. Take your time.`
};

// Stage completion messages (shown after the last question of each stage).
const STAGE_COMPLETE = {
  1: `That is enough to get started. Your Navigation Chart is being built from what you just shared. Head to Earl. It is ready for you. Whenever you want to go deeper, Stage 2 is waiting here.`,
  2: `Your Navigation Chart just got significantly more complete. Earl now has the operational context it needs to give you specific direction. Stage 3 is the most personal stage and the most important one. Take it when you are ready.`,
  3: `That is everything. Your Navigation Chart is complete. Earl now has the full picture. Go have a real conversation.`
};

/**
 * Questions. `check` describes the string vagueness rule:
 *   minWords    — vague if fewer than this many words
 *   banned      — vague if the lowercased answer contains any of these
 *   needNumber  — vague if there is no digit
 *   needTimeRef — vague if there is no number or time word
 *   custom      — special handling keys (see isVague in the route)
 * `followup.kind` is 'none' | 'string' | 'api'.
 *   string: `template` interpolates [answer] with the member's words.
 *   api:    `instruction` guides the Haiku-generated follow-up.
 */
const QUESTIONS = [
  // ---------------- STAGE 1 — Quick Start ----------------
  { n: 1, stage: 1, field: 'member_name',
    question: 'What is your name?',
    check: null, followup: { kind: 'none' } },

  { n: 2, stage: 1, field: 'business_name',
    question: 'What is the name of your business?',
    check: null, followup: { kind: 'none' } },

  { n: 3, stage: 1, field: 'business_description',
    question: 'In two or three sentences, what does your business do and what do you sell?',
    check: { minWords: 10 },
    followup: { kind: 'string', template: 'You mentioned [answer]. Who specifically pays you for that and what exactly are they getting?' } },

  { n: 4, stage: 1, field: 'primary_customer',
    question: 'Who is your typical customer? Describe the person or business that buys from you most often.',
    check: { minWords: 15, banned: ['everyone', 'anyone', 'all kinds of people', 'businesses'] },
    followup: { kind: 'string', template: 'Think about your single best customer right now. Describe that specific person or business.' } },

  { n: 5, stage: 1, field: 'location_and_service_area',
    question: 'Where is your business based, city and state, and do you serve customers locally, regionally, or further out?',
    check: { minWords: 5 },
    followup: { kind: 'string', template: 'How large is the community your business primarily operates in? Roughly how many people live in that area?' } },

  { n: 6, stage: 1, field: 'years_in_business',
    question: 'How long has this business been operating?',
    check: { needTimeRef: true }, followup: { kind: 'none' } },

  { n: 7, stage: 1, field: 'annual_revenue',
    question: 'What was your total business revenue last year, as close to the actual number as you can get?',
    check: { needNumber: true, banned: ['it varies', 'hard to say', 'depends on the month'] },
    followup: { kind: 'string', template: 'Even a rough number helps. What is the closest estimate you can give? Are we talking under $50,000, around $100,000, more than that?' } },

  { n: 8, stage: 1, field: 'desired_outcome',
    question: 'What do you most want from The Bridge? What would make this worth your time and money?',
    check: { minWords: 20, banned: ['help with my business', 'grow my business', 'get better', 'make more money'] },
    followup: { kind: 'api', instruction: 'Ask what specifically has to change in their actual day-to-day life for this to feel like it worked.' } },

  // ---------------- STAGE 2 — Operational Reality ----------------
  { n: 9, stage: 2, field: 'customer_acquisition',
    question: 'How do you typically get new customers? Walk me through what actually happened the last time someone new paid you.',
    check: { minWords: 20, banned: ['word of mouth'] },
    followup: { kind: 'api', instruction: 'Pull out the specific trigger or action that caused the last new customer to reach out or walk in.' } },

  { n: 10, stage: 2, field: 'customer_concentration',
    question: 'Do you have one or two customers or clients who make up the majority of your revenue right now?',
    check: { needNumber: true },
    followup: { kind: 'string', template: 'Roughly what percentage of your total revenue comes from your top one or two customers?' } },

  { n: 11, stage: 2, field: 'time_usage',
    question: 'If you looked honestly at how you spend most of your working hours, what takes up the majority of your time?',
    check: { minWords: 15, banned: ['everything', 'a lot of different things', 'whatever needs doing'] },
    followup: { kind: 'api', instruction: 'Separate what they spend time on from what only they can actually do.' } },

  { n: 12, stage: 2, field: 'pricing_history',
    question: 'Have you raised your prices in the last two years?',
    check: { custom: 'always_if_no' },
    followup: { kind: 'string', template: 'What has stopped you from raising them?' } },

  { n: 13, stage: 2, field: 'profit_margin',
    question: 'Do you know roughly what your profit margin is? Out of every dollar you bring in, how much is left after all expenses?',
    check: { needNumber: true, banned: ['i am not sure', 'not sure', 'hard to say', 'it depends'] },
    followup: { kind: 'string', template: 'Even a rough sense. Are you keeping more than half, about a quarter, less than that?' } },

  { n: 14, stage: 2, field: 'major_expenses',
    question: 'What are your three biggest business expenses right now?',
    check: { minWords: 3, banned: ['overhead'] },
    followup: { kind: 'string', template: 'Which of those feels like money well spent and which feels like a drain you have not figured out how to stop?' } },

  { n: 15, stage: 2, field: 'break_even',
    question: 'Do you know your monthly break-even number, the minimum you need to bring in to keep the doors open?',
    check: { needNumber: true, banned: ['not sure', 'i have never calculated it', 'never calculated'] },
    followup: { kind: 'string', template: 'In the last six months, how often did you fall short of whatever that number is?' } },

  { n: 16, stage: 2, field: 'cash_runway',
    question: 'If revenue stopped tomorrow, how many months could your business survive on what it currently has?',
    check: { needTimeRef: true, banned: ['not sure', 'it depends', 'not long'] },
    followup: { kind: 'string', template: 'Does that feel like enough cushion or does it concern you?' } },

  { n: 17, stage: 2, field: 'external_pressures',
    question: 'Has anything changed in the last two or three years in your costs, in what customers are spending, or in how your suppliers and vendors are operating, that has made it harder to run your business than it used to be?',
    check: { minWords: 20 },
    followup: { kind: 'api', instruction: 'Draw out the specific operational impact, cost increase, demand change, or supplier behavior. Never reference political or economic opinion.' } },

  { n: 18, stage: 2, field: 'attempted_solutions',
    question: 'What have you already tried to fix the things that are not working, and what happened when you tried?',
    check: { minWords: 25, banned: ['a lot of things', 'everything i can think of'] },
    followup: { kind: 'api', instruction: 'Draw out the specific outcome of one thing they tried — what they expected versus what actually happened.' } },

  { n: 19, stage: 2, field: 'north_star',
    question: 'Picture yourself about a year from now, in the best realistic position you could hope to be in as the owner of this business. Not selling it and walking away, not some far-off fantasy — the version where the business is genuinely thriving and you are running it the way you want to. What does that look like?',
    check: { minWords: 25 },
    followup: { kind: 'api', instruction: 'Pull the vision down to what would have to be true in the next several months for them to be on that path. Steer away from long-horizon exit or sale goals; keep it on the near-term thriving state.' } },

  { n: 20, stage: 2, field: 'life_success_definition',
    question: 'What would have to be true about your daily life for that version of the business to feel like success? Not the numbers on paper. Your actual life.',
    check: { minWords: 20 },
    followup: { kind: 'api', instruction: 'Ask what a specific ordinary day looks like when the business is where they want it to be.' } },

  // ---------------- STAGE 3 — Full Picture ----------------
  { n: 21, stage: 3, field: 'what_they_love',
    question: 'What do you genuinely love about what you do? Not what you are good at, not what pays the bills. What you actually enjoy.',
    check: { minWords: 15, banned: ['helping people', 'being my own boss', 'the freedom'] },
    followup: { kind: 'string', template: 'How much of your typical week is spent actually doing that specific thing?' } },

  { n: 22, stage: 3, field: 'what_drains_them',
    question: 'What about running this business makes you want to quit?',
    check: { minWords: 15, banned: ['nothing', 'i never feel that way'] },
    followup: { kind: 'string', template: 'You said [answer]. How often does that feeling show up? Occasionally, regularly, or more than you would like to admit?' } },

  { n: 23, stage: 3, field: 'unspoken_truth',
    question: 'What is the thing about your business situation right now that you have never said out loud to anyone?',
    check: { minWords: 20, banned: ['nothing', 'i am an open book', 'open book'] },
    followup: { kind: 'api', instruction: 'Gently name that this is a safe place to say the thing, and ask again with more specific framing around what they are carrying that is heavier than anyone around them knows.' } },

  { n: 24, stage: 3, field: 'closing_threshold',
    question: 'What would have to happen for you to decide to close this business?',
    check: { minWords: 15 },
    followup: { kind: 'string', template: 'How close to that point have you come?' } },

  { n: 25, stage: 3, field: 'problem_solving_style',
    question: 'When a serious problem hits your business, what is your first instinct? Do you want to solve it immediately yourself, think it through before acting, talk it through with someone, or hand it to someone else?',
    check: { custom: 'depends_only' },
    followup: { kind: 'string', template: 'Does that tendency usually serve you well or get you into trouble?' } },

  { n: 26, stage: 3, field: 'thinking_style',
    question: 'Are you more energized by big picture thinking and new ideas or by executing and getting things done well?',
    check: { custom: 'both_only' },
    followup: { kind: 'string', template: 'Which one do you spend more of your actual working time doing, even if it is not the one you prefer?' } },

  { n: 27, stage: 3, field: 'energy_type',
    question: 'After a full day of interacting with customers, employees, or people in general, do you typically come away energized or drained?',
    check: { custom: 'depends_only' },
    followup: { kind: 'string', template: 'How has that shaped the way you have set up your business or your typical work day?' } },

  { n: 28, stage: 3, field: 'support_network',
    question: 'Who in your life, if anyone, knows the full reality of what your business is going through right now? Not the version you share with most people. The actual truth.',
    check: { minWords: 15, banned: ['everyone knows', 'nobody'] },
    followup: { kind: 'string', template: 'How often do you actually talk to them about what is really going on?' } },

  { n: 29, stage: 3, field: 'peer_network',
    question: 'Do you have people in your life who have owned their own business, people who would actually understand what you are dealing with without you having to explain it?',
    check: { minWords: 4 },
    followup: { kind: 'string', template: 'When did you last talk to one of them about what you are actually going through right now?' } },

  { n: 30, stage: 3, field: 'additional_context',
    question: 'Is there anything else about your situation, your business, the context of your life, or what you are carrying right now, that you think would help Earl understand where you actually are?',
    check: null, followup: { kind: 'none' } }
];

const STAGE_BOUNDS = {
  1: { first: 1, last: 8 },
  2: { first: 9, last: 20 },
  3: { first: 21, last: 30 }
};

function getQuestionByField(field) {
  return QUESTIONS.find(q => q.field === field) || null;
}

function getQuestionByNumber(n) {
  return QUESTIONS.find(q => q.n === n) || null;
}

module.exports = {
  QUESTIONS, STAGE_FRAMING, STAGE_COMPLETE, STAGE_BOUNDS,
  getQuestionByField, getQuestionByNumber
};
