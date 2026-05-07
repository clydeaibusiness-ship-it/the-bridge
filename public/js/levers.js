/* ============================================
   THE BRIDGE — Lever System (Complete Rebuild)
   Definitions, state, categories, multipliers,
   adjustment cap, unlock logic, color states
   ============================================ */

const LEVER_DEFS = {
  positioning: {
    name: 'POSITIONING / FOCUS',
    shortName: 'POSITIONING',
    category: 'OFFENSIVE',
    unlockSector: 1,
    icon: 'crosshair',
    defaultValue: 5,
    tutorial: null // starting lever — no tutorial card
  },
  capital: {
    name: 'CAPITAL',
    shortName: 'CAPITAL',
    category: 'DEFENSIVE',
    unlockSector: 1,
    icon: 'hexagon',
    defaultValue: 5,
    tutorial: null
  },
  switchingCosts: {
    name: 'SWITCHING COSTS',
    shortName: 'SWITCHING COSTS',
    category: 'DEFENSIVE',
    unlockSector: 1,
    icon: 'chain',
    defaultValue: 5,
    tutorial: null
  },
  differentiation: {
    name: 'DIFFERENTIATION',
    shortName: 'DIFFERENTIATION',
    category: 'OFFENSIVE',
    unlockSector: 2,
    icon: 'star4',
    defaultValue: 5,
    tutorial: {
      game: 'Your ship becomes unmistakable — threats can\'t find a surface to grab.',
      business: 'Customers can feel the difference between you and every alternative.'
    }
  },
  habitDesign: {
    name: 'HABIT DESIGN',
    shortName: 'HABIT DESIGN',
    category: 'MANEUVER',
    unlockSector: 3,
    icon: 'loop',
    defaultValue: 5,
    tutorial: {
      game: 'Your ship moves automatically — the right dodge at the right moment.',
      business: 'Customers return without deciding to.'
    }
  },
  networkEffects: {
    name: 'NETWORK EFFECTS',
    shortName: 'NETWORK EFFECTS',
    category: 'MANEUVER',
    unlockSector: 4,
    icon: 'network',
    defaultValue: 5,
    tutorial: {
      game: 'Your signal deflects threats before they reach you.',
      business: 'Each new customer makes the next one more likely.'
    }
  },
  systems: {
    name: 'SYSTEMS',
    shortName: 'SYSTEMS',
    category: 'DEFENSIVE',
    unlockSector: 5,
    icon: 'list',
    defaultValue: 5,
    tutorial: {
      game: 'Repair drones absorb damage so the hull doesn\'t have to.',
      business: 'Documented processes run without you in the room.'
    }
  }
};

const MULTIPLIER_DEFS = {
  informationAsymmetry: {
    name: 'INFORMATION ASYMMETRY',
    shortName: 'INFO ASYMMETRY',
    category: 'MULTIPLIER',
    multiplies: 'OFFENSIVE', // Positioning + Differentiation
    unlockSector: 5,
    icon: 'eye',
    defaultValue: 5,
    tutorial: {
      game: 'Your offensive moves land harder because you know exactly what you\'re hitting.',
      business: 'Knowing what competitors don\'t turns every move into a precision strike.'
    }
  },
  time: {
    name: 'TIME',
    shortName: 'TIME',
    category: 'MULTIPLIER',
    multiplies: 'MANEUVER', // Habit Design + Network Effects
    unlockSector: 6,
    icon: 'hourglass',
    defaultValue: 5,
    tutorial: {
      game: 'Your maneuvers are perfectly timed — the dodge happens at exactly the right moment.',
      business: 'Protecting high-leverage time means every strategic move costs less.'
    }
  },
  people: {
    name: 'PEOPLE',
    shortName: 'PEOPLE',
    category: 'MULTIPLIER',
    multiplies: 'ALL',
    unlockSector: 7,
    icon: 'chevron',
    defaultValue: 5,
    tutorial: {
      game: 'Every lever you pull gets stronger.',
      business: 'The ceiling of your team is the ceiling of your business.'
    }
  }
};

// All levers combined for easy iteration
const ALL_LEVERS = { ...LEVER_DEFS, ...MULTIPLIER_DEFS };

// Sector unlock map: which lever unlocks at which sector
const SECTOR_UNLOCKS = {};
for (const [id, def] of Object.entries(ALL_LEVERS)) {
  if (!SECTOR_UNLOCKS[def.unlockSector]) SECTOR_UNLOCKS[def.unlockSector] = [];
  SECTOR_UNLOCKS[def.unlockSector].push(id);
}

