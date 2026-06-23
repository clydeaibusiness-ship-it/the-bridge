/**
 * Seed script — inserts case studies into Supabase case_studies table.
 * Run after any edit to system/case-study-index.md:
 *   node scripts/seed-case-studies.js
 *
 * Source of truth is the FULL STORIES section of system/case-study-index.md.
 * This script parses that section so the database stories can never drift
 * from the compressed index the Commander reads in its system prompt.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Parse the FULL STORIES section of case-study-index.md into case study records.
 * Each story is a block of `key: value` lines delimited by `---`.
 * lever_tags and problem_tags are JSON arrays; story is free text.
 */
function parseCaseStudies() {
  const filePath = path.join(__dirname, '../system/case-study-index.md');
  const full = fs.readFileSync(filePath, 'utf8');

  const marker = full.indexOf('## FULL STORIES');
  if (marker === -1) {
    throw new Error('Could not find "## FULL STORIES" section in case-study-index.md');
  }
  const section = full.substring(marker);

  const records = [];
  let current = null;

  for (const rawLine of section.split('\n')) {
    const line = rawLine.trimEnd();

    // A bare delimiter line closes the current block (and opens the next).
    if (line.trim() === '---') {
      if (current && current.title && current.story) {
        records.push(current);
      }
      current = {};
      continue;
    }
    if (!current) continue;

    const match = line.match(/^(title|source_book|source_author|lever_tags|problem_tags|story):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2];

    if (key === 'lever_tags' || key === 'problem_tags') {
      try {
        current[key] = JSON.parse(value);
      } catch (e) {
        console.warn(`Could not parse ${key} as JSON: ${value}`);
        current[key] = [];
      }
    } else {
      current[key] = value;
    }
  }
  // Flush a trailing block that wasn't followed by a closing delimiter.
  if (current && current.title && current.story) {
    records.push(current);
  }

  return records;
}

async function seed() {
  const caseStudies = parseCaseStudies();
  console.log(`Parsed ${caseStudies.length} case studies from case-study-index.md`);

  if (caseStudies.length === 0) {
    console.error('No case studies parsed — aborting so the table is not wiped.');
    process.exit(1);
  }

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
