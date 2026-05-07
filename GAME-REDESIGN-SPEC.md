# The Bridge — Game Redesign Spec for Clyde

## Read This First

This document replaces all previous game logic. Rebuild `game.js` and `levers.js` from scratch using this spec exactly. Do not patch the existing system. The intake form, API calls, database, auth, and landing page do not change. Only the game logic and game UI change.

---

## The Core Mechanic

Each turn, one threat appears. The player has a maximum of **3 lever adjustments** per turn — not Focus Points, not a budget, but a hard cap of 3 moves. They can adjust any lever up or down, each adjustment counts as 1 move. When they have used all 3 adjustments or choose not to use them all, they press GO. The ship responds. The outcome resolves. The next threat appears.

This limit is the central tension of the game. The player cannot overhaul everything every turn. They must prioritize. They must accept vulnerability somewhere. That is the game.

---

## The Seven Levers

The levers unlock one at a time as the player advances through sectors. Each lever belongs to one of three gameplay categories: **OFFENSIVE**, **DEFENSIVE**, or **MANEUVER**. Three additional levers are **MULTIPLIERS** — they do not produce a direct visual response but amplify the effect of the other levers they are paired with.

Levers are always referred to by their exact Big Book of Strategy names. No renaming. No simplification of terminology.

---

### Lever 1 — POSITIONING / FOCUS
**Category:** OFFENSIVE
**Unlocks:** Sector 1 (starting lever)
**Icon:** A forward-pointing crosshair. Simple. A circle with four short lines extending from it at cardinal points. Cream colored. Communicates aim and precision.
**Visual effect when used offensively:** A narrow beam fires from the ship's nose toward the threat. The beam is cream colored, thin, and travels fast. On high Positioning the beam is bright and direct. The threat fractures on contact — sharp angular fragments fly outward and dissolve.
**What it represents:** How clearly your market knows who you are and why you're different. High Positioning means you engage threats with precision — you know exactly what you're fighting and why. Low Positioning means your beam fires wide and grazes the threat without eliminating it.
**Lowered lever consequence when tested:** The threat takes a glancing hit only. Resilience damage is not absorbed. The threat partially survives and a follow-on consequence fires next turn.

---

### Lever 2 — CAPITAL
**Category:** DEFENSIVE
**Unlocks:** Sector 1 (starting lever)
**Icon:** A solid hexagon — the shape of a cell, representing stored energy and resource. Cream colored. Simple geometry. No detail.
**Visual effect when used defensively:** The ship's hull brightens briefly as resources are deployed. A visible pulse radiates outward from the hull in a ring — not a shield circle but a pressure wave, like a force being expelled. Threats that hit a high-Capital ship slow visibly on contact and deal reduced damage before completing their path.
**What it represents:** Financial runway and how strategically every dollar is deployed. High Capital means you can absorb hits without changing strategy. Low Capital means every hit costs more than it should because you have no buffer.
**Lowered lever consequence when tested:** Full threat damage lands. No absorption. If Capital is at 2 or below when a Capital threat hits, a secondary consequence fires: one other random lever is forced down by 1 point representing a resource being stripped to cover the gap.

---

### Lever 3 — SWITCHING COSTS
**Category:** DEFENSIVE
**Unlocks:** Sector 1 (starting lever)
**Icon:** A chain link — two interlocked ovals. Cream colored. Communicates connection, lock-in, and attachment.
**Visual effect when used defensively:** When a Switching Costs threat hits a high-value lever, passengers (small dots orbiting the ship slowly) remain in orbit and do not scatter. When the lever is low and a Switching Costs threat lands, the passenger dots visibly drift away from the ship's orbit and disappear one by one. The player watches their customer base leave in real time.
**What it represents:** How painful it is for a customer to leave. High Switching Costs means customers stay even when alternatives appear. Low means they leave the moment something easier shows up.
**Lowered lever consequence when tested:** Passenger count drops. Passenger count is a visible number in the top corner of the battlefield. It does not affect stats directly but determines the sector completion bonus — more passengers at sector end means a larger Focus Point reward for the next sector.

---

