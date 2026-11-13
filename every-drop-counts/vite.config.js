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
  server: { port: 5173, strictPort: true },
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
