# The Bridge — Complete Build Document for Clyde

## Read This First

This document is the complete specification for building The Bridge web application. Work through every section in the exact order presented. Do not skip ahead. Do not begin a new section until the current one is fully working and tested. Every system, file, visual rule, and interaction is specified here. Where a decision has already been made, execute it. Where a choice is presented, flag it for the owner before proceeding.

---

## Section 1 — Project Setup in Replit

### 1.1 Create the Project
- Create a new Replit project
- Runtime: Node.js
- Project name: the-bridge
- Enable Always On so the app never sleeps between visits

### 1.2 Folder Structure
Create the following folder and file structure exactly:

```
the-bridge/
├── /system
│   └── big-book-of-strategy.md        ← Owner edits this file directly to update AI behavior
├── /public
│   ├── /css
│   │   ├── global.css                 ← Design tokens, typography, base styles
│   │   ├── landing.css                ← Landing page specific styles
│   │   ├── game.css                   ← Game interface styles
│   │   └── dashboard.css              ← Member dashboard styles
│   ├── /js
│   │   ├── game.js                    ← All game logic
│   │   ├── levers.js                  ← Lever mechanics and stat calculations
│   │   ├── threats.js                 ← Threat engine and case study retrieval
│   │   ├── ship.js                    ← Ship rendering and animation
│   │   ├── analytics.js               ← Anonymous event logging
│   │   └── dashboard.js               ← Dashboard interactions
│   ├── /assets
│   │   ├── /svg
│   │   │   ├── ship.svg               ← Base ship illustration
│   │   │   ├── threats/               ← One SVG per threat type
│   │   │   └── stars.svg              ← Background star formation pattern
│   │   └── /fonts
│   │       └── (font files here)
│   ├── /data
│   │   └── case-studies.json          ← Static case study library indexed by threat ID
├── /pages
│   ├── index.html                     ← Landing page with embedded game preview
│   ├── game.html                      ← Full game page
│   ├── dashboard.html                 ← Member dashboard
│   └── login.html                     ← Login and signup page
├── /server
│   ├── index.js                       ← Express server entry point
│   ├── routes/
│   │   ├── api.js                     ← All API route handlers
│   │   ├── auth.js                    ← Clerk webhook handlers
│   │   └── payments.js                ← Stripe webhook handlers
│   └── services/
│       ├── claude.js                  ← Anthropic API calls, reads from /system
│       ├── supabase.js                ← Database operations
│       ├── email.js                   ← Resend email operations
│       └── grants.js                  ← Grant search logic (build last)
├── .env                               ← All secrets (never commit this file)
├── .gitignore                         ← Include .env
└── package.json
```

### 1.3 Environment Variables
Add the following to Replit Secrets (never hardcode these anywhere):

```
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_ENSIGN_MONTHLY_PRICE_ID=
STRIPE_ENSIGN_ANNUAL_PRICE_ID=
RESEND_API_KEY=
BASE_URL=https://thebridge.co
```

### 1.4 Install Dependencies
```bash
npm install express cors helmet dotenv @supabase/supabase-js @clerk/clerk-sdk-node stripe resend @anthropic-ai/sdk fs path
```

---

## Section 2 — The /system File

### 2.1 Location and Purpose
The file `/system/big-book-of-strategy.md` is the brain behind every Claude API call the application makes. It is read at runtime by the server every time an API call is needed. The owner can open this file directly in Replit, edit it, add new books and case studies, and save it. The changes take effect on the next API call with no redeployment needed.

### 2.2 How the Server Reads It
In `/server/services/claude.js`, read the file at call time not at startup:

```javascript
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getSystemPrompt() {
  return fs.readFileSync(
    path.join(__dirname, '../../system/big-book-of-strategy.md'),
    'utf8'
  );
}

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

module.exports = { callClaude };
```

### 2.3 The Two API Call Types

**Call Type 1 — Intake Personalization**
Fires once when a player completes the intake form. Cached in the database. Never repeated unless the player resets their ship.

Request sent to Claude:
```
A player has completed the game intake form. Based on their answers below and the Big Book of Strategy framework, generate exactly three things in JSON format with no other text:
1. "ship_name": A name for their business ship that reflects their industry and ambition. Two words maximum. Should feel like a vessel name.
2. "destination_name": A name for their destination — the success state they described. Three words maximum. Should feel like a place on a star map.
3. "flavor_text": Two sentences maximum. Address the captain directly. Acknowledge their specific situation. Make them feel seen. Do not give advice yet. Do not mention the framework by name.

Player answers:
{intake_answers_as_json}
```

**Call Type 2 — Run-End Debrief**
Fires once when the player's ship is destroyed. Produces the Navigation Chart lite. Stored in the database and emailed to the player.

Request sent to Claude:
```
A captain's ship has been destroyed. Based on their full run history below and the Big Book of Strategy framework, produce a structured debrief in the following exact format. Be direct, specific, and compassionate. Reference their actual decisions, not generic advice.

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
{run_history_as_json}

Captain's intake answers:
{intake_answers_as_json}
```