### Lever 4 — DIFFERENTIATION
**Category:** OFFENSIVE
**Unlocks:** Sector 2
**Icon:** A four-pointed star — distinct, sharp, immediately recognizable as unique. This icon is the same shape as the destination beacon at the top of the battlefield, which is intentional. Being differentiated is what gets you to the destination.
**Visual effect when used offensively:** When Differentiation is used to counter a threat, the ship emits a brief color signature — a flash of warm gold that makes the ship visibly distinct from anything else on the battlefield for 0.5 seconds. The threat, on contact with this signature, dissolves rather than fracturing — it simply cannot find a surface to attach to. The visual communicates: you are so clearly different that the threat has nothing to grab onto.
**What it represents:** How quickly a customer can feel the difference between you and every alternative. High Differentiation means threats that target your market position find no purchase. Low means you look like everything else and the threat lands clean.
**Lowered lever consequence when tested:** A MIRROR threat type becomes available from Sector 5 onward — a threat that looks identical to the player's ship. Low Differentiation means the player cannot distinguish their response and takes automatic partial damage.

---

### Lever 5 — HABIT DESIGN
**Category:** MANEUVER
**Unlocks:** Sector 3
**Icon:** A circular arrow — a single loop with an arrowhead continuing the circle. Communicates return, repetition, and automatic behavior. Cream colored.
**Visual effect when used as maneuver:** The ship moves laterally — a smooth slide left or right — as the threat passes through the space the ship just occupied. The slide has a brief motion trail: three fading ghost images of the ship at decreasing opacity showing the path of movement. The ship returns to center after the threat passes. High Habit Design means the dodge is clean and automatic-looking. Low means the ship slides but not far enough and clips the threat for partial damage.
**What it represents:** Whether customers return automatically or have to decide each time. High Habit Design means your business moves with practiced efficiency — responses feel automatic and well-timed. Low means every response is effortful and slightly too slow.
**Lowered lever consequence when tested:** The ship's slide distance is reduced. At 3 or below, the dodge only clears threats that are narrow. Wide threats clip the ship regardless of the slide.

---

### Lever 6 — POSITIONING / FOCUS (advanced threat) — NETWORK EFFECTS
**Category:** MANEUVER
**Unlocks:** Sector 4
**Icon:** Three dots connected by two lines forming a simple network node. Communicates connection, distribution, and reach. Cream colored.
**Visual effect when used as maneuver:** When Network Effects is activated, small signal lines extend briefly from the ship outward in multiple directions — like a broadcast pulse. Threats that are within range of these signal lines are slightly deflected, their path altered before they reach the ship. High Network Effects means multiple threats can be deflected in a single turn. Low means the signal is too weak to alter anything.
**What it represents:** Whether each new customer makes the next one more likely. High Network Effects means your business has reach that works for you without additional effort. Low means you are fighting for each customer individually with no compounding.
**Lowered lever consequence when tested:** Noise events (random circumstances — see below) become slightly more frequent. A business with no network has no buffer against random external forces.

---

### Lever 7 — SYSTEMS
**Category:** DEFENSIVE
**Unlocks:** Sector 5
**Icon:** Three horizontal lines of decreasing length stacked — the universal symbol for a structured list or documented process. Clean, simple, immediately readable as organization.
**Visual effect when used defensively:** Small repair drone dots activate around the ship's hull — three dots that orbit the ship briefly before returning to docked positions. Each active drone absorbs a fraction of incoming damage before it reaches the hull. High Systems means more drones, more absorption. Low Systems means the drones are docked and the hull takes the full hit.
**What it represents:** Whether the business runs without the owner and whether processes are documented. High Systems means the ship self-corrects minor damage automatically each turn. Low means everything requires manual intervention and nothing compounds.
**Lowered lever consequence when tested:** The ship does not self-repair between turns. At 2 or below, one previously resolved threat type reappears as a follow-on the next turn — representing a problem that was dealt with but came back because the system to prevent recurrence doesn't exist.

---

## The Three Multiplier Levers

These unlock in Sectors 5, 6, and 7. They do not have their own direct visual response. Instead, they visibly amplify the effect of whichever offensive, defensive, or maneuver lever is used on the same turn.

