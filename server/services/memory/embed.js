/**
 * embed.js — in-process text embeddings (gte-small, 384 dims) via
 * @xenova/transformers. Nothing leaves the server: this is the whole reason
 * member text never touches an embedding vendor. The model (~30MB) downloads
 * to the local cache on first use and loads lazily so boot stays fast.
 */

let pipePromise = null;

function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      // ESM-only package; dynamic import from CommonJS.
      const { pipeline } = await import('@xenova/transformers');
      return pipeline('feature-extraction', 'Xenova/gte-small');
    })();
    // If loading fails, allow a retry on the next call.
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