---

## Section 3 — Visual Design System

### 3.1 Design Philosophy
The Bridge visual identity sits at the intersection of SpaceX's clinical precision and deep space atmosphere. It is not a gaming aesthetic. It is a command center aesthetic that happens to contain a game. Every visual decision should make the user feel like they are operating something real and consequential.

The core tension in the design is: the universe is vast and dark, but the interface is clean and controlled. The chaos lives in the background. The tools live in the foreground, crisp and purposeful.

### 3.2 Color System
Define these as CSS custom properties in `global.css`:

```css
:root {
  /* Base palette */
  --color-void: #0a0a0f;           /* Deepest background — near black with blue undertone */
  --color-deep: #12121a;           /* Card backgrounds, panels */
  --color-surface: #1a1a26;        /* Elevated surfaces, inputs */
  --color-border: #2a2a3a;         /* Subtle borders */

  /* Cream and off-white — the human layer */
  --color-cream: #f5f0e8;          /* Primary text, primary UI elements */
  --color-cream-dim: #c8c0b0;      /* Secondary text, inactive states */
  --color-cream-ghost: #6a6460;    /* Tertiary text, placeholders */

  /* The wisp color — off-black with warmth */
  --color-wisp: #1e1c28;           /* Wisp formations, star bodies */
  --color-wisp-edge: #2e2a40;      /* Wisp edges, star points */

  /* Accent — used sparingly, only for critical information */
  --color-signal: #c8b89a;         /* Warm gold — active levers, key numbers */
  --color-alert: #8a4a3a;          /* Threat incoming — deep red, never bright */
  --color-safe: #3a5a4a;           /* Threat eliminated — deep green, never bright */

  /* Transparency layers */
  --color-overlay: rgba(10, 10, 15, 0.85);
  --color-glass: rgba(26, 26, 38, 0.6);
}
```

### 3.3 Typography
Use two typefaces only. Import via Google Fonts:

```css
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap');

:root {
  --font-primary: 'Space Grotesk', sans-serif;   /* All UI text, body copy, labels */
  --font-mono: 'Space Mono', monospace;           /* Numbers, coordinates, data readouts, lever values */
}
```

Type scale:
```css
:root {
  --text-xs: 0.75rem;      /* Fine print, timestamps */
  --text-sm: 0.875rem;     /* Labels, captions */
  --text-base: 1rem;       /* Body text */
  --text-lg: 1.125rem;     /* Subheadings */
  --text-xl: 1.5rem;       /* Section headings */
  --text-2xl: 2.25rem;     /* Page headings */
  --text-3xl: 3.5rem;      /* Hero text */
  --text-hero: clamp(3rem, 8vw, 6rem);  /* Landing hero — scales with viewport */
}
```

### 3.4 The Background System — Wisps and Star Formations
This is the visual signature of The Bridge. It appears on every page behind all content. It is generated entirely in CSS and SVG — no images, no external files.