**How multipliers work mechanically:**
Each multiplier lever has a value 0-10 like any other lever. Its value is applied as a percentage bonus to the primary lever used on that turn.
- Multiplier at 10: primary lever effect is 130% of normal
- Multiplier at 7: primary lever effect is 115% of normal
- Multiplier at 4: primary lever effect is 100% (no bonus, no penalty)
- Multiplier at 2: primary lever effect is 85% of normal (neglecting it actively hurts)
- Multiplier at 0: primary lever effect is 70% of normal

The multiplier value appears briefly as a small percentage modifier floating next to the primary lever's icon during resolution — visible for 0.5 seconds then fading. The player can see that their People lever at 8 gave their Positioning attack a +20% boost. They begin to understand that multipliers are worth maintaining without being told explicitly.

---

### Multiplier A — INFORMATION ASYMMETRY
**Unlocks:** Sector 5
**Icon:** A single eye — open, simple, cream colored. Communicates awareness, sight, and knowing.
**Multiplies:** OFFENSIVE levers — Positioning / Focus and Differentiation
**What it represents:** Knowing what your competitors don't means your offensive moves land more precisely. High Intel makes your attacks smarter and more targeted. Low Intel means you're swinging without full information.
**Lowered consequence:** At 2 or below, the incoming threat type is hidden for one extra turn — the player cannot see whether it is an aggressive, heavy, or fast type until it is closer. Less information means less preparation time.

---

### Multiplier B — TIME
**Unlocks:** Sector 6
**Icon:** A simple hourglass — two triangles point to point with a dot in the center. Communicates the resource of time and its passage.
**Multiplies:** MANEUVER levers — Habit Design and Network Effects
**What it represents:** How well you allocate time to high-leverage work. High Time means your maneuvers are timed perfectly — the dodge happens at exactly the right moment. Low Time means maneuvers are slightly mistimed and less effective.
**Lowered consequence:** At 2 or below, the player loses one of their 3 lever adjustments for that turn — representing time wasted on reactive tasks instead of strategic ones. They only get 2 moves instead of 3.

---

### Multiplier C — PEOPLE
**Unlocks:** Sector 7
**Icon:** A single upward-pointing chevron — simple, directional, communicating elevation and human lift. Cream colored.
**Multiplies:** ALL lever categories — offensive, defensive, and maneuver
**What it represents:** The ceiling of the business is the ceiling of the people in it. A strong team makes every lever more effective. A weak team drags every lever down.
**Lowered consequence:** At 2 or below, the 3 lever adjustment cap drops to 2 for that turn. The team cannot execute at full capacity.

---

## Lever Unlock Sequence and Sector Structure

| Sector | New Lever Unlocked | Threat Complexity |
|--------|-------------------|-------------------|
| 1 | Positioning, Capital, Switching Costs (all three start here) | Single threats, telegraphed clearly, slow |
| 2 | Differentiation | Two threat types now possible |
| 3 | Habit Design | Three threat types. Paired threats begin (two slow threats instead of one) |
| 4 | Network Effects | Noise events begin appearing (see below) |
| 5 | Systems + Information Asymmetry (multiplier) | Mirror threats begin. Lever neglect penalties activate |
| 6 | Time (multiplier) | Cascade mechanic begins — wrong response can trigger a follow-on threat |
| 7 | People (multiplier) | Full threat library active. All noise types active |

**Sector completion:** Survive 5 threats without ship destruction. At sector end, the unlock ceremony fires.

---

## The Unlock Ceremony

Duration: 4 seconds. Non-skippable on first playthrough.

1. Battlefield dims to 80% opacity over 0.5 seconds
2. The new lever slot — previously a dark placeholder in the panel — illuminates from behind with a slow brightening over 0.5 seconds
3. The lever icon fades in centered in the slot
4. Text appears centered in the battlefield in Space Mono:

```
NEW LEVER UNLOCKED

[LEVER NAME]
[One sentence: what it does in the game]
[One sentence: what it means for your real business]
```

5. Text holds for 2 seconds
6. Text fades. Battlefield returns to full opacity. Gameplay resumes.

