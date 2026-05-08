/* ============================================
   THE BRIDGE — Anonymous Event Logger
   Tracks game events without identity linkage
   ============================================ */

class AnalyticsLogger {
  constructor() {
    // Generate session ID per page load
    this.sessionId = this.getOrCreateSessionId();
    this.events = [];
    this.sessionData = {
      session_id: this.sessionId,
      industry: null,
      biggest_uncertainty: null,
      starting_levers: null,
      threats_encountered: [],
      turns_survived: 0,
      email_captured: false,
      converted_to_member: false
    };
  }

  getOrCreateSessionId() {
    let id = sessionStorage.getItem('bridge_session_id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : 
           'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
             const r = Math.random() * 16 | 0;
             return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
           });
      sessionStorage.setItem('bridge_session_id', id);
    }
    return id;
  }

  /**
   * Log intake completion
   */
  logIntake(industry, biggestUncertainty, startingLevers) {
    this.sessionData.industry = industry;
    this.sessionData.biggest_uncertainty = biggestUncertainty;
    this.sessionData.starting_levers = { ...startingLevers };
    this.flush();
  }

  /**
   * Log a threat encounter
   */
  logThreat(threatType, turnNumber, leverConfig, adjustedBeforeGo) {
    this.sessionData.threats_encountered.push({
      type: threatType,
      turn: turnNumber,
      levers: { ...leverConfig },
      adjusted: adjustedBeforeGo
    });
    this.sessionData.turns_survived = turnNumber;
    this.flush();
  }

  /**
   * Log threat resolution (damage dealt)
   */
  logThreatResult(threatType, turnNumber, damageDealt, survived) {
    const last = this.sessionData.threats_encountered[
      this.sessionData.threats_encountered.length - 1
    ];
    if (last) {
      last.damage = damageDealt;
      last.survived = survived;
    }
    this.flush();
  }

  /**
   * Log email capture at death wall
   */
  logEmailCapture() {
    this.sessionData.email_captured = true;
    this.flush();
  }

  /**
   * Log conversion to paid member
   */
  logConversion() {
    this.sessionData.converted_to_member = true;
    this.flush();
  }

  /**
   * Send accumulated data to server
   */
  async flush() {
    try {
      await fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.sessionData)
      });
    } catch (e) {
      // Silent fail — analytics should never break the game
      console.debug('Analytics flush failed:', e.message);
    }
  }
}

// Global instance
const analytics = new AnalyticsLogger();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AnalyticsLogger };
}
