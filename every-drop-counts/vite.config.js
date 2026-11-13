import { defineConfig } from 'vite';

/**
 * Production build is a single classic (non-module) IIFE script so that
 * dist/index.html runs from file:// (Chromium refuses ES-module scripts from file://
 * without flags). base './' keeps every asset path relative (docs/ARCHITECTURE.md).
 */
function classicScriptForFileProtocol() {
  return {
    name: 'edc-classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin/g, '<script defer')
        .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [classicScriptForFileProtocol()],
  // EDC_NO_HMR=1 (set by tools/shot.mjs --serve): no live reloads while other agents edit files
  server: { port: 5173, strictPort: true, hmr: process.env.EDC_NO_HMR ? false : undefined },
  preview: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
    modulePreload: false,
    rolldownOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});