The two sentences are static strings in the code — one per lever — written in advance. No API call.

---

## Threat Types

Every threat has a visible shape and a visible behavior that communicates how to counter it before the player reads anything. Three primary types:

**AGGRESSIVE** — forward-pointing sharp angular shape, moves in a direct straight line toward the ship at moderate speed. Counter with OFFENSIVE levers. Telegraphed by its shape — sharp and direct.

**HEAVY** — dense circular mass, slow-moving, large. Counter with DEFENSIVE levers. Telegraphed by its size and weight — it will not be dodged easily and cannot be deflected by weak offensive fire.

**FAST** — thin elongated dart shape, moves unpredictably with slight lateral variation in its path. Counter with MANEUVER levers. Telegraphed by its movement — it jinks slightly as it drifts, impossible to aim at precisely.

All threat SVGs are drawn inline in JavaScript using `document.createElementNS`. No external SVG files. No broken image references.

**Threat type indicator:** When a threat spawns, its type name appears beneath it in Space Mono for 2 seconds then fades. After Sector 3 the type indicator disappears — the player must read the shape.

---

## Noise Events — Random Circumstances

Noise events begin appearing in Sector 4. They represent external circumstances that are not tied to strategic lever choices — economic conditions, random personnel events, market shifts, cost spikes. They are not predictable. They are not telegraphed. They just appear.

**What noise looks like:**
Small irregular debris shapes — not clean geometric forms like primary threats. They look like fragments, like broken pieces of something. They drift across the battlefield at varying angles — not necessarily straight down. Some drift left to right. Some diagonally. They are smaller than primary threats.

**What noise requires:**
The ship must physically move to avoid noise. The MANEUVER levers — Habit Design and Network Effects — control the ship's lateral position. The ship can be positioned left of center, center, or right of center. Noise that passes through the ship's current position deals minor damage regardless of lever configuration. Noise that passes through empty space the ship has vacated deals no damage.

This means the player must track two things simultaneously once noise appears: the primary threat coming from above requiring a lever response, and noise debris drifting across requiring physical positioning. This is the complexity spike of Sector 4 — not faster threats, but a second thing to track.

**Noise event types and their plain English labels:**
- `INFLATION SPIKE` — debris drifts from left, moderate size
- `INTEREST RATE HIKE` — debris drifts from right, moderate size
- `KEY EMPLOYEE QUIT` — debris drops faster than normal from top but offset to one side
- `MARKET DOWNTURN` — wide slow debris that covers more lateral ground than usual
- `SUPPLY CHAIN DISRUPTION` — multiple small pieces drifting in sequence, 3 seconds apart
- `ALGORITHM CHANGE` — fast debris that changes direction once mid-flight

Noise events never appear on the same turn as a heavy primary threat. The game checks for this before spawning.

**Noise visual identity:** All noise debris is rendered in a slightly dimmer cream — `var(--color-cream-dim)` — so it is visually distinct from primary threats which are full cream. The player learns to differentiate them by color quickly.

---

## The Lever Panel UI

### Layout on Mobile
The lever panel sits in the bottom 45% of the viewport. It does not scroll. It is fixed.

Two rows of levers. Starting levers (3) appear in the first row. As levers unlock, they fill into the grid. Multiplier levers appear in a separate row at the bottom of the panel with a thin separator line above them, labeled `MULTIPLIERS` in small Space Mono text.

Each lever cell contains:
- Icon centered at top (24px)
- Lever name in Space Mono, 9px, all caps, below icon
- Current value in Space Mono, 14px, signal gold color
- A vertical slider — drag up to increase, drag down to decrease
- A small indicator below the slider showing adjustments used this turn: three dots, each fills when an adjustment is spent

### The 3-Adjustment Visual
Three small dots appear at the top of the lever panel. They start empty (outline only). Each time the player makes an adjustment — any lever, up or down — one dot fills. When all three are filled, all lever handles lock and pulse subtly to indicate no more moves available. The GO button pulses once to draw attention.

The dots reset to empty on each new turn.

