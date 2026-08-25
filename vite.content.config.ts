import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

import { browserTarget, outDirFor } from './vite.config.ts'

/**
 * Content scripts cannot be ES modules with dynamic imports, so this build
 * emits one self-contained IIFE. Styles are imported with `?inline` and
 * injected into the shadow root at runtime rather than into the page.
 */
export default defineConfig(({ mode }) => {
  const target = browserTarget()

  return {
    plugins: [react()],
    publicDir: false,
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      // React reads this; the content bundle has no bundler env of its own.
      'process.env.NODE_ENV': JSON.stringify(
        mode === 'development' ? 'development' : 'production',
      ),
      __BROWSER__: JSON.stringify(target),
    },
    build: {
      outDir: outDirFor(target),
      emptyOutDir: false,
      target: target === 'chrome' ? 'chrome114' : 'es2022',
      cssCodeSplit: false,
      // Inline so the map survives being injected as a single file.
      sourcemap: mode === 'development' ? 'inline' : false,
      minify: mode !== 'development',
      lib: {
        entry: fileURLToPath(new URL('./src/content/index.tsx', import.meta.url)),
        name: 'GitHubSidecar',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: { extend: true, inlineDynamicImports: true },
      },
    },
  }
})
