/**
 * principles.js — parses big-book-of-strategy.md into structured principles.
 *
 * Each principle carries its lever, the book and author it belongs to, and the
 * full text. match.js uses this to choose what Earl teaches; write.js uses it
 * so the attribution in Section 2 is exact and never invented.
 */

const fs = require('fs');
const path = require('path');

const BOOK_PATH = path.join(__dirname, '../../../system/big-book-of-strategy.md');

let cache = null;

/**
 * Parse the markdown once. Levers are "### Lever N — Title" headers; principles
 * are bullet lines beneath them, most ending in "(Book — Author)".
 */
function parse() {
  if (cache) return cache;
  const md = fs.readFileSync(BOOK_PATH, 'utf8');
  const lines = md.split('\n');

  const principles = [];
  let lever = null;
  let leverLabel = null;

  const leverHeader = /^#{3,4}\s+Lever\s+(\d+[a-z]?)\s+[—-]\s+(.+)$/i;
  const bullet = /^-\s+(.+)$/;
  // Trailing "(Book Title — Author Name)" or "(Case study: X)".
  const attribution = /\(([^()]+?)\s+[—-]\s+([^()]+?)\)\s*$/;
  const caseAttribution = /\((Case study|Framework[^)]*|Good[^)]*)\)\s*$/i;

  for (const raw of lines) {
    const line = raw.trim();
    const lh = line.match(leverHeader);
    if (lh) {
      // "9a" → treat as lever 9 for routing.
      lever = parseInt(lh[1], 10);
      leverLabel = lh[2].trim();
      continue;
    }
    if (lever == null) continue; // skip the Strategy Canvas section above the levers

    const b = line.match(bullet);
    if (!b) continue;
    let text = b[1].trim();
    let book = null;
    let author = null;

    const at = text.match(attribution);
    if (at) {
      book = at[1].trim();
      author = at[2].trim();
      text = text.replace(attribution, '').trim();
    } else if (caseAttribution.test(text)) {
      text = text.replace(caseAttribution, '').trim();
    }

    // Skip the italic intro lines under each lever header (they aren't principles).
    if (text.startsWith('*') || text.length < 20) continue;

    principles.push({ lever, leverLabel, book, author, text });
  }

  cache = principles;
  return principles;
}

/** All principles for a given lever number. */
function byLever(leverNum) {
  return parse().filter((p) => p.lever === leverNum);
}

/** All principles across any of the given levers. */
function byLevers(leverNums = []) {
  const set = new Set(leverNums);
  return parse().filter((p) => set.has(p.lever));
}

module.exports = { parse, byLever, byLevers };