Create a file `/public/assets/svg/stars.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs>
    <!-- Four-pointed star shape -->
    <path id="star-lg" d="M0,-24 L3,-3 L24,0 L3,3 L0,24 L-3,3 L-24,0 L-3,-3 Z"/>
    <path id="star-md" d="M0,-14 L2,-2 L14,0 L2,2 L0,14 L-2,2 L-14,0 L-2,-2 Z"/>
    <path id="star-sm" d="M0,-6 L1,-1 L6,0 L1,1 L0,6 L-1,1 L-6,0 L-1,-1 Z"/>

    <!-- Wisp gradient -->
    <radialGradient id="wisp-fade" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#2e2a40" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#0a0a0f" stop-opacity="0"/>
    </radialGradient>

    <!-- Star glow -->
    <filter id="star-glow">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Wisp formations — organic ellipses that trail into star clusters -->
  <ellipse cx="200" cy="150" rx="300" ry="80" fill="url(#wisp-fade)" transform="rotate(-15 200 150)"/>
  <ellipse cx="900" cy="600" rx="350" ry="100" fill="url(#wisp-fade)" transform="rotate(20 900 600)"/>
  <ellipse cx="600" cy="400" rx="200" ry="60" fill="url(#wisp-fade)" transform="rotate(5 600 400)"/>

  <!-- Large star formations at wisp endpoints -->
  <use href="#star-lg" transform="translate(95, 105)" fill="#2e2a40" filter="url(#star-glow)" opacity="0.9"/>
  <use href="#star-lg" transform="translate(1080, 650)" fill="#2e2a40" filter="url(#star-glow)" opacity="0.8"/>
  <use href="#star-md" transform="translate(480, 360)" fill="#2e2a40" filter="url(#star-glow)" opacity="0.7"/>

  <!-- Medium stars scattered along wisps -->
  <use href="#star-md" transform="translate(180, 200)" fill="#1e1c28" opacity="0.8"/>
  <use href="#star-md" transform="translate(850, 550)" fill="#1e1c28" opacity="0.7"/>
  <use href="#star-sm" transform="translate(320, 130)" fill="#2e2a40" opacity="0.9"/>
  <use href="#star-sm" transform="translate(750, 620)" fill="#2e2a40" opacity="0.8"/>
  <use href="#star-sm" transform="translate(150, 300)" fill="#1e1c28" opacity="0.6"/>
  <use href="#star-sm" transform="translate(1000, 500)" fill="#1e1c28" opacity="0.7"/>

  <!-- Fine dust — tiny stars filling the field -->
  <!-- Generate 40-50 tiny dots distributed across the canvas -->
  <circle cx="60" cy="80" r="1" fill="#2e2a40" opacity="0.5"/>
  <circle cx="240" cy="45" r="1.5" fill="#2e2a40" opacity="0.4"/>
  <circle cx="420" cy="200" r="1" fill="#1e1c28" opacity="0.6"/>
  <circle cx="580" cy="90" r="1" fill="#2e2a40" opacity="0.3"/>
  <circle cx="720" cy="160" r="1.5" fill="#2e2a40" opacity="0.5"/>
  <circle cx="880" cy="80" r="1" fill="#1e1c28" opacity="0.4"/>
  <circle cx="1050" cy="200" r="1" fill="#2e2a40" opacity="0.6"/>
  <circle cx="140" cy="420" r="1" fill="#2e2a40" opacity="0.4"/>
  <circle cx="340" cy="480" r="1.5" fill="#1e1c28" opacity="0.5"/>
  <circle cx="520" cy="520" r="1" fill="#2e2a40" opacity="0.3"/>
  <circle cx="680" cy="440" r="1" fill="#2e2a40" opacity="0.6"/>
  <circle cx="820" cy="380" r="1.5" fill="#1e1c28" opacity="0.4"/>
  <circle cx="960" cy="460" r="1" fill="#2e2a40" opacity="0.5"/>
  <circle cx="1100" cy="380" r="1" fill="#1e1c28" opacity="0.3"/>
  <circle cx="80" cy="640" r="1" fill="#2e2a40" opacity="0.5"/>
  <circle cx="260" cy="700" r="1.5" fill="#2e2a40" opacity="0.4"/>
  <circle cx="440" cy="660" r="1" fill="#1e1c28" opacity="0.6"/>
  <circle cx="640" cy="740" r="1" fill="#2e2a40" opacity="0.3"/>
  <circle cx="800" cy="700" r="1.5" fill="#2e2a40" opacity="0.5"/>
  <circle cx="1000" cy="720" r="1" fill="#1e1c28" opacity="0.4"/>
  <circle cx="1150" cy="640" r="1" fill="#2e2a40" opacity="0.6"/>
</svg>
```

Apply the background in `global.css`:

```css
body {
  background-color: var(--color-void);
  background-image: url('/assets/svg/stars.svg');
  background-size: cover;
  background-attachment: fixed;
  background-repeat: no-repeat;
  min-height: 100vh;
  color: var(--color-cream);
  font-family: var(--font-primary);
}
```

Add a subtle parallax drift to the background — the star field moves very slowly as the user scrolls, giving depth without distraction:

```css
@media (prefers-reduced-motion: no-preference) {
  body {
    background-attachment: fixed;
  }
}
```

### 3.5 UI Component Styles

**Cards and panels:**
```css
.panel {
  background: var(--color-glass);
  border: 1px solid var(--color-border);
  border-radius: 2px;                    /* Almost no radius — clinical, precise */
  backdrop-filter: blur(12px);
  padding: 2rem;
}
```

**Buttons — two variants only:**
```css
.btn-primary {
  background: var(--color-cream);
  color: var(--color-void);
  font-family: var(--font-primary);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.875rem 2rem;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  background: var(--color-signal);
  transform: translateY(-1px);
}

.btn-ghost {
  background: transparent;
  color: var(--color-cream-dim);
  font-family: var(--font-primary);
  font-size: var(--text-sm);
  font-weight: 400;
  letter-spacing: 0.06em;
  padding: 0.875rem 2rem;
  border: 1px solid var(--color-border);
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-ghost:hover {
  border-color: var(--color-cream-dim);
  color: var(--color-cream);
}
```

**Data readouts — lever values, stats, coordinates:**
```css
.readout {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--color-signal);
  letter-spacing: 0.1em;
}
```

---

## Section 4 — The Landing Page

### 4.1 Design Reference and Conversion Philosophy
Draw from the following structural principles observed in the highest-converting SaaS and tool landing pages (Linear, Vercel, Stripe, SpaceX):

- **Hero states the outcome, not the product.** The first thing the visitor reads tells them what their life looks like after using it — not what the product does.
- **Social proof appears within the first scroll.** Not testimonials — data. Numbers from the anonymous event logger once it has enough data. Until then, use founding member count.
- **The product is visible immediately.** The game runs live on the landing page. The visitor watches it before they click into it. They understand what it is before they read a word of explanation.
- **One call to action per section.** No page has two competing buttons in the same viewport.
- **Copy is sparse.** Every line earns its place or it is cut.

