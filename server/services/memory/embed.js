/**
 * embed.js — in-process text embeddings (gte-small, 384 dims) via
 * @xenova/transformers. Nothing leaves the server: this is the whole reason
 * member text never touches an embedding vendor. The model (~30MB) downloads
 * to the local cache on first use and loads lazily so boot stays fast.
 */

let pipePromise = null;

// A normal cold start (download + load) is a few seconds. If it goes far past
// that, the load is stuck (e.g. the model CDN is unreachable) — reject so the
// failure surfaces to the owner rather than hanging a member's reply forever.
const LOAD_TIMEOUT_MS = 45000;

function getPipe() {
  if (!pipePromise) {
    pipePromise = Promise.race([
      (async () => {
        // ESM-only package; dynamic import from CommonJS.
        const { pipeline } = await import('@xenova/transformers');
        return pipeline('feature-extraction', 'Xenova/gte-small');
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('embedding model load timed out after ' + LOAD_TIMEOUT_MS + 'ms')), LOAD_TIMEOUT_MS)
      ),
    ]);
    // If loading fails or times out, allow a fresh attempt on the next call.
    pipePromise.catch(() => { pipePromise = null; });
  }
  return pipePromise;
}

/** Embed a single string. Returns a 384-float array. */
async function embed(text) {
  const pipe = await getPipe();
  const out = await pipe(String(text || '').slice(0, 2000), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

module.exports = { embed };