// Unlock ceremony text (static, no API call)
const UNLOCK_TEXT = {
  differentiation: {
    gameLine: 'Your ship becomes unmistakable to threats.',
    bizLine: 'Customers can feel the difference between you and every alternative.'
  },
  habitDesign: {
    gameLine: 'Your ship moves before you think.',
    bizLine: 'Customers return without deciding to.'
  },
  networkEffects: {
    gameLine: 'Your signal reaches further than your hull.',
    bizLine: 'Each new customer makes the next one more likely.'
  },
  systems: {
    gameLine: 'Repair drones keep the hull intact automatically.',
    bizLine: 'Documented processes run without you in the room.'
  },
  informationAsymmetry: {
    gameLine: 'Your attacks land with precision intelligence.',
    bizLine: 'Knowing what competitors don\'t is a weapon.'
  },
  time: {
    gameLine: 'Every maneuver fires at exactly the right moment.',
    bizLine: 'Protecting high-leverage time compounds everything.'
  },
  people: {
    gameLine: 'Every lever you pull hits harder.',
    bizLine: 'The ceiling of your team is the ceiling of your business.'
  }
};

/**
 * Calculate multiplier bonus for a lever based on active multipliers
 * Returns a multiplier float (e.g. 1.3 for 30% bonus)
 */
function getMultiplierBonus(leverCategory, leverValues) {
  let bonus = 1.0;

  // Check each multiplier
  for (const [id, def] of Object.entries(MULTIPLIER_DEFS)) {
    if (def.multiplies === leverCategory || def.multiplies === 'ALL') {
      const val = leverValues[id];
      if (val === undefined) continue;
      // Multiplier at 10: +30%, at 7: +15%, at 4: +0%, at 2: -15%, at 0: -30%
      const pct = (val - 4) * 5; // -20 to +30 range
      bonus += pct / 100;
    }
  }

  return Math.max(0.5, bonus); // Floor at 50%
}

/**
 * Get the multiplier percentage for display
 * Returns the percentage modifier from a single multiplier lever value
 */
function getMultiplierPct(multiplierValue) {
  // 10 → +30%, 7 → +15%, 4 → 0%, 2 → -10%, 0 → -20%
  return (multiplierValue - 4) * 5;
}

/**
 * Determine how many adjustments the player gets this turn
 * Default 3, reduced by Time or People penalties
 */
function getAdjustmentCap(leverValues, currentSector) {
  let cap = 3;

  // Time penalty: at 2 or below, lose 1 adjustment
  if (currentSector >= 6 && leverValues.time !== undefined && leverValues.time <= 2) {
    cap--;
  }

  // People penalty: at 2 or below, lose 1 adjustment
  if (currentSector >= 7 && leverValues.people !== undefined && leverValues.people <= 2) {
    cap--;
  }

  return Math.max(1, cap); // Always at least 1
}

/**
 * Get the color state for a lever track
 * Returns 'active' or 'neglected'
 */
function getLeverColorState(value) {
  return value >= 4 ? 'active' : 'neglected';
}

/**
 * Get which levers are unlocked for a given sector
 */
function getUnlockedLevers(currentSector) {
  const unlocked = [];
  for (let s = 1; s <= currentSector; s++) {
    if (SECTOR_UNLOCKS[s]) {
      unlocked.push(...SECTOR_UNLOCKS[s]);
    }
  }
  return unlocked;
}

/**
 * Get the NEW levers that unlock at a specific sector (for ceremony)
 */
function getNewLeversForSector(sector) {
  return SECTOR_UNLOCKS[sector] || [];
}

/**
 * Draw a lever icon as inline SVG
 */