### 4.2 Landing Page Structure

**Section 1 — Hero**
Full viewport height. The animated star background is most visible here.

Left side (60% width):
- Eyebrow text in Space Mono, small, cream-dim: `STRATEGIC NAVIGATION FOR SMALL BUSINESS`
- Hero headline in Space Grotesk, hero size, cream: `Your business is already in flight. Do you know where it's headed?`
- Subheadline, text-lg, cream-dim, max 2 lines: `The Bridge gives established business owners the strategic framework, the AI advisor, and the real-time simulator to double what's working and cut what isn't.`
- Two buttons side by side: `LAUNCH THE SIMULATOR` (primary) and `SEE HOW IT WORKS` (ghost, scrolls to explanation section)

Right side (40% width):
- The live embedded game running in a contained panel — the ship visible, a threat slowly drifting toward it, levers visible but locked. A subtle pulse animation on the panel border. Text beneath the panel: `This is your ship. Click to take the helm.`

**Section 2 — The Problem**
Dark panel, full width. Centered text. No images.
- Headline: `Most small business owners are flying blind.`
- Three columns, each with a stat and a line of explanation:
  - `80%` / `of effort goes toward the 20% of work that produces almost nothing`
  - `< 3%` / `of available government grants are ever claimed by eligible businesses`
  - `1 in 5` / `small businesses fail not from bad products but from bad strategic sequencing`
- No source citations. These are directional truths, not academic claims.

**Section 3 — The Product Explanation**
Three panels in sequence, each explaining one core offering:

Panel 1 — The Simulator:
- Icon: small SVG ship
- Headline: `Fly your actual business`
- Copy: `Input your business. The Simulator builds your ship around it — your real levers, your real vulnerabilities, your real threats. Play to learn. Come back because it's real.`

Panel 2 — The Navigation Chart:
- Icon: small SVG compass / four-pointed star
- Headline: `Know exactly where to start`
- Copy: `Answer 13 questions. Receive a six-page strategic assessment that tells you what to stop, what to prioritize, and what to build in the next 90 days. Specific to your business. Not a template.`

Panel 3 — The Commander:
- Icon: small SVG signal wave
- Headline: `A strategic advisor who already knows your ship`
- Copy: `Every conversation starts with your full business context already loaded. Ask anything. Get a direct answer grounded in the same framework that built your Navigation Chart.`

**Section 4 — Who This Is For**
Two columns. Left: who it is for. Right: who it is not for.

For:
- Established business owners doing $50K to $500K annually
- Founders who know their product works but aren't sure what to do next
- Operators who are working in the business and need to start working on it
- Anyone who has read business books but hasn't had a framework to apply them

Not for:
- Pre-revenue ideas looking for validation (that comes later)
- Businesses looking for a coach who tells them what to do
- Anyone not willing to answer hard questions about their own operation

**Section 5 — Pricing**
Single tier displayed at launch. Clean, no comparison table yet.
- Tier name: `ENSIGN`
- Price: `$97 / month` with `$970 / year` in smaller text beneath (save two months)
- Four bullet points of what's included
- Primary button: `BECOME A MEMBER`
- Ghost text beneath button: `Or start with the free Simulator — no account required`

**Section 6 — Footer**
Minimal. Logo left. Three links right: Privacy, Terms, Contact. One line of copy centered: `The Bridge is built for captains who take their ship seriously.`

---

## Section 5 — The Game

### 5.1 Game Page Layout
The game occupies the full browser viewport. No scrolling. Three zones:

**Zone 1 — The Battlefield (center, 65% of screen)**
Dark, atmospheric. The star background is most dense here. The ship sits in the lower third. The upper two-thirds is where threats appear and drift downward. The destination — a faint four-pointed star formation — is visible at the very top of the battlefield, always in frame, always the same distance away until a sector is completed.

**Zone 2 — The Lever Panel (right side, 25% of screen)**
Clean panel with the seven active levers. Each lever is a vertical slider with a label above and a readout value below in Space Mono. The panel has a subtle border and glass background. Lever labels use Space Grotesk, small caps. The Focus Points remaining for this turn are displayed at the top of the panel in large Space Mono text.

**Zone 3 — Status Bar (bottom strip, full width)**
Three stat readouts in Space Mono: MOMENTUM, RESILIENCE, CLARITY. Each displayed as a number 0-10 and a thin horizontal bar that fills with color. Beneath the stats: the plain English diagnosis line from the previous turn, fading in slowly after each resolution. GO button sits at the far right of the status bar — large, primary style.

### 5.2 The Ship SVG
Create `/public/assets/svg/ship.svg`. The ship is a simple, immediately readable vessel viewed from above (top-down third-person perspective, like Galaga). It should read as a ship at small sizes.

