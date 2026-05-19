/**
 * Commander case study retrieval endpoint.
 * POST /api/commander/case-study
 * Requires authentication.
 */
const express = require('express');
const router = express.Router();
const { extractUser, requireAuth } = require('../middleware/auth');
const { getClient } = require('../services/supabase');

router.use(extractUser);

/**
 * Fetch the most relevant case study based on lever/problem tag overlap.
 */
router.post('/case-study', requireAuth, async (req, res) => {
  try {
    const { lever_tags, problem_tags, context } = req.body;

    if ((!lever_tags || lever_tags.length === 0) && (!problem_tags || problem_tags.length === 0)) {
      return res.json({ result: null });
    }

    const db = getClient();
    if (!db) return res.json({ result: null });

    // Fetch all case studies (small table, ~30 rows)
    const { data, error } = await db
      .from('case_studies')
      .select('title, source_book, source_author, story, lever_tags, problem_tags');

    if (error) throw error;
    if (!data || data.length === 0) return res.json({ result: null });

    // Score by tag overlap
    let bestMatch = null;
    let bestScore = 0;

    for (const cs of data) {
      let score = 0;

      // Lever tag matches (weighted higher)
      if (lever_tags && cs.lever_tags) {
        for (const tag of lever_tags) {
          if (cs.lever_tags.some(lt => lt.toLowerCase() === tag.toLowerCase())) {
            score += 2;
          }
        }
      }

      // Problem tag matches
      if (problem_tags && cs.problem_tags) {
        for (const tag of problem_tags) {
          const tagLower = tag.toLowerCase();
          if (cs.problem_tags.some(pt => pt.toLowerCase().includes(tagLower) || tagLower.includes(pt.toLowerCase()))) {
            score += 1;
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = cs;
      }
    }

    if (!bestMatch || bestScore === 0) {
      return res.json({ result: null });
    }

    res.json({
      title: bestMatch.title,
      source_book: bestMatch.source_book,
      source_author: bestMatch.source_author,
      story: bestMatch.story,
      lever_tags: bestMatch.lever_tags,
      problem_tags: bestMatch.problem_tags
    });
  } catch (e) {
    console.error('Case study retrieval error:', e.message);
    res.json({ result: null });
  }
});

module.exports = router;
