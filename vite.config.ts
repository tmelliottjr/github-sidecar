import { writeFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

import { isBrowserTarget, manifestFor, type BrowserTarget } from './scripts/manifest.ts'

export const DEV_RELOAD_PORT = Number(process.env.DEV_RELOAD_PORT ?? 5599)
export const DEV_RELOAD_ORIGIN = `http://127.0.0.1:${DEV_RELOAD_PORT}`

/**
 * Which browser is being built. Every output is browser-specific — the
 * manifest most obviously, but also which entry points are worth emitting at
 * all — so each gets its own directory under `dist/` and no two builds
 * overwrite one another.
 */
export function browserTarget(): BrowserTarget {
  const requested = process.env.BROWSER ?? 'chrome'
  if (!isBrowserTarget(requested)) {
    throw new Error(
      `BROWSER must be chrome, firefox or safari; got ${JSON.stringify(requested)}`,
    )
  }
  return requested
}

export function outDirFor(target: BrowserTarget): string {
  return `dist/${target}`
}

/**
 * Writes the manifest for the browser being built. It is generated rather than
 * copied out of `public/` because the three browsers will not accept the same
 * one, and because in development it also has to carry the extra host
 * permission the reload server needs.
 */
function manifest(target: BrowserTarget, dev: boolean): Plugin {
  return {
    name: 'github-sidecar:manifest',
    apply: 'build',
    async writeBundle() {
      const generated = await manifestFor(target, { dev, devOrigin: DEV_RELOAD_ORIGIN })
      const path = fileURLToPath(
        new URL(`./${outDirFor(target)}/manifest.json`, import.meta.url),
      )
      await writeFile(path, `${JSON.stringify(generated, null, 2)}\n`)
    },
  }
}

/**
 * Builds the extension pages (settings UI, and on Chrome the offscreen sound
 * document) and the background worker.
 * The content script is built separately by vite.content.config.ts because it
 * must be emitted as a single self-executing file.
 */
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'
  const target = browserTarget()

  return {
    plugins: [react(), manifest(target, isDev)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      __DEV_RELOAD_ORIGIN__: JSON.stringify(DEV_RELOAD_ORIGIN),
      __BROWSER__: JSON.stringify(target),
    },
    build: {
      outDir: outDirFor(target),
      // The content script build writes into the same directory, so in watch
      // mode this build must not wipe it on every rebuild.
      emptyOutDir: !isDev,
      target: target === 'chrome' ? 'chrome114' : 'es2022',
      sourcemap: isDev ? 'inline' : false,
      minify: !isDev,
      rollupOptions: {
        input: {
          options: fileURLToPath(new URL('./options.html', import.meta.url)),
          // Never seen, and only Chrome has one: the single document allowed
          // to make a sound, since a service worker cannot. Firefox plays the
          // sound from its background page instead, and Safari has no
          // notification to play one for.
          ...(target === 'chrome'
            ? { offscreen: fileURLToPath(new URL('./offscreen.html', import.meta.url)) }
            : {}),
          background: fileURLToPath(new URL('./src/background/index.ts', import.meta.url)),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  }
})