Core ship shape — a forward-pointing arrowhead form with two swept rear fins. Simple geometry. No detail that disappears at small sizes:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80" id="bridge-ship">
  <defs>
    <filter id="ship-glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Engine trail gradient -->
    <linearGradient id="engine-trail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c8b89a" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#c8b89a" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Engine trail — animated, appears below ship -->
  <rect class="engine-trail" x="22" y="60" width="16" height="30"
        fill="url(#engine-trail)" opacity="0.4"/>

  <!-- Main hull — forward arrow form -->
  <path class="ship-hull"
        d="M30,4 L48,60 L30,52 L12,60 Z"
        fill="#f5f0e8" filter="url(#ship-glow)"/>

  <!-- Left fin -->
  <path class="ship-fin"
        d="M12,60 L2,72 L18,64 Z"
        fill="#c8c0b0"/>

  <!-- Right fin -->
  <path class="ship-fin"
        d="M48,60 L58,72 L42,64 Z"
        fill="#c8c0b0"/>

  <!-- Cockpit detail -->
  <ellipse class="ship-cockpit" cx="30" cy="28" rx="5" ry="7"
           fill="#1a1a26" stroke="#c8b89a" stroke-width="1"/>

  <!-- Hull center line — structural detail -->
  <line x1="30" y1="8" x2="30" y2="52"
        stroke="#c8b89a" stroke-width="0.5" opacity="0.4"/>
</svg>
```

### 5.3 Ship Animation System
In `/public/js/ship.js`, implement the following animated states. All transitions use CSS transitions with `transition: all 0.5s ease` so the ship morphs visibly between states rather than snapping:

**Base state:** Ship centered in lower third of battlefield. Engine trail animates with a slow pulse — opacity cycles 0.3 to 0.6 over 2 seconds, infinite.

**High Momentum (lever 7-10):** Ship moves slightly forward (translateY -8px). Engine trail lengthens (height increases to 45px). Trail opacity increases. Transition: 0.5s ease.

**Low Momentum (lever 0-3):** Ship drifts slightly sideways — a slow sinusoidal sway animation, 4 second period. Engine trail shortens, dims. Communicates drift visually without words.

**High Resilience (lever 7-10):** A faint shield ring appears around the ship — a thin SVG circle, slightly pulsing, cream-colored at 20% opacity. Radius 40px. The ring becomes more visible (40% opacity) when a threat is incoming.

**Low Resilience (lever 0-3):** Shield ring absent. The hull fill color dims slightly from cream to cream-dim.

**High Network Effects (lever 7-10):** Small connection lines extend from the ship to the passenger indicators along the right edge of the battlefield. Lines pulse slowly to show active connections.

**Low Systems (lever 0-3):** Small repair drone SVGs that normally move around the hull are docked and dark. At high Systems they orbit slowly.

**High People (lever 7-10):** The cockpit glow brightens from signal color to full cream. Subtle.

**Taking damage:** Ship shakes — a short CSS keyframe animation, 0.3 seconds:
```css
@keyframes ship-hit {
  0% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
  100% { transform: translateX(0); }
}
```

**Ship destroyed:** Hull opacity fades to 0 over 1.5 seconds. Engine trail extinguishes. A brief particle burst — 8 small SVG fragments fly outward from the ship center using CSS animation. Then the death screen panel fades in over the battlefield.

### 5.4 Threat SVGs
Create one SVG per threat type in `/public/assets/svg/threats/`. Each threat should be immediately readable as a different kind of danger. All use the same color palette — they are not bright or cartoonish. They feel like real space phenomena.

**churn-wave.svg** — A horizontal wave formation. Multiple small passenger-icon shapes drifting away from a central mass. Communicates loss and outflow.

**blind-side.svg** — A single dense object with no warning markers. Solid, fast-looking. No glow, no trail. Just mass.

**drift.svg** — A soft gravitational distortion. Represented as a warping of the space grid — concentric rings pulling sideways. Not a projectile. An environmental force.

**burn.svg** — A slow-moving fuel drain. Represented as a depleting resource container — a tank shape with a visible drain line.

**commoditization.svg** — Multiple identical small ship outlines approaching in formation. They look exactly like the player's ship. Indistinguishable.

**assumption.svg** — A cracked foundation shape. Angular fracture lines radiating from a center point. Represents a hidden structural failure becoming visible.

**noise.svg** — A scatter of small identical signals. Represents losing the marketing message in a field of competing noise.

### 5.5 Threat Animation
Each threat SVG spawns at the top of the battlefield and drifts slowly downward. Speed is calibrated to the Information Asymmetry lever — at lever 10, threats move at 30% speed giving maximum thinking time. At lever 0, threats move at 100% speed with no warning.

On threat appearance, the status bar displays a threat name and one-line description in Space Mono, fading in over 0.5 seconds. The lever most relevant to countering this threat has its label highlighted in signal color — a subtle cue, not a flashing arrow.

The threat pauses at 40% of the way down the battlefield. This is the player's adjustment window. A thin progress line beneath the GO button shows the threat's position. While paused the player can freely adjust levers. When GO is pressed the threat continues its path and the outcome resolves.

### 5.6 Lever Mechanics in Code
In `/public/js/levers.js`, implement the following as pure JavaScript with no API calls:

**Starting position calculator:**
```javascript
function calculateStartingLevers(intakeAnswers) {
  return {
    positioning: scorePositioning(intakeAnswers),
    informationAsymmetry: scoreInfoAsymmetry(intakeAnswers),
    time: scoreTime(intakeAnswers),
    capital: scoreCapital(intakeAnswers),
    differentiation: scoreDifferentiation(intakeAnswers),
    habitDesign: scoreHabitDesign(intakeAnswers),
    switchingCosts: scoreSwitchingCosts(intakeAnswers)
  };
}

