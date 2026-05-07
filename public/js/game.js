/* ============================================
   THE BRIDGE — Core Game Logic
   Orchestrates intake, turns, threats, death
   ============================================ */

class BridgeGame {
  constructor() {
    this.state = {
      phase: 'intake',       // intake | tutorial | playing | paused | dead
      levers: {},
      previousLevers: {},
      stats: { momentum: 5, resilience: 5, clarity: 5 },
      hp: 10,
      focusPoints: 20,
      turn: 0,
      sector: 1,
      passengerCount: 0,
      shipName: '',
      destinationName: '',
      flavorText: '',
      threatLog: [],
      leverDecisions: [],
      intakeAnswers: {},
      currentThreat: null,
      tutorialDone: false,
      caseStudies: {}
    };

    this.ship = null;
    this.threatEl = null;
    this.threatAnimFrame = null;
    this.threatPosition = 0;  // 0 = top, 100 = bottom
    this.threatPaused = false;

    this.elements = {};
  }

  async init() {
    // Cache DOM elements
    this.elements = {
      battlefield: document.querySelector('.battlefield'),
      leverPanel: document.querySelector('.lever-panel'),
      statusBar: document.querySelector('.status-bar'),
      goButton: document.querySelector('.go-button'),
      focusDisplay: document.querySelector('.focus-points-value'),
      diagnosisLine: document.querySelector('.diagnosis-line'),
      sectorDisplay: document.querySelector('.sector-display'),
      turnDisplay: document.querySelector('.turn-display'),
      intakeOverlay: document.querySelector('.intake-overlay'),
      tutorialOverlay: document.querySelector('.tutorial-overlay'),
      deathOverlay: document.querySelector('.death-overlay'),
      shipContainer: document.querySelector('.ship-container'),
      destinationLabel: document.querySelector('.destination-label')
    };

    // Load case studies
    try {
      const res = await fetch('/data/case-studies.json');
      this.state.caseStudies = await res.json();
    } catch (e) {
      console.warn('Case studies not loaded');
    }

    // Initialize ship controller
    if (this.elements.shipContainer) {
      this.ship = new ShipController(this.elements.shipContainer);
    }

    // Set up GO button
    if (this.elements.goButton) {
      this.elements.goButton.addEventListener('click', () => this.onGo());
      this.elements.goButton.disabled = true;
    }

    // Check for saved game state
    const saved = await this.loadGameState();
    if (saved) {
      this.restoreState(saved);
    } else {
      this.showIntake();
    }
  }

  // ---- INTAKE ----

