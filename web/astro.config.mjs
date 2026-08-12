import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Static build. Express serves the output from web/dist, so nothing about the
// Railway deploy changes — Node still just runs the Express server. This keeps
// the Astro pilot zero-risk to the live app.
export default defineConfig({
  integrations: [tailwind()],
  output: 'static',
  build: {
    // Asset filenames are hashed, so a single shared static mount is safe.
    assets: '_astro',
  },
});