function scorePositioning(answers) {
  let score = 5;
  if (answers.customerClarity === 'very_clear') score += 2;
  if (answers.customerClarity === 'vague') score -= 2;
  if (answers.competitiveAdvantage === 'strong') score += 2;
  if (answers.competitiveAdvantage === 'unclear') score -= 2;
  return Math.max(1, Math.min(10, score));
}
// Repeat pattern for all seven levers
```

**Stat calculation weights:**
```javascript
const STAT_WEIGHTS = {
  momentum: {
    positioning: 0.35,
    differentiation: 0.35,
    habitDesign: 0.30
  },
  resilience: {
    switchingCosts: 0.40,
    capital: 0.35,
    time: 0.25
  },
  clarity: {
    informationAsymmetry: 0.45,
    positioning: 0.30,
    time: 0.25
  }
};

function calculateStats(levers) {
  return {
    momentum: weightedScore(levers, STAT_WEIGHTS.momentum),
    resilience: weightedScore(levers, STAT_WEIGHTS.resilience),
    clarity: weightedScore(levers, STAT_WEIGHTS.clarity)
  };
}

function weightedScore(levers, weights) {
  return Object.entries(weights).reduce((total, [lever, weight]) => {
    return total + (levers[lever] * weight);
  }, 0);
}
```

**Focus Point economy:**
```javascript
const FOCUS_POINTS_PER_TURN = 20;
const LEVER_ADJUST_COST = 2; // per point of increase
// Decreasing a lever costs nothing
// People lever at high value: all costs -1
// People lever at low value: all costs +1
```

**Threat selection engine:**
```javascript
const THREAT_MAP = {
  switchingCosts: 'churn-wave',
  informationAsymmetry: 'blind-side',
  positioning: 'drift',
  capital: 'burn',
  differentiation: 'commoditization',
  time: 'assumption',
  habitDesign: 'noise'
};

function selectThreat(levers) {
  // Find the lever with the lowest current value
  const lowestLever = Object.entries(levers)
    .sort(([,a], [,b]) => a - b)[0][0];
  return THREAT_MAP[lowestLever];
}
```

### 5.7 Tutorial Flow
After the intake form is submitted and the ship is named, before the first threat appears, a tutorial overlay runs. It is not skippable on the first run. It can be skipped on return visits.

Tutorial is a sequence of five panels, each highlighting one element of the interface:

1. **The Ship** — spotlight on the ship. Text: `This is [ship name]. It represents your business. Its appearance changes as you adjust your levers.`

2. **The Levers** — spotlight on lever panel. Text: `These are your strategic levers. Each one controls a different aspect of how your business operates. You have 20 Focus Points to spend adjusting them each turn.`

3. **The Stats** — spotlight on status bar. Text: `Momentum moves you forward. Resilience absorbs hits. Clarity keeps you on course. Watch all three.`

4. **The Threat** — a slow practice threat appears and drifts partway down. Text: `Threats appear based on your weakest lever. This one appeared because [lever name] is low. Adjust your levers, then press GO.`

5. **The GO Button** — spotlight on GO. Text: `When you're ready, press GO. The ship responds to your configuration. Watch what happens.`

The practice threat in step 4 deals zero damage. It is for demonstration only. After GO is pressed in the tutorial, the threat drifts past the ship harmlessly and the tutorial ends with: `You have the helm. Good luck, Captain.`

### 5.8 Death Screen and Conversion Wall
When the ship is destroyed, the battlefield dims to 20% opacity. The ship destruction animation plays (1.5 seconds). Then a panel fades in centered on screen:

**Death Panel:**
```
[Ship name] has been destroyed.

[One sentence plain English summary of what killed it, generated from the run data
using a pre-written template matched to the killing threat — no API call needed here]

─────────────────────────────────

[BUTTON 1 — Primary]
CONTINUE FLYING FREE
Save your ship and keep playing with your email

[BUTTON 2 — Ghost, with border in signal color]
A REAL THREAT IS ON THE HORIZON
Your business faces the same vulnerability that just destroyed your ship.
Become a member and learn how to captain it.

─────────────────────────────────

Your run summary will be ready shortly.
[This line appears only after the run-end API call completes — links to the debrief]
```

Button 1 triggers email capture via Clerk magic link. On email confirmation, game state saves and player resumes with a rebuilt ship at reduced stats.