### Lever Color States
Two states only. No warning rainbow:
- **Active (4 and above):** lever track is neutral cream
- **Neglected (3 and below):** lever track dims to a muted deep red — `#4a2a2a` — subtle, not alarming. The player notices it. They understand something is low. They feel the risk they are taking.

No pulsing. No locked handles. No cascading warnings. Just the color change. They feel the consequence when the lever is tested by a matching threat.

---

## Resolution Sequence

When GO is pressed, the following fires in order:

1. Threat resumes movement toward ship (if it was paused at 40%)
2. Ship responds based on lever configuration:
   - Highest offensive lever activated → beam fires from ship nose toward threat
   - Highest defensive lever activated → pulse radiates from hull
   - Highest maneuver lever activated → ship slides laterally with motion trail
   - If multiplier levers are active their percentage modifier appears briefly next to the primary icon
3. Outcome calculates based on lever values vs threat type match
4. Visual result plays:
   - Clean counter → fragment burst + ship white flash + stat tick + audio chime + screen micro-pulse
   - Partial hit → threat grazes ship, smaller burst, moderate visual feedback
   - Full hit → threat impacts hull, no burst, ship shake animation, stat drops
5. One diagnosis line fades into the status bar
6. Case study tile slides in from bottom edge, holds 6 seconds, slides back out
7. Adjustment dots reset to empty
8. Next threat spawns after 1.5 seconds

---

## The Dopamine Stack — Clean Counter

All of the following fire within 0.5 seconds of a clean counter:

**Fragment burst:** 10-14 cream-colored angular fragments fly outward from the contact point. Each travels 60-80px before fading. Duration: 0.4 seconds. Generated in code as absolutely positioned divs animated with CSS transforms.

**Ship flash:** Ship SVG opacity jumps to 100% white for 0.08 seconds then transitions back to cream over 0.3 seconds. Implemented as a white overlay div on top of the ship SVG.

**Stat tick:** The highest active stat bar jumps +0.4 for 0.8 seconds then settles back to true value. Animated with CSS transition.

**Audio chime:** Web Audio API. Two tones in sequence — 523hz (C5) for 0.1 seconds then 659hz (E5) for 0.15 seconds. Generated procedurally. No audio files.

**Screen micro-pulse:** A full-viewport white div at 0.12 opacity appears for 80 milliseconds then fades to zero over 0.2 seconds.

**Combo word:** Appears centered in the battlefield above the ship in Space Mono, 28px, cream, for 0.6 seconds then fades:
- 2 clean counters in a row: `SHARP`
- 3 in a row: `PRECISE`
- 4 in a row: `COMMANDING`
- 5 in a row: `CAPTAIN`
- 6+ in a row: `SOVEREIGN`

Combo resets on any partial hit or full hit.

---

## The Unlock Ceremony Dopamine

This is the biggest spike in the game. It must feel like an achievement.

1. All active threats pause
2. Battlefield dims (80% opacity, 0.5s transition)
3. New lever slot brightens from behind (0.5s)
4. Icon fades in
5. Audio: three ascending tones — 392hz, 523hz, 659hz — each 0.15 seconds. Clean and resolved.
6. Text fades in (see ceremony spec above)
7. A single slow pulse radiates from the new lever slot outward across the panel — a ring of light that expands and fades, communicating that something new just came online
8. Text fades out
9. Battlefield returns to full opacity
10. Gameplay resumes

---

## Lever Tutorial on Unlock

After the unlock ceremony, before the next threat spawns, a single tutorial card appears at the bottom of the battlefield (same position as the main tutorial cards). It has a gold border. It shows:

- The lever icon (large, centered, 40px)
- The lever name
- One line: what it does in the game
- One line: what it means for your business
- A NEXT button

The player taps NEXT. The card disappears. The next threat spawns.

This is the only time the lever is explained. After this the icon carries the meaning.

Static strings for each lever's tutorial card:

**Differentiation:** "In the game: your ship becomes unmistakable — threats can't find a surface to grab. In your business: customers can feel the difference between you and every alternative."

**Habit Design:** "In the game: your ship moves automatically — the right dodge at the right moment. In your business: customers return without deciding to."

