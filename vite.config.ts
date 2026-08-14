import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

export const DEV_RELOAD_PORT = Number(process.env.DEV_RELOAD_PORT ?? 5599)
export const DEV_RELOAD_ORIGIN = `http://127.0.0.1:${DEV_RELOAD_PORT}`

/**
 * In development the service worker long-polls the local reload server, which
 * needs a matching host permission. The shipped manifest stays clean.
 */
function devManifest(enabled: boolean): Plugin {
  return {
    name: 'github-sidebar:dev-manifest',
    apply: 'build',
    async writeBundle() {
      if (!enabled) return
      const path = fileURLToPath(new URL('./dist/manifest.json', import.meta.url))
      const manifest = JSON.parse(await readFile(path, 'utf8')) as {
        name: string
        host_permissions: string[]
      }
      const permission = `${DEV_RELOAD_ORIGIN}/*`
      if (manifest.host_permissions.includes(permission)) return

      manifest.host_permissions = [...manifest.host_permissions, permission]
      manifest.name = `${manifest.name} (dev)`
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`)
    },
  }
}

/**
 * Builds the extension pages (options UI) and the background service worker.
 * The content script is built separately by vite.content.config.ts because it
 * must be emitted as a single self-executing file.
 */
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  return {
    plugins: [react(), devManifest(isDev)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      __DEV_RELOAD_ORIGIN__: JSON.stringify(DEV_RELOAD_ORIGIN),
    },
    build: {
      outDir: 'dist',
      // The content script build writes into the same directory, so in watch
      // mode this build must not wipe it on every rebuild.
      emptyOutDir: !isDev,
      target: 'chrome114',
      sourcemap: isDev ? 'inline' : false,
      minify: !isDev,
      rollupOptions: {
        input: {
          options: fileURLToPath(new URL('./options.html', import.meta.url)),
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