Button 2 links to the pricing section of the landing page with a URL parameter that pre-fills the signup form with their intake data so they don't re-enter anything.

---

## Section 6 — Authentication

### 6.1 Clerk Configuration
- Install Clerk JavaScript SDK
- Configure email-only magic link authentication
- No passwords, no OAuth at launch
- Session tokens stored in httpOnly cookies via the Express backend

### 6.2 Protected Routes
The following pages require authentication. Unauthenticated requests redirect to `/login`:
- `/dashboard`
- Any API route prefixed with `/api/member/`

The game page (`/game`) does not require authentication. Anonymous play is permitted until the death wall.

### 6.3 Membership Tier Gating
After authentication, every page load checks the user's `membership_tier` field in Supabase:

- `free` — access to game with email save only. No dashboard features.
- `ensign` — full dashboard access. Navigation Chart, Commander (20 sessions/month), Grant Radar Basic.

Gating is enforced server-side on all `/api/member/` routes. Client-side gating is for UX only — never for security.

---

## Section 7 — Database Schema

### 7.1 Supabase Tables

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  membership_tier TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  industry TEXT,
  signup_date TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  commander_sessions_used INT DEFAULT 0,
  commander_sessions_reset_date DATE DEFAULT CURRENT_DATE,
  last_chart_date DATE
);

-- Game State
CREATE TABLE game_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  ship_name TEXT,
  destination_name TEXT,
  flavor_text TEXT,
  current_sector INT DEFAULT 1,
  passenger_count INT DEFAULT 0,
  lever_config JSONB,
  momentum FLOAT,
  resilience FLOAT,
  clarity FLOAT,
  run_number INT DEFAULT 1,
  last_saved TIMESTAMPTZ DEFAULT NOW()
);

-- Run History
CREATE TABLE run_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  run_number INT,
  threat_log JSONB,
  lever_decisions JSONB,
  final_momentum FLOAT,
  final_resilience FLOAT,
  final_clarity FLOAT,
  killing_threat TEXT,
  debrief_text TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Anonymous Events (no user_id — never linked to identity)
CREATE TABLE anonymous_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  industry TEXT,
  biggest_uncertainty TEXT,
  starting_levers JSONB,
  threats_encountered JSONB,
  turns_survived INT DEFAULT 0,
  email_captured BOOLEAN DEFAULT FALSE,
  converted_to_member BOOLEAN DEFAULT FALSE,
  session_start TIMESTAMPTZ DEFAULT NOW(),
  last_event TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Section 8 — Email System

### 8.1 Resend Configuration
- Connect custom domain to Resend
- Verify DNS records
- All emails send from `captain@thebridge.co` or similar

### 8.2 Email Templates

**Welcome Email** — triggered on first email capture:
Subject: `Your ship has been saved, Captain.`
Body: Brief. Ship name. One sentence acknowledging what destroyed them. Link to resume game. One line about what membership unlocks.

**Debrief Email** — triggered when run-end API call completes:
Subject: `[Ship name] — Mission Debrief`
Body: The full five-section Navigation Chart lite output formatted cleanly. Single CTA at bottom: `BECOME A MEMBER` linking to pricing.

**Subscription Confirmation** — triggered by Stripe webhook:
Subject: `Welcome to The Bridge, Ensign.`
Body: Confirms tier. Links to dashboard. One sentence of what to do first (complete the Navigation Chart).

**Weekly Digest** — scheduled every Monday:
Subject: `This week on The Bridge`
Body: One anonymous insight from the previous week's event data. Written by a pre-built template that pulls the most common threat type, the most common industry, and the average turns survived. Ends with one question for the reader to consider about their own business.

---

## Section 9 — Member Dashboard

### 9.1 Layout
Single page, authenticated. Three column layout on desktop, stacked on mobile.

**Left column — Ship Status:**
- Ship name and destination displayed in Space Mono
- Static SVG ship illustration in current lever configuration state (CSS classes applied server-side based on lever values)
- Three stat bars: Momentum, Resilience, Clarity
- Button: RESUME GAME

**Center column — Commander:**
- Chat interface, visible only to Ensign members
- Session counter: `14 of 20 sessions remaining this month`
- Message thread with input at bottom
- Each message from the Commander prefixed with a small four-pointed star icon

**Right column — Navigation Chart and History:**
- If chart has been generated: display a summary card of the most recent chart with a PDF download link and a `REGENERATE` button (grayed out with days remaining if within 90-day window)
- If no chart yet: a prominent prompt to complete the intake
- Below: list of completed runs from run_history with debrief preview and expand option

---

## Section 10 — Payments

### 10.1 Stripe Setup
- Create one Product in Stripe: `The Bridge — Ensign`
- Two Prices: monthly ($97) and annual ($970)
- Enable Stripe Customer Portal for self-serve cancellation