**Network Effects:** "In the game: your signal deflects threats before they reach you. In your business: each new customer makes the next one more likely."

**Systems:** "In the game: repair drones absorb damage so the hull doesn't have to. In your business: documented processes run without you in the room."

**Information Asymmetry:** "In the game: your offensive moves land harder because you know exactly what you're hitting. In your business: knowing what competitors don't turns every move into a precision strike."

**Time:** "In the game: your maneuvers are perfectly timed — the dodge happens at exactly the right moment. In your business: protecting high-leverage time means every strategic move costs less."

**People:** "In the game: every lever you pull gets stronger. In your business: the ceiling of your team is the ceiling of your business."

---

## Ship Positioning System

The ship has three positions: LEFT, CENTER, RIGHT.

By default the ship is at CENTER.

The MANEUVER levers (Habit Design and Network Effects) control lateral position. When either maneuver lever is the highest active lever used on a turn and GO is pressed, the ship slides to an adjacent position — CENTER to LEFT or RIGHT, LEFT or RIGHT back to CENTER.

The ship holds its position between turns. It does not auto-return to center.

This means a player can deliberately park the ship on the LEFT side of the battlefield for several turns if noise is consistently coming from the right. This is intentional strategic positioning — exactly what the maneuver levers represent in the framework.

Noise debris spawns at a random lateral position. If the noise path intersects the ship's current position, it deals 0.3 Resilience damage on contact. If the path misses the ship's current position, it passes through empty space with no damage.

The ship's three positions are rendered as three faint vertical zones on the battlefield — barely visible guidelines, present but not intrusive. The player learns to read them within two turns.

---

## The Status Bar

Fixed to the bottom of the viewport below the lever panel. Always visible. Contains:

- MOMENTUM value and bar (left)
- RESILIENCE value and bar (center)
- CLARITY value and bar (right)
- Diagnosis line above the three stats — one line of plain English, Space Mono, 10px, fades in over 0.5 seconds after each resolution
- Passenger count in the far right corner — a small dot cluster icon and a number

The status bar never scrolls. It is always in view.

---

## The Run-End Debrief API Call

When the ship is destroyed, before the death screen appears, the game assembles the following payload and sends it to the Claude API endpoint using the `/system/big-book-of-strategy.md` file as the system prompt:

```javascript
{
  intake_answers: {}, // from game_state table
  run_summary: {
    turns_survived: N,
    sector_reached: N,
    levers_unlocked: [],
    lever_values_at_death: {
      positioning: N,
      capital: N,
      switching_costs: N,
      differentiation: N,
      habit_design: N,
      network_effects: N,
      systems: N,
      information_asymmetry: N,
      time: N,
      people: N
    },
    threats_encountered: [], // array of {type, lever_used, outcome}
    noise_events_hit: N,
    killing_threat: '',
    combo_high: N,
    passenger_count_final: N
  }
}
```

The silent mapping from gameplay labels to framework labels happens here — the payload uses the full Big Book of Strategy lever names, not simplified game labels. The debrief speaks the language of the framework.

---

## Build Order for Clyde

1. Delete existing `game.js` and `levers.js` entirely
2. Create new `levers.js` — lever definitions, values, categories, unlock sectors, multiplier mappings, adjustment cap logic, color state logic
3. Create new `game.js` — game loop, threat engine, noise engine, ship position system, resolution sequence, dopamine stack, unlock ceremony, tutorial cards, death screen, run-end payload assembly
4. Rebuild lever panel UI — two rows, multiplier row, adjustment dot indicators, vertical sliders, icons
5. Implement all threat SVGs as inline code-drawn shapes — no external files
6. Implement noise debris as inline code-drawn irregular shapes
7. Implement Web Audio API chimes — three sound events: clean counter, partial hit, unlock ceremony
8. Implement ship position system — three zones, slide animation, motion trail
9. Implement fragment burst, ship flash, stat tick, screen micro-pulse, combo words
10. Implement unlock ceremony with audio
11. Implement lever tutorial cards
12. Wire run-end payload to Claude API endpoint
13. Full mobile viewport test — nothing scrolls, GO button always visible, all levers always in view
