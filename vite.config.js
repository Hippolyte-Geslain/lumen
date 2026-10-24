import { defineConfig } from 'vite';

// Relative asset URLs, so the build works when published as a claude.ai
// Artifact (files are served next to the page, not from the site root).
export default defineConfig({
  base: './',
  build: {
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
