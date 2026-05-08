/* ============================================
   THE BRIDGE — Ship Rendering & Animation
   Controls visual state based on lever values
   ============================================ */

class ShipController {
  constructor(containerEl) {
    this.container = containerEl;
    this.shieldRing = null;
    this.particles = [];
    this.destroyed = false;
    this.init();
  }

  init() {
    // Create shield ring element
    this.shieldRing = document.createElement('div');
    this.shieldRing.className = 'shield-ring';
    this.container.appendChild(this.shieldRing);
  }

  /**
   * Update ship visual state based on current levers
   */
  updateState(levers) {
    if (this.destroyed) return;

    const c = this.container;

    // Clear state classes
    c.classList.remove('high-momentum', 'low-momentum');

    // Momentum states
    if (levers.positioning >= 7 || levers.differentiation >= 7 || levers.habitDesign >= 7) {
      c.classList.add('high-momentum');
      // Lengthen engine trail
      const trail = c.querySelector('.engine-trail');
      if (trail) {
        trail.setAttribute('height', '45');
        trail.style.opacity = '0.6';
      }
    } else if (levers.positioning <= 3 && levers.differentiation <= 3) {
      c.classList.add('low-momentum');
      const trail = c.querySelector('.engine-trail');
      if (trail) {
        trail.setAttribute('height', '20');
        trail.style.opacity = '0.2';
      }
    } else {
      const trail = c.querySelector('.engine-trail');
      if (trail) {
        trail.setAttribute('height', '30');
        trail.style.opacity = '0.4';
      }
    }

    // Resilience — shield ring
    const avgResilience = (levers.switchingCosts * 0.4 + levers.capital * 0.35 + levers.time * 0.25);
    if (avgResilience >= 7) {
      this.shieldRing.classList.add('active');
    } else {
      this.shieldRing.classList.remove('active');
    }

    // Hull color based on resilience
    const hull = c.querySelector('.ship-hull');
    if (hull) {
      if (avgResilience <= 3) {
        hull.setAttribute('fill', '#c8c0b0'); // dimmed
      } else {
        hull.setAttribute('fill', '#f5f0e8'); // full
      }
    }

    // Cockpit brightness based on People influence
    // (approximated via overall lever health)
    const avgAll = Object.values(levers).reduce((a, b) => a + b, 0) / Object.keys(levers).length;
    const cockpit = c.querySelector('.ship-cockpit');
    if (cockpit) {
      if (avgAll >= 7) {
        cockpit.setAttribute('stroke', '#f5f0e8');
        cockpit.setAttribute('stroke-width', '1.5');
      } else {
        cockpit.setAttribute('stroke', '#c8b89a');
        cockpit.setAttribute('stroke-width', '1');
      }
    }
  }

  /**
   * Show threat proximity effect on shield
   */
  threatNear(active) {
    if (active) {
      this.shieldRing.classList.add('threat-near');
    } else {
      this.shieldRing.classList.remove('threat-near');
    }
  }

  /**
   * Play damage animation
   */
  takeDamage() {
    this.container.classList.add('taking-damage');
    setTimeout(() => {
      this.container.classList.remove('taking-damage');
    }, 300);
  }

  /**
   * Play destruction sequence
   */
  destroy() {
    this.destroyed = true;
    this.container.classList.add('destroyed');

    // Particle burst
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.className = 'destruction-particle';
      const angle = (i / 8) * Math.PI * 2;
      const dist = 40 + Math.random() * 30;
      particle.style.setProperty('--px', `${Math.cos(angle) * dist}px`);
      particle.style.setProperty('--py', `${Math.sin(angle) * dist}px`);
      particle.style.left = '50%';
      particle.style.top = '50%';
      this.container.appendChild(particle);
    }

    // Remove particles after animation
    setTimeout(() => {
      this.container.querySelectorAll('.destruction-particle').forEach(p => p.remove());
    }, 1200);
  }

  /**
   * Reset ship for a new run
   */
  reset() {
    this.destroyed = false;
    this.container.classList.remove('destroyed', 'high-momentum', 'low-momentum', 'taking-damage');
    this.container.style.opacity = '1';
    this.shieldRing.classList.remove('active', 'threat-near');
    this.container.querySelectorAll('.destruction-particle').forEach(p => p.remove());
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShipController };
}