### 10.2 Checkout Flow
1. User clicks BECOME A MEMBER
2. Server creates Stripe Checkout Session with their email pre-filled
3. User completes payment on Stripe-hosted checkout page
4. Stripe sends `checkout.session.completed` webhook to `/api/payments/webhook`
5. Server verifies webhook signature using `STRIPE_WEBHOOK_SECRET`
6. Server updates `membership_tier` to `ensign` in Supabase
7. Server sends subscription confirmation email via Resend
8. User is redirected to dashboard

---

## Section 11 — Anonymous Data and Newsletter

### 11.1 What Is Collected Anonymously
Every game session generates a `session_id` — a random UUID created at page load, stored in sessionStorage, never tied to a name or email. The following is logged to `anonymous_events` throughout the session:

- Industry selected at intake
- Biggest uncertainty text field (the sentence they typed)
- Starting lever configuration as JSON
- Each threat encountered (threat type, turn number, damage dealt)
- Lever configuration at the time of each threat
- Whether the player adjusted levers before pressing GO
- Turns survived total
- Whether email was captured at death
- Whether they converted to a paid member

### 11.2 Weekly Digest Generation
A scheduled function runs every Monday at 8am:

```javascript
async function generateWeeklyDigest() {
  const lastWeek = await supabase
    .from('anonymous_events')
    .select('*')
    .gte('session_start', sevenDaysAgo());

  const topIndustry = mostCommon(lastWeek, 'industry');
  const topThreat = mostCommon(lastWeek, 'threats_encountered[0].type');
  const avgTurns = average(lastWeek, 'turns_survived');
  const emailCaptureRate = percentage(lastWeek, 'email_captured');

  const digestContent = buildDigestTemplate({
    topIndustry,
    topThreat,
    avgTurns,
    emailCaptureRate
  });

  await sendToAllEmailList(digestContent);
}
```

The digest template is a static string with variable slots — no API call needed for the weekly digest. The data writes the story.

---

## Section 12 — Build Order for Clyde

Execute in this exact sequence. Test each step before proceeding:

1. Create Replit project, folder structure, install all dependencies, confirm server starts
2. Connect Supabase, create all four tables, confirm a test write succeeds
3. Configure Clerk, confirm magic link email sends and session is created on click
4. Configure Stripe, confirm test payment updates membership_tier in Supabase
5. Build global CSS design system — color tokens, typography, background SVG, buttons
6. Build landing page HTML and CSS — hero section only first, confirm it renders correctly
7. Build game intake form — seven questions, confirm answers write to game_state table
8. Build lever starting position calculator — confirm levers initialize from intake answers
9. Build ship SVG and embed in game page — confirm it renders
10. Build ship animation system — confirm all seven lever states animate correctly
11. Build lever panel UI — seven sliders, Focus Points counter, confirm values update stats
12. Build threat engine — confirm correct threat spawns based on lowest lever
13. Build one threat SVG (churn-wave) and animate it drifting down the battlefield
14. Build GO button resolution logic — confirm damage calculates and stats update
15. Build case study JSON file and confirm correct study retrieves after each threat
16. Build plain English diagnosis line — confirm it appears in status bar after resolution
17. Build tutorial overlay — five panels, confirm it runs on first visit only
18. Build death screen and two-button conversion wall
19. Build anonymous event logger — confirm events write to anonymous_events on each turn
20. Build Anthropic API intake call — confirm ship name and flavor text return and display
21. Build Anthropic API run-end debrief call — confirm debrief generates and stores
22. Configure Resend — confirm welcome email sends on email capture
23. Build member dashboard — ship status, Commander chat, Navigation Chart panel
24. Build Commander chat interface — confirm it references /system file and user game history
25. Build run history display on dashboard
26. Build debrief email — confirm it sends after run-end API call completes
27. Complete remaining landing page sections — problem, product explanation, pricing, footer
28. Build weekly digest scheduled function
29. Configure custom domain and SSL
30. Full end-to-end test: anonymous play → death → email capture → payment → dashboard → Commander session

---

## Section 13 — The /system File Access for Owner

The file `/system/big-book-of-strategy.md` is the only file the owner needs to edit regularly. Clyde should:

1. Create this file with the full Big Book of Strategy content as the initial content
2. Add a comment block at the top of the file:

```markdown
<!--
OWNER INSTRUCTIONS:
This file is the brain behind every AI response in The Bridge.
Edit it directly in Replit to update the framework, add new books,
or add new case studies. Changes take effect on the next API call.
No redeployment needed.

TO ADD A NEW BOOK:
Add a new section at the bottom of the Levers section following
the same format as existing entries. Include the book title in
parentheses after each bullet point it contributes.

TO ADD A CASE STUDY:
Add entries to /public/data/case-studies.json following the
existing format. Index them by threat_id so they retrieve correctly.
-->
```

3. Ensure the file is excluded from any public serving — it should only be readable server-side. Add to the Express server:

```javascript
// Block direct access to /system directory
app.use('/system', (req, res) => {
  res.status(403).send('Forbidden');
});
```

The file is readable by the server, editable by the owner in Replit, and inaccessible to the public.