function drawLeverIcon(iconType, size = 24) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.style.display = 'block';

  const cream = '#f5f0e8';

  switch (iconType) {
    case 'crosshair': {
      // Circle with 4 cardinal lines
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '6');
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', cream); c.setAttribute('stroke-width', '1.5');
      svg.appendChild(c);
      [[12,2,12,6],[12,18,12,22],[2,12,6,12],[18,12,22,12]].forEach(([x1,y1,x2,y2]) => {
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2);
        l.setAttribute('stroke', cream); l.setAttribute('stroke-width', '1.5');
        svg.appendChild(l);
      });
      break;
    }
    case 'hexagon': {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(`${12 + 8 * Math.cos(a)},${12 + 8 * Math.sin(a)}`);
      }
      const p = document.createElementNS(ns, 'polygon');
      p.setAttribute('points', pts.join(' '));
      p.setAttribute('fill', cream);
      svg.appendChild(p);
      break;
    }
    case 'chain': {
      // Two interlocked ovals
      const e1 = document.createElementNS(ns, 'ellipse');
      e1.setAttribute('cx','9'); e1.setAttribute('cy','12'); e1.setAttribute('rx','5'); e1.setAttribute('ry','3.5');
      e1.setAttribute('fill','none'); e1.setAttribute('stroke',cream); e1.setAttribute('stroke-width','1.5');
      const e2 = document.createElementNS(ns, 'ellipse');
      e2.setAttribute('cx','15'); e2.setAttribute('cy','12'); e2.setAttribute('rx','5'); e2.setAttribute('ry','3.5');
      e2.setAttribute('fill','none'); e2.setAttribute('stroke',cream); e2.setAttribute('stroke-width','1.5');
      svg.appendChild(e1); svg.appendChild(e2);
      break;
    }
    case 'star4': {
      // Four-pointed star
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M12,2 L14,10 L22,12 L14,14 L12,22 L10,14 L2,12 L10,10 Z');
      path.setAttribute('fill', cream);
      svg.appendChild(path);
      break;
    }
    case 'loop': {
      // Circular arrow
      const arc = document.createElementNS(ns, 'path');
      arc.setAttribute('d', 'M12,4 A8,8 0 1,1 5,8');
      arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', cream); arc.setAttribute('stroke-width', '1.5');
      arc.setAttribute('stroke-linecap', 'round');
      // Arrowhead
      const arrow = document.createElementNS(ns, 'path');
      arrow.setAttribute('d', 'M5,4 L5,9 L9,7');
      arrow.setAttribute('fill', cream);
      svg.appendChild(arc); svg.appendChild(arrow);
      break;
    }
    case 'network': {
      // Three dots with two connecting lines
      [[8,8],[16,8],[12,17]].forEach(([cx,cy]) => {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r','2.5');
        c.setAttribute('fill', cream);
        svg.appendChild(c);
      });
      [[8,8,16,8],[8,8,12,17],[16,8,12,17]].forEach(([x1,y1,x2,y2]) => {
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2);
        l.setAttribute('stroke', cream); l.setAttribute('stroke-width', '1');
        svg.appendChild(l);
      });
      break;
    }
    case 'list': {
      // Three horizontal lines of decreasing length
      [[4,8,20],[4,12,17],[4,16,14]].forEach(([x,y,w]) => {
        const l = document.createElementNS(ns, 'line');
        l.setAttribute('x1',x); l.setAttribute('y1',y); l.setAttribute('x2',w); l.setAttribute('y2',y);
        l.setAttribute('stroke', cream); l.setAttribute('stroke-width', '2');
        l.setAttribute('stroke-linecap', 'round');
        svg.appendChild(l);
      });
      break;
    }
    case 'eye': {
      // Simple open eye
      const outline = document.createElementNS(ns, 'path');
      outline.setAttribute('d', 'M2,12 Q12,4 22,12 Q12,20 2,12 Z');
      outline.setAttribute('fill', 'none'); outline.setAttribute('stroke', cream); outline.setAttribute('stroke-width', '1.5');
      const pupil = document.createElementNS(ns, 'circle');
      pupil.setAttribute('cx','12'); pupil.setAttribute('cy','12'); pupil.setAttribute('r','3');
      pupil.setAttribute('fill', cream);
      svg.appendChild(outline); svg.appendChild(pupil);
      break;
    }
    case 'hourglass': {
      // Two triangles point-to-point with center dot
      const top = document.createElementNS(ns, 'path');
      top.setAttribute('d', 'M6,4 L18,4 L12,12 Z');
      top.setAttribute('fill', 'none'); top.setAttribute('stroke', cream); top.setAttribute('stroke-width', '1.5');
      const bot = document.createElementNS(ns, 'path');
      bot.setAttribute('d', 'M6,20 L18,20 L12,12 Z');
      bot.setAttribute('fill', 'none'); bot.setAttribute('stroke', cream); bot.setAttribute('stroke-width', '1.5');
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx','12'); dot.setAttribute('cy','12'); dot.setAttribute('r','1.5');
      dot.setAttribute('fill', cream);
      svg.appendChild(top); svg.appendChild(bot); svg.appendChild(dot);
      break;
    }
    case 'chevron': {
      // Single upward-pointing chevron
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M4,16 L12,8 L20,16');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', cream); path.setAttribute('stroke-width', '2.5');
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      break;
    }
  }
  return svg;
}
