import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Development workflow for the extension.
 *
 * Runs both Vite builds in watch mode and serves a long-poll endpoint that the
 * background service worker subscribes to. When a rebuild lands, the worker
 * reloads the extension and refreshes any open github.com tabs.
 *
 * This is live reload rather than hot module replacement: Chrome will not pick
 * up content script changes without reloading the extension, and github.com's
 * CSP blocks the connection an HMR client inside a content script would need.
 * Window position, saved queries, and settings all live in chrome.storage, so
 * they survive the reload.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(root, 'dist')

const PORT = Number(process.env.DEV_RELOAD_PORT ?? 5599)
const HOLD_MS = 25_000
/**
 * The pages and content bundles come from two independent watchers that finish
 * at slightly different times. A generous quiet period lets both land in a
 * single notification; if one still slips through late, the worker compares
 * build ids after restarting and reloads again.
 */
const DEBOUNCE_MS = 600

let buildId = String(Date.now())
let waiters: Array<{ response: ServerResponse; timer: NodeJS.Timeout }> = []

function respond(response: ServerResponse, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify({ id: buildId }))
}

function releaseWaiters() {
  const pending = waiters
  waiters = []
  for (const { response, timer } of pending) {
    clearTimeout(timer)
    respond(response)
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  if (url.pathname !== '/wait') {
    respond(response, 404)
    return
  }

  // A client that already knows the current build waits for the next one.
  if (url.searchParams.get('id') !== buildId) {
    respond(response)
    return
  }

  const timer = setTimeout(() => {
    waiters = waiters.filter((waiter) => waiter.response !== response)
    respond(response)
  }, HOLD_MS)

  waiters.push({ response, timer })
  request.on('close', () => {
    clearTimeout(timer)
    waiters = waiters.filter((waiter) => waiter.response !== response)
  })
})

const children = new Set<ReturnType<typeof spawn>>()

function run(label: string, args: string[]) {
  const child = spawn('npx', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DEV_RELOAD_PORT: String(PORT), FORCE_COLOR: '1' },
  })
  children.add(child)

  const forward = (stream: NodeJS.ReadableStream) => {
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd()
      if (text) console.log(`${label} ${text.split('\n').join(`\n${label} `)}`)
    })
  }
  forward(child.stdout!)
  forward(child.stderr!)

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${label} exited with code ${code}`)
  })
  return child
}

function shutdown() {
  for (const child of children) child.kill('SIGTERM')
  server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Start from a clean directory so stale output can never be loaded.
await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })
await import('./copy-fonts.ts')

await new Promise<void>((done) => server.listen(PORT, '127.0.0.1', done))

run('[pages]  ', ['vite', 'build', '--watch', '--mode', 'development'])
run('[content]', [
  'vite',
  'build',
  '--watch',
  '--mode',
  'development',
  '--config',
  'vite.content.config.ts',
])

let debounce: NodeJS.Timeout | undefined
watch(distDir, { recursive: true }, (_event, filename) => {
  // Ignore the manifest rewrite the dev plugin performs during a build.
  if (filename === 'manifest.json') return
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    buildId = String(Date.now())
    console.log(`[reload]  build ${buildId}, notifying ${waiters.length} client(s)`)
    releaseWaiters()
  }, DEBOUNCE_MS)
})

console.log(`
  GitHub Sidebar — development

  Watching for changes. Reload server on http://127.0.0.1:${PORT}

  First time:
    1. Open chrome://extensions and enable Developer mode
    2. Load unpacked -> ${distDir}

  Saving a file rebuilds, reloads the extension, and refreshes github.com tabs.
  Press Ctrl+C to stop.
`)
