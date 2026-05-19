/**
 * Seed script — inserts case studies into Supabase case_studies table.
 * Run once: node scripts/seed-case-studies.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const caseStudies = [
  {
    title: "Netflix DVD-to-Streaming Pivot",
    source_book: "Zero to One",
    source_author: "Peter Thiel",
    lever_tags: ["Positioning", "Time", "Switching Costs"],
    problem_tags: ["business model transition", "competing with yourself", "killing a working revenue line"],
    story: "In 2007 Netflix had a profitable, growing DVD-by-mail business. Reed Hastings chose to invest heavily in streaming — a product that barely worked, on infrastructure they did not own, against studios that did not want to license to them. The DVD business was funding a competitor to itself. Most operators would have protected the profitable line. Hastings protected the future instead. When streaming became viable Netflix had the customer relationships, the brand trust, and the operational experience that Blockbuster spent years and billions trying to replicate. The lesson is not that you should always kill your working revenue line. It is that the question of whether your current model competes with your future model is one most operators never ask."
  },
  {
    title: "Starbucks 2008 Turnaround",
    source_book: "Onward",
    source_author: "Howard Schultz",
    lever_tags: ["Positioning", "Habit Design", "People"],
    problem_tags: ["culture loss through scaling", "returning to core identity", "growth that kills what made you"],
    story: "By 2007 Starbucks had opened so many locations so fast that the experience had become generic. Schultz wrote a leaked internal memo describing the commoditization of the brand and the loss of the coffee theater that had made Starbucks worth a premium. When he returned as CEO in 2008 — amid a financial crisis — his first major decision was to close every US store for three and a half hours for espresso retraining. The financial cost was enormous. The signal it sent was worth more. Schultz was not fixing the coffee. He was telling every employee that the experience was the product and that no financial pressure would be allowed to make it ordinary. Revenue recovered faster than analysts projected."
  },
  {
    title: "Howard Schultz Third Place Concept",
    source_book: "The Starbucks Experience",
    source_author: "Joseph Michelli",
    lever_tags: ["Differentiation", "Habit Design", "Network Effects"],
    problem_tags: ["selling an experience not a product", "emotional positioning", "creating belonging"],
    story: "Schultz's insight visiting Italian espresso bars in 1983 was not about coffee. It was about what the bars were for — a social ritual, a place to belong between home and work. He called it the third place. When Starbucks brought this to America the product was not espresso. It was membership in an atmosphere. This is why Starbucks customers tolerate queues that would be unacceptable at a diner and why price increases rarely trigger the defection competitors expect. The customer is not paying for coffee. They are paying for the place and the ritual. Any business that understands what it is actually selling has a pricing and retention advantage over competitors who think they are in the same industry."
  },
  {
    title: "Apple Post-Jobs Design Discipline",
    source_book: "After Steve",
    source_author: "Tripp Mickle",
    lever_tags: ["Differentiation", "Systems", "People"],
    problem_tags: ["maintaining identity after founding leader leaves", "design as strategy", "brand drift"],
    story: "After Jobs died Apple's design decisions became committee decisions — the story of what happens when the person who held the vision is no longer the last word."
  },
  {
    title: "Andy Dunn Bonobos Direct-to-Consumer",
    source_book: "Burn Rate",
    source_author: "Andy Dunn",
    lever_tags: ["Positioning", "Capital", "Switching Costs"],
    problem_tags: ["bootstrapping versus VC", "founder psychology", "growth at all costs consequences"],
    story: "Dunn built Bonobos on a direct relationship with the customer, then took VC money that required growth that broke the relationship — the tension between the business you built and the business investors need."
  },
  {
    title: "Howard Schultz Commodity Trap",
    source_book: "Onward",
    source_author: "Howard Schultz",
    lever_tags: ["Positioning", "Differentiation", "Lever 1"],
    problem_tags: ["escaping commodity competition", "leading with experience not price", "brand as moat"],
    story: "When Starbucks started offering breakfast sandwiches the smell of eggs competed with coffee — Schultz pulled the sandwiches because the smell was the brand."
  },
  {
    title: "SBIR Phase Zero Innovation Risk",
    source_book: "Zero to One",
    source_author: "Peter Thiel",
    lever_tags: ["Capital", "Information Asymmetry", "Systems"],
    problem_tags: ["R&D funding", "government grant strategy", "innovation versus iteration"],
    story: "The businesses that win SBIR funding are not the ones with the best ideas but the ones who understand that federal grant reviewers are evaluating risk reduction not vision."
  },
  {
    title: "Toyota Production Line Stop Authority",
    source_book: "The Toyota Way",
    source_author: "Jeffrey Liker",
    lever_tags: ["Systems", "Time", "People"],
    problem_tags: ["quality at the source", "stopping to fix versus passing defects downstream", "discipline as speed"],
    story: "Toyota gave every assembly line worker a cord they could pull to stop the entire production line the moment they identified a defect. Western manufacturers considered this insane — stopping a line costs thousands of dollars per minute. Toyota's logic was the opposite: a defect passed downstream compounds. By the time it reaches the end of the line it has been built on top of by hundreds of subsequent operations. Stopping at the source is cheaper than fixing at the end. Within years of implementing this system Toyota's defect rate was a fraction of competitors who ran lines that never stopped. The cord also changed the culture — workers who could stop the line were workers who owned the quality."
  },
  {
    title: "Lean Startup Pivot vs Persevere",
    source_book: "The Lean Startup",
    source_author: "Eric Ries",
    lever_tags: ["Information Asymmetry", "Time", "Positioning"],
    problem_tags: ["when to pivot versus persevere", "validated learning", "the difference between stubbornness and conviction"],
    story: "Ries built IMVU on the assumption that people wanted to install an add-on to existing instant messaging platforms. Every metric said they were wrong. The natural response was to work harder on the wrong assumption. Ries developed the pivot framework specifically because he noticed that most startups failed not from lack of effort but from sustained effort in the wrong direction. The discipline is identifying the riskiest assumption underlying the current strategy, designing the smallest possible test to validate it, and asking whether new evidence changes the picture or whether only the emotion changed. Stubbornness and conviction look identical from the outside. Evidence separates them."
  },
  {
    title: "Dhandho Heads I Win Tails I Don't Lose Much",
    source_book: "The Dhandho Investor",
    source_author: "Mohnish Pabrai",
    lever_tags: ["Capital", "Positioning", "Time"],
    problem_tags: ["asymmetric risk", "few bets big bets", "worst case analysis before upside analysis"],
    story: "Pabrai studied Patel motel operators — Indian immigrants who took over failing motels in the 1970s with almost no capital. The Patels' approach was not to find the best motels. It was to find situations where the downside was bounded and the upside was open. A failing motel acquired cheaply could be operated by the family with no labor cost. Worst case: it fails and they walk away with nothing, which is what they started with. Best case: it succeeds and they acquire another. Pabrai codified this as heads I win tails I don't lose much — the structure of a good bet is defined by the worst case being survivable, not by the best case being attractive."
  },
  {
    title: "$100 Startup Service Business Launch",
    source_book: "The $100 Startup",
    source_author: "Chris Guillebeau",
    lever_tags: ["Capital", "Positioning", "Differentiation"],
    problem_tags: ["starting with nothing", "revenue before infrastructure", "constraints as creative forcing function"],
    story: "Guillebeau's subjects built profitable businesses with under $100 because the constraint removed the option of hiding behind preparation."
  },
  {
    title: "Mom Test Customer Discovery",
    source_book: "The Mom Test",
    source_author: "Rob Fitzpatrick",
    lever_tags: ["Information Asymmetry", "Positioning"],
    problem_tags: ["customers lie to be polite", "asking about behavior not opinion", "validating pain not solution"],
    story: "Fitzpatrick's core insight came from watching founders destroy their businesses by asking the wrong questions. Asked whether an idea is good, most people say yes — especially to someone they like. The mom test reframes every customer conversation around past behavior rather than future intention. Not would you use this but tell me about the last time you tried to solve this problem. Not do you like this feature but what did you do when you ran into this situation last month. Behavior cannot lie the way intention can. A customer who has already spent money or time on a problem is telling you something real. A customer who says they would pay for your solution is telling you what they think you want to hear."
  },
  {
    title: "Sprint Five Day Design",
    source_book: "Sprint",
    source_author: "Jake Knapp",
    lever_tags: ["Systems", "Time", "Information Asymmetry"],
    problem_tags: ["compressing decision cycles", "prototype before commit", "time constraints create clarity"],
    story: "Google Ventures ran five-day sprints with companies that had been debating a decision for months — the constraint forced a tangible answer where debate had produced none."
  },
  {
    title: "Scrum Sprint Review",
    source_book: "Scrum",
    source_author: "Jeff Sutherland",
    lever_tags: ["Systems", "Time", "People"],
    problem_tags: ["fixed iteration cycles", "continuous improvement rhythm", "team accountability without micromanagement"],
    story: "Sutherland's teams shipped more in sprints because the fixed end date made cutting scope feel like a win rather than a failure."
  },
  {
    title: "Carnegie Genuine Interest as Strategy",
    source_book: "How to Win Friends and Influence People",
    source_author: "Dale Carnegie",
    lever_tags: ["People", "Network Effects", "Switching Costs"],
    problem_tags: ["relationship before transaction", "genuine interest as strategy", "likeability as a learnable skill"],
    story: "Carnegie observed that the people who were most effective at building lasting business relationships were not the most charming or the most impressive — they were the most genuinely curious about the other person. Remembering someone's name, asking about their children, following up on something they mentioned six months ago — these are not manipulation techniques. They are the natural behavior of someone who finds other people interesting. Carnegie's argument is that this behavior is learnable and that its effect on business outcomes is larger than any sales technique because it operates at the level of trust rather than persuasion. Trust compounds. Persuasion has to be re-applied every time."
  },
  {
    title: "Voss That's Right vs Yes",
    source_book: "Never Split the Difference",
    source_author: "Chris Voss",
    lever_tags: ["People", "Information Asymmetry"],
    problem_tags: ["negotiation as understanding", "that's right versus yes", "mirroring as listening"],
    story: "Voss trained FBI hostage negotiators and discovered that the most dangerous word in a negotiation is yes. A yes can be compliance, stalling, confusion, or genuine agreement — you cannot tell which from the word alone. The word that indicates real understanding is that's right. When someone says that's right they are confirming that you have accurately articulated their position — not just agreed with them, but understood them specifically enough to reflect it back. Voss built his entire negotiation framework around earning that's right rather than closing on yes. The tactical empathy required to produce that's right — understanding the other person's position completely enough to articulate it better than they did — is also the foundation of knowing what they actually need versus what they are asking for."
  },
  {
    title: "Profit First Allocation Before Expenses",
    source_book: "Profit First",
    source_author: "Mike Michalowicz",
    lever_tags: ["Capital", "Systems"],
    problem_tags: ["small business cash flow discipline", "taking profit before paying yourself last", "revenue minus profit equals expenses"],
    story: "Michalowicz discovered that the traditional accounting formula — revenue minus expenses equals profit — guarantees that profit is always what is left over, which for most small businesses is nothing. He reversed it. Revenue minus profit equals what you have to run the business on. By allocating profit first — even small amounts — the business is forced to operate within real constraints rather than expanding expenses to meet revenue. The psychological effect is as important as the mechanical one: a business owner who sees profit accumulating behaves differently than one who is always waiting for the right month to start taking profit. The right month never comes under the traditional formula."
  },
  {
    title: "Sinek Infinite Game Competitor",
    source_book: "The Infinite Game",
    source_author: "Simon Sinek",
    lever_tags: ["Positioning", "Time", "People"],
    problem_tags: ["finite versus infinite players", "businesses that outlast versus businesses that win", "purpose as structural advantage"],
    story: "Sinek's argument is that the companies that survive long term are not trying to beat competitors — they are trying to advance a cause the competitor cannot make irrelevant."
  },
  {
    title: "Blue Ocean Circus Cirque du Soleil",
    source_book: "Blue Ocean Strategy",
    source_author: "W. Chan Kim and Renée Mauborgne",
    lever_tags: ["Positioning", "Differentiation", "Lever 1"],
    problem_tags: ["creating uncontested market space", "eliminating and raising simultaneously", "competing against non-consumption"],
    story: "Cirque du Soleil eliminated animals and star performers — the expensive parts of circus — and added theater and narrative, creating a product that had no direct competitor because it was not quite circus and not quite theater."
  },
  {
    title: "Rory Sutherland British Rail Reframe",
    source_book: "Alchemy",
    source_author: "Rory Sutherland",
    lever_tags: ["Differentiation", "Positioning", "Information Asymmetry"],
    problem_tags: ["changing the frame before changing the product", "psycho-logic over logic", "irrational as rational"],
    story: "British Rail spent hundreds of millions of pounds engineering solutions to reduce train journey times between London and Edinburgh by small margins. Rory Sutherland pointed out that a behavioral economist would solve the same problem differently — not by making the journey shorter but by making it feel shorter. Better WiFi, nicer seats, a bar car. The perceived duration of an experience is not the same as its actual duration. Passengers who are comfortable and engaged do not experience time the same way as passengers who are bored and cramped. The engineering solution was expensive and marginal. The psychological solution was cheap and potentially more effective. Most business problems that appear to require expensive solutions can be reframed into cheaper ones by asking what the customer actually experiences rather than what the product actually does."
  },
  {
    title: "Hooked Instagram Variable Reward",
    source_book: "Hooked",
    source_author: "Nir Eyal",
    lever_tags: ["Habit Design", "Switching Costs", "Network Effects"],
    problem_tags: ["variable reward as retention mechanism", "investment that increases switching cost", "internal triggers over external"],
    story: "Instagram's pull-to-refresh mimics a slot machine — the variable reward of sometimes seeing something interesting creates a compulsive behavior that requires no notification to trigger."
  },
  {
    title: "Power of Habit Keystone",
    source_book: "The Power of Habit",
    source_author: "Charles Duhigg",
    lever_tags: ["Habit Design", "Systems", "People"],
    problem_tags: ["keystone habits that trigger cascading change", "organizational habits as culture", "designing for behavior change"],
    story: "Duhigg's keystone habit insight: one behavior change — Alcoa's CEO mandating injury reporting — cascaded into a cultural change that made Alcoa one of the best performing companies in the Dow."
  },
  {
    title: "E-Myth Franchise Prototype Question",
    source_book: "The E-Myth Revisited",
    source_author: "Michael Gerber",
    lever_tags: ["Systems", "People"],
    problem_tags: ["working on versus in the business", "systems that replace owner dependency", "the franchise model as template"],
    story: "Gerber's diagnostic question is simple and brutal: if you had to open ten identical locations of your business tomorrow, which of your processes would survive and which would require you to be present? Most small business owners discover that almost everything requires them. The business is not a business — it is a job with overhead. Gerber's solution is not to hire more people but to document every repeatable process to the level where the least skilled person who could competently do it could follow the documentation and produce the same result. This is what franchise systems do. The documentation is the business. The people executing it are interchangeable. Most owners resist this because it feels like reduction. It is actually liberation."
  },
  {
    title: "Guerrilla Marketing Creativity Over Budget",
    source_book: "Guerrilla Marketing",
    source_author: "Jay Conrad Levinson",
    lever_tags: ["Network Effects", "Differentiation", "Lever 8"],
    problem_tags: ["time energy and creativity as substitute for budget", "targeted over mass", "measuring by profit not impressions"],
    story: "Levinson's core argument: small businesses win against large ones through superior creativity and targeting, not superior spend — the constraint of no budget forces the message to be better."
  },
  {
    title: "Hitmakers Social Broadcast",
    source_book: "Hitmakers",
    source_author: "Derek Thompson",
    lever_tags: ["Network Effects", "Positioning", "Lever 8"],
    problem_tags: ["nothing spreads by accident", "the myth of viral", "finding the single large broadcast before building the campaign"],
    story: "Thompson's research shows that most things people believe spread organically actually originated from a single large broadcast — a radio station, a tastemaker, a platform push — and the organic spread came after."
  },
  {
    title: "When Peak Trough Recovery",
    source_book: "When",
    source_author: "Daniel Pink",
    lever_tags: ["Time", "Systems", "People"],
    problem_tags: ["timing decisions to cognitive state", "peak for analytical work", "trough for administrative", "recovery for insight"],
    story: "Pink's research shows that decisions made in the trough — early afternoon — are systematically worse than the same decisions made at peak — the implication is that most business decisions are made at the wrong time."
  },
  {
    title: "Strengths Based Leadership Gallup",
    source_book: "Strengths Based Leadership",
    source_author: "Tom Rath and Barry Conchie",
    lever_tags: ["People", "Lever 10"],
    problem_tags: ["building on strength not correcting weakness", "four domains of leadership", "followers need trust before anything else"],
    story: "Gallup's research showed that teams built around what people do exceptionally well outperform teams of average performers across all dimensions — and that the four leadership domains rarely exist in one person."
  },
  {
    title: "Stuck Transition Curve",
    source_book: "Stuck",
    source_author: "Victoria Grady",
    lever_tags: ["People", "Switching Costs", "Systems"],
    problem_tags: ["organizational change resistance", "transition as predictable stages", "anchoring versus adopting"],
    story: "Grady's transition curve maps how people move through change — from anchoring to the familiar, through resistance, to eventual adoption — and shows that the resistance stage is not failure, it is the process working."
  },
  {
    title: "Think Like a Freak Reframe",
    source_book: "Think Like a Freak",
    source_author: "Steven Levitt and Stephen Dubner",
    lever_tags: ["Information Asymmetry", "Positioning", "Lever 2"],
    problem_tags: ["counterintuitive thinking as competitive advantage", "asking the question nobody asked", "the courage to say I don't know"],
    story: "Levitt's reframe on the hotdog eating contest: everyone else was trying to eat faster — Takeru Kobayashi asked whether the physical approach to eating was optimal and discovered it was not."
  },
  {
    title: "Zero to One Secrets",
    source_book: "Zero to One",
    source_author: "Peter Thiel",
    lever_tags: ["Positioning", "Information Asymmetry", "Lever 1"],
    problem_tags: ["what important truth do few agree with", "the gap between belief and knowledge as advantage", "monopoly versus competition"],
    story: "Thiel's question for every business: what do you know that almost nobody else agrees with? The answer to that question is the only durable competitive advantage."
  }
];

async function seed() {
  console.log(`Seeding ${caseStudies.length} case studies...`);

  // Clear existing entries first
  const { error: deleteError } = await supabase
    .from('case_studies')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all

  if (deleteError) {
    console.error('Warning: could not clear existing rows:', deleteError.message);
  }

  const { data, error } = await supabase
    .from('case_studies')
    .insert(caseStudies)
    .select();

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }

  console.log(`Successfully seeded ${data.length} case studies.`);
  process.exit(0);
}

seed();