  showIntake() {
    this.state.phase = 'intake';
    if (this.elements.intakeOverlay) {
      this.elements.intakeOverlay.style.display = 'flex';
    }

    const form = document.getElementById('intake-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.processIntake(form);
      });
    }
  }

  async processIntake(form) {
    const data = new FormData(form);
    const answers = {};
    for (const [key, value] of data.entries()) {
      answers[key] = value;
    }

    this.state.intakeAnswers = answers;

    // Calculate starting levers
    this.state.levers = calculateStartingLevers(answers);
    this.state.previousLevers = { ...this.state.levers };
    this.state.stats = calculateStats(this.state.levers);
    this.state.hp = calculateShipHP(this.state.stats);

    // Log to analytics
    analytics.logIntake(answers.industry, answers.biggestUncertainty, this.state.levers);

    // Call API for ship personalization
    try {
      const res = await fetch('/api/game/personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intake: answers })
      });

      if (res.ok) {
        const personalization = await res.json();
        this.state.shipName = personalization.ship_name;
        this.state.destinationName = personalization.destination_name;
        this.state.flavorText = personalization.flavor_text;
      } else {
        // Fallback names
        this.state.shipName = 'The Venture';
        this.state.destinationName = 'North Star';
        this.state.flavorText = 'Your ship awaits, Captain.';
      }
    } catch (e) {
      this.state.shipName = 'The Venture';
      this.state.destinationName = 'North Star';
      this.state.flavorText = 'Your ship awaits, Captain.';
    }

    // Hide intake
    if (this.elements.intakeOverlay) {
      this.elements.intakeOverlay.style.display = 'none';
    }

    // Update displays
    this.updateShipName();
    this.updateLeversUI();
    this.updateStatsUI();

    // Check if tutorial needed
    const tutorialSeen = localStorage.getItem('bridge_tutorial_done');
    if (!tutorialSeen) {
      this.startTutorial();
    } else {
      this.startPlaying();
    }
  }

  // ---- TUTORIAL ----

  startTutorial() {
    this.state.phase = 'tutorial';
    this.state.tutorialStep = 0;

    const steps = [
      {
        target: '.ship-container',
        text: `This is ${this.state.shipName}. It represents your business. Its appearance changes as you adjust your levers.`
      },
      {
        target: '.lever-panel',
        text: `These are your strategic levers. Each one controls a different aspect of how your business operates. You have 20 Focus Points to spend adjusting them each turn.`
      },
      {
        target: '.status-bar',
        text: `Momentum moves you forward. Resilience absorbs hits. Clarity keeps you on course. Watch all three.`
      },
      {
        target: '.battlefield',
        text: `Threats appear based on your weakest lever. Adjust your levers, then press GO.`,
        spawnPractice: true
      },
      {
        target: '.go-button',
        text: `When you're ready, press GO. The ship responds to your configuration. Watch what happens.`
      }
    ];

    if (this.elements.tutorialOverlay) {
      this.elements.tutorialOverlay.classList.add('active');
    }

    this.tutorialSteps = steps;
    this.showTutorialStep(0);
  }

  showTutorialStep(index) {
    if (index >= this.tutorialSteps.length) {
      this.endTutorial();
      return;
    }

    const step = this.tutorialSteps[index];
    this.state.tutorialStep = index;

    const spotlight = this.elements.tutorialOverlay.querySelector('.tutorial-spotlight');
    const textBox = this.elements.tutorialOverlay.querySelector('.tutorial-text-box');
    const nextBtn = this.elements.tutorialOverlay.querySelector('.tutorial-next');
    const dots = this.elements.tutorialOverlay.querySelectorAll('.tutorial-dot');

    // Position spotlight on target
    const target = document.querySelector(step.target);
    if (target && spotlight) {
      const rect = target.getBoundingClientRect();
      spotlight.style.left = rect.left - 8 + 'px';
      spotlight.style.top = rect.top - 8 + 'px';
      spotlight.style.width = rect.width + 16 + 'px';
      spotlight.style.height = rect.height + 16 + 'px';
    }

    // Set text
    if (textBox) {
      textBox.querySelector('.tutorial-text').textContent = step.text;
      // Text box is fixed-positioned via CSS — no manual positioning needed
    }

    // Update dots
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });

    // Spawn practice threat on step 4
    if (step.spawnPractice) {
      this.spawnPracticeThreat();
    }

    // Next button
    if (nextBtn) {
      nextBtn.onclick = () => this.showTutorialStep(index + 1);
    }
  }

  spawnPracticeThreat() {
    // Visual only, no damage
    const weakestLever = Object.entries(this.state.levers)
      .filter(([k]) => THREAT_MAP[k])
      .sort(([,a], [,b]) => a - b)[0][0];

    const threatId = THREAT_MAP[weakestLever];
    this.showThreatOnBattlefield(threatId, true);
  }

  endTutorial() {
    if (this.elements.tutorialOverlay) {
      this.elements.tutorialOverlay.classList.remove('active');
    }
    localStorage.setItem('bridge_tutorial_done', 'true');

    // Show flavor text briefly
    if (this.elements.diagnosisLine) {
      this.elements.diagnosisLine.textContent = `You have the helm. Good luck, Captain.`;
      this.elements.diagnosisLine.classList.add('visible');
      setTimeout(() => {
        this.elements.diagnosisLine.classList.remove('visible');
        this.startPlaying();
      }, 3000);
    } else {
      this.startPlaying();
    }
  }

  // ---- GAMEPLAY ----

  startPlaying() {
    this.state.phase = 'playing';
    this.elements.goButton.disabled = false;
    this.state.focusPoints = FOCUS_POINTS_PER_TURN;
    this.updateFocusDisplay();
    this.spawnThreat();
  }

  spawnThreat() {
    const threatId = selectThreat(this.state.levers, this.state.threatLog.map(t => t.type));
    this.state.currentThreat = threatId;

    // Show threat info in status bar
    if (this.elements.diagnosisLine) {
      this.elements.diagnosisLine.textContent = `${THREAT_NAMES[threatId]}: ${THREAT_DESCRIPTIONS[threatId]}`;
      this.elements.diagnosisLine.classList.add('visible');
    }

    // Highlight counter lever
    const counterLever = THREAT_COUNTER_LEVER[threatId];
    document.querySelectorAll('.lever-label').forEach(el => {
      el.classList.remove('highlighted');
    });
    const counterLabel = document.querySelector(`[data-lever="${counterLever}"] .lever-label`);
    if (counterLabel) {
      counterLabel.classList.add('highlighted');
    }

    // Animate threat
    this.showThreatOnBattlefield(threatId, false);
  }

  showThreatOnBattlefield(threatId, practiceMode) {
    // Remove existing threat
    if (this.threatEl) {
      this.threatEl.remove();
    }

    this.threatEl = document.createElement('div');
    this.threatEl.className = 'threat';
    this.threatEl.innerHTML = `<img src="/assets/svg/threats/${threatId}.svg" alt="${THREAT_NAMES[threatId]}" style="width:100%;height:100%;filter:invert(0.9);">`;

    this.elements.battlefield.appendChild(this.threatEl);

    const speed = calculateThreatSpeed(this.state.levers);
    const pauseAt = 40; // percentage
    this.threatPosition = 0;
    this.threatPaused = false;

    const startTime = performance.now();
    const totalDuration = speed * 1000;
    const pauseDuration = practiceMode ? 999999 : totalDuration; // practice threats pause indefinitely

    const animate = (now) => {
      if (this.state.phase === 'dead') return;

      const elapsed = now - startTime;

      if (!this.threatPaused) {
        this.threatPosition = (elapsed / totalDuration) * 100;

        if (this.threatPosition >= pauseAt && !practiceMode) {
          this.threatPaused = true;
          this.threatPosition = pauseAt;
          // Player can now adjust levers and press GO
          if (this.ship) this.ship.threatNear(true);
        }
      }

      const battlefieldHeight = this.elements.battlefield.offsetHeight;
      const topPx = (this.threatPosition / 100) * battlefieldHeight;
      this.threatEl.style.top = topPx + 'px';

      if (this.threatPosition < 100) {
        this.threatAnimFrame = requestAnimationFrame(animate);
      }
    };

    this.threatAnimFrame = requestAnimationFrame(animate);
  }

  onGo() {
    if (this.state.phase === 'tutorial') {
      // Tutorial GO just advances
      this.showTutorialStep(this.state.tutorialStep + 1);
      return;
    }

    if (this.state.phase !== 'playing' || !this.state.currentThreat) return;

    this.state.turn++;
    this.elements.goButton.disabled = true;

    // Record lever decisions
    const adjustedBeforeGo = JSON.stringify(this.state.levers) !== JSON.stringify(this.state.previousLevers);
    this.state.leverDecisions.push({
      turn: this.state.turn,
      levers: { ...this.state.levers },
      adjusted: adjustedBeforeGo
    });

    // Log to analytics
    analytics.logThreat(this.state.currentThreat, this.state.turn, this.state.levers, adjustedBeforeGo);

    // Resume threat animation toward ship
    this.threatPaused = false;

    // Calculate damage
    const result = calculateThreatDamage(this.state.currentThreat, this.state.levers);

    // Animate threat reaching ship
    setTimeout(() => {
      this.resolveThreat(result);
    }, 1500);
  }

  resolveThreat(result) {
    // Apply damage
    this.state.hp -= result.damage;

    // Record threat
    this.state.threatLog.push({
      type: this.state.currentThreat,
      turn: this.state.turn,
      damage: result.damage,
      leverUsed: result.leverUsed,
      leverValue: result.leverValue
    });

    // Ship reacts
    if (this.ship) {
      this.ship.takeDamage();
      this.ship.threatNear(false);
    }

    // Log result
    analytics.logThreatResult(this.state.currentThreat, this.state.turn, result.damage, this.state.hp > 0);

    // Remove threat element
    if (this.threatEl) {
      this.threatEl.remove();
      this.threatEl = null;
    }

    // Clear lever highlights
    document.querySelectorAll('.lever-label').forEach(el => el.classList.remove('highlighted'));

    // Recalculate stats
    this.state.stats = calculateStats(this.state.levers);
    this.updateStatsUI();

    // Get case study
    const caseStudy = getCaseStudy(this.state.currentThreat, this.state.caseStudies);

    // Show diagnosis
    const diagnosis = generateDiagnosis(this.state.stats, this.state.levers);
    if (this.elements.diagnosisLine) {
      this.elements.diagnosisLine.textContent = diagnosis;
      this.elements.diagnosisLine.classList.add('visible');
    }

    // Update turn display
    this.updateTurnDisplay();

    // Check death
    if (this.state.hp <= 0) {
      this.state.hp = 0;
      this.die();
      return;
    }

    // Passenger check — gain passengers when doing well
    if (result.damage < 1) {
      this.state.passengerCount++;
    }

    // Prepare next turn
    this.state.previousLevers = { ...this.state.levers };
    this.state.focusPoints = FOCUS_POINTS_PER_TURN;
    this.updateFocusDisplay();
    this.state.currentThreat = null;

    // Short pause then spawn next threat
    setTimeout(() => {
      this.elements.goButton.disabled = false;
      this.elements.diagnosisLine.classList.remove('visible');
      this.spawnThreat();
    }, 3000);
  }

  // ---- DEATH ----

  die() {
    this.state.phase = 'dead';
    cancelAnimationFrame(this.threatAnimFrame);

    // Destroy ship
    if (this.ship) {
      this.ship.destroy();
    }

    // Remove threat
    if (this.threatEl) {
      this.threatEl.remove();
    }

    const killingThreat = this.state.threatLog[this.state.threatLog.length - 1]?.type || 'unknown';

    // Show death screen after ship animation
    setTimeout(() => {
      this.showDeathScreen(killingThreat);
    }, 2000);

    // Fire debrief API call
    this.requestDebrief(killingThreat);
  }

  showDeathScreen(killingThreat) {
    if (!this.elements.deathOverlay) return;

    // Set content
    const nameEl = this.elements.deathOverlay.querySelector('.death-ship-name');
    const summaryEl = this.elements.deathOverlay.querySelector('.death-summary');

    if (nameEl) nameEl.textContent = `${this.state.shipName} has been destroyed.`;
    if (summaryEl) summaryEl.textContent = THREAT_DEATH_TEMPLATES[killingThreat] || 'Your ship has been lost.';

    this.elements.deathOverlay.classList.add('active');

    // Wire up buttons
    const continueBtn = this.elements.deathOverlay.querySelector('.death-cta-primary');
    const memberBtn = this.elements.deathOverlay.querySelector('.death-cta-secondary');

    if (continueBtn) {
      continueBtn.addEventListener('click', () => {
        // Trigger email capture / Clerk magic link
        window.location.href = '/login?action=save&return=/game';
      });
    }

    if (memberBtn) {
      memberBtn.addEventListener('click', () => {
        // Link to pricing with intake data
        const params = new URLSearchParams({ from: 'game' });
        window.location.href = '/#pricing?' + params.toString();
      });
    }
  }

  async requestDebrief(killingThreat) {
    try {
      const res = await fetch('/api/game/debrief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_history: {
            threat_log: this.state.threatLog,
            lever_decisions: this.state.leverDecisions,
            final_stats: this.state.stats,
            killing_threat: killingThreat,
            turns_survived: this.state.turn
          },
          intake_answers: this.state.intakeAnswers
        })
      });

      if (res.ok) {
        const data = await res.json();
        // Show debrief link
        const debriefStatus = this.elements.deathOverlay.querySelector('.death-debrief-status');
        if (debriefStatus) {
          debriefStatus.classList.add('ready');
          debriefStatus.innerHTML = `Your run summary is ready. <a href="/api/game/debrief/${data.id}">View your Navigation Chart.</a>`;
        }
      }
    } catch (e) {
      console.debug('Debrief request failed');
    }
  }

  // ---- UI UPDATES ----

  updateShipName() {
    if (this.elements.destinationLabel) {
      this.elements.destinationLabel.textContent = this.state.destinationName;
    }
    if (this.elements.sectorDisplay) {
      this.elements.sectorDisplay.textContent = `SECTOR ${this.state.sector} — ${this.state.shipName}`;
    }
  }

  updateLeversUI() {
    LEVER_KEYS.forEach(key => {
      const slider = document.querySelector(`[data-lever="${key}"] .lever-slider`);
      const valueEl = document.querySelector(`[data-lever="${key}"] .lever-value`);
      if (slider) {
        slider.value = this.state.levers[key];
        slider.min = 1;
        slider.max = 10;
      }
      if (valueEl) {
        valueEl.textContent = this.state.levers[key];
      }
    });

    // Ship visual update
    if (this.ship) {
      this.ship.updateState(this.state.levers);
    }
  }

  updateStatsUI() {
    ['momentum', 'resilience', 'clarity'].forEach(stat => {
      const numEl = document.querySelector(`.stat-readout[data-stat="${stat}"] .stat-number`);
      const barEl = document.querySelector(`.stat-readout[data-stat="${stat}"] .stat-bar-fill`);
      if (numEl) numEl.textContent = this.state.stats[stat].toFixed(1);
      if (barEl) barEl.style.width = `${(this.state.stats[stat] / 10) * 100}%`;
    });
  }

  updateFocusDisplay() {
    if (this.elements.focusDisplay) {
      this.elements.focusDisplay.textContent = this.state.focusPoints;
    }
  }

  updateTurnDisplay() {
    if (this.elements.turnDisplay) {
      this.elements.turnDisplay.textContent = `TURN ${this.state.turn}`;
    }
  }

  /**
   * Called when a lever slider changes
   */
  onLeverChange(leverKey, newValue) {
    newValue = parseInt(newValue);
    const oldValue = this.state.previousLevers[leverKey];
    const cost = calculateAdjustmentCost(oldValue, newValue);

    // Calculate total cost of all changes this turn
    const testLevers = { ...this.state.levers, [leverKey]: newValue };
    const validation = validateLeverChanges(this.state.previousLevers, testLevers, FOCUS_POINTS_PER_TURN);

    if (validation.valid) {
      this.state.levers[leverKey] = newValue;
      this.state.focusPoints = validation.remaining;
      this.updateFocusDisplay();
      this.state.stats = calculateStats(this.state.levers);
      this.updateStatsUI();
      this.updateLeversUI();
    } else {
      // Revert slider
      const slider = document.querySelector(`[data-lever="${leverKey}"] .lever-slider`);
      if (slider) slider.value = this.state.levers[leverKey];
    }
  }

  // ---- PERSISTENCE ----

  async loadGameState() {
    try {
      const res = await fetch('/api/game/state');
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {}
    return null;
  }

  restoreState(saved) {
    if (saved.levers) {
      this.state.levers = saved.levers;
      this.state.previousLevers = { ...saved.levers };
      this.state.stats = calculateStats(saved.levers);
      this.state.hp = calculateShipHP(this.state.stats);
      this.state.shipName = saved.ship_name || 'The Venture';
      this.state.destinationName = saved.destination_name || 'North Star';
      this.state.turn = saved.turn || 0;
      this.state.sector = saved.sector || 1;
      this.state.intakeAnswers = saved.intake_answers || {};

      this.updateShipName();
      this.updateLeversUI();
      this.updateStatsUI();
      this.startPlaying();
    } else {
      this.showIntake();
    }
  }
}

// ---- INITIALIZATION ----
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.game-page')) {
    const game = new BridgeGame();
    game.init();

    // Wire lever sliders
    document.querySelectorAll('.lever-item').forEach(item => {
      const slider = item.querySelector('.lever-slider');
      const leverKey = item.dataset.lever;
      if (slider && leverKey) {
        slider.addEventListener('input', (e) => {
          game.onLeverChange(leverKey, e.target.value);
        });
      }
    });

    // Make game accessible globally for debugging
    window.bridgeGame = game;
  }
});
