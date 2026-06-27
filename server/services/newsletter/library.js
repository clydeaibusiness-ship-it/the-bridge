/**
 * library.js — reads resource-library.json and hands Earl only the slice he
 * needs for the principle he is teaching.
 *
 * The robustness lives in the file. The relevance and rotation live here, in
 * plain code, so the writing call never carries the whole library. Earl makes
 * the final best-fit choice from the small shortlist this returns.
 *
 * Flow: filter to the lever/principle, drop anything used too recently, return
 * the survivors. Usage is stamped (markUsed) only when an issue actually sends.
 */

const fs = require('fs');
const path = require('path');

const LIBRARY_PATH = path.join(__dirname, '../../data/resource-library.json');

function load() {
  return JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
}

/**
 * Has this resource been used within the cooldown window?
 * last_used null/absent means never used — always fresh.
 */
function usedRecently(resource, cooldownDays) {
  if (!resource.last_used) return false;
  const used = new Date(resource.last_used).getTime();
  if (Number.isNaN(used)) return false;
  const ageDays = (Date.now() - used) / (1000 * 60 * 60 * 24);
  return ageDays < cooldownDays;
}

/**
 * Build the shortlist of resources for a principle.
 *
 * @param {Object} opts
 * @param {number} [opts.lever]        Lever number the principle sits under.
 * @param {string} [opts.principle]    Principle text, matched loosely against each entry.
 * @param {number} [opts.cooldownDays] Skip resources used within this many days (default 30).
 * @param {number} [opts.limit]        Max resources to return (default 5).
 * @returns {Array} resource records, each enriched with person/book context.
 */
function pickResources({ lever, principle, cooldownDays = 30, limit = 5 } = {}) {
  const lib = load();
  const needle = (principle || '').toLowerCase();

  // 1) Relevance: people whose lever matches, or whose principles mention the needle.
  const relevantPeople = lib.people.filter((p) => {
    const leverMatch = lever != null && Array.isArray(p.levers) && p.levers.includes(lever);
    const principleMatch =
      needle &&
      Array.isArray(p.principles) &&
      p.principles.some((pr) => pr.toLowerCase().includes(needle) || needle.includes(pr.toLowerCase()));
    return leverMatch || principleMatch;
  });

  // 2) Flatten to resources, carrying the human's identity with each.
  let resources = relevantPeople.flatMap((p) =>
    (p.resources || []).map((r) => ({
      ...r,
      person: p.name,
      book: p.book,
      lever: Array.isArray(p.levers) ? p.levers[0] : null,
      polarizing: !!p.polarizing,
    }))
  );

  // 3) Rotation: drop anything used too recently.
  const fresh = resources.filter((r) => !usedRecently(r, cooldownDays));
  // If the cooldown emptied the shelf, fall back to all of them rather than nothing.
  const pool = fresh.length ? fresh : resources;

  // 4) Order: verified first, then never-used before used, then oldest-used first.
  pool.sort((a, b) => {
    if (!!b.verified !== !!a.verified) return b.verified ? 1 : -1;
    const au = a.last_used ? new Date(a.last_used).getTime() : 0;
    const bu = b.last_used ? new Date(b.last_used).getTime() : 0;
    return au - bu;
  });

  return pool.slice(0, limit);
}

/**
 * Stamp a resource as used (called on send, never on draft generation).
 * Writes last_used back to the file so rotation works on the next run.
 */
function markUsed(resourceId, dateISO = new Date().toISOString()) {
  const lib = load();
  let found = false;
  for (const p of lib.people) {
    for (const r of p.resources || []) {
      if (r.id === resourceId) {
        r.last_used = dateISO;
        found = true;
      }
    }
  }
  if (found) fs.writeFileSync(LIBRARY_PATH, JSON.stringify(lib, null, 2) + '\n');
  return found;
}

module.exports = { load, pickResources, markUsed };
