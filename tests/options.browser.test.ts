import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const executablePath = CHROME_PATHS.find((candidate) => existsSync(candidate))
const skip = executablePath ? false : 'no Chrome binary available'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

/**
 * The options page is an ES module, so it needs a real origin rather than
 * setContent. This serves dist/ the way chrome-extension:// would.
 */
function serveDist(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x')
    if (pathname === '/favicon.ico') {
      response.writeHead(200, { 'Content-Type': 'image/x-icon' }).end()
      return
    }

    const path = normalize(join(distDir, pathname))
    if (!path.startsWith(distDir)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(path)
      response.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'text/plain' })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

const CHROME_STUB = `
window.__validated = [];
const store = {
  settings: { token: '', pollIntervalMs: 60000, openIn: 'window', activeQueryId: 'seeded' },
  savedQueries: [{ id: 'seeded', name: 'Needs my review', query: 'is:open is:pr' }],
};
window.chrome = {
  runtime: {
    id: 'stub',
    getURL: (path) => '/' + path,
    sendMessage: async (message) => {
      window.__validated.push(message);
      if (message.type === 'validate-token') {
        return message.token === 'good'
          ? { ok: true, data: { login: 'octocat' } }
          : { ok: false, error: 'That token was rejected by GitHub.' };
      }
      return { ok: true, data: undefined };
    },
    onMessage: { addListener() {}, removeListener() {} },
  },
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (patch) => Object.assign(store, patch),
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};
`

let server: Server
let browser: Browser
let page: Page
const consoleErrors: string[] = []

describe('options page', { concurrency: false, skip }, () => {
  before(async () => {
    const served = await serveDist()
    server = served.server

    browser = await puppeteer.launch({ executablePath, headless: true })
    page = await browser.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error: unknown) =>
      consoleErrors.push(error instanceof Error ? error.message : String(error)),
    )

    await page.evaluateOnNewDocument(CHROME_STUB)
    await page.goto(`${served.origin}/options.html`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('main')
  })

  after(async () => {
    await browser?.close()
    server?.close()
  })

  it('renders every settings section', async () => {
    const headings = await page.$$eval('h2', (nodes) =>
      nodes.map((node) => node.textContent),
    )
    assert.deepEqual(headings, [
      'Access token',
      'Refresh',
      'Opening items',
      'Saved queries',
    ])
  })

  it('uses Open Sans', async () => {
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    assert.match(font, /Open Sans Variable/)
  })

  it('masks the token and can reveal it', async () => {
    assert.equal(await page.$eval('input[type="password"]', (node) => node.type), 'password')
    await page.click('[aria-label="Show token"]')
    assert.ok(await page.$('input[type="text"]'))
    await page.click('[aria-label="Hide token"]')
    assert.ok(await page.$('input[type="password"]'))
  })

  it('confirms a valid token', async () => {
    await page.type('input[type="password"]', 'good')
    await page.click('button ::-p-text(Verify)')
    await page.waitForFunction(() =>
      document.body.textContent?.includes('Connected as octocat'),
    )
  })

  it('surfaces a rejected token', async () => {
    const input = (await page.$('input[type="password"]'))!
    await input.click({ count: 3 })
    await input.type('bad')
    await page.click('button ::-p-text(Verify)')
    await page.waitForFunction(() =>
      document.body.textContent?.includes('rejected by GitHub'),
    )
  })

  it('persists a changed refresh interval', async () => {
    await page.click('button ::-p-text(5 minutes)')
    const stored = await page.waitForFunction(async () => {
      const result = await chrome.storage.local.get('settings')
      return (result.settings as { pollIntervalMs: number }).pollIntervalMs === 300_000
    })
    assert.ok(stored)
  })

  it('lists saved queries for editing', async () => {
    const value = await page.$eval(
      'input[value="Needs my review"]',
      (node) => (node as HTMLInputElement).value,
    )
    assert.equal(value, 'Needs my review')
  })

  it('reports no console errors', () => {
    assert.deepEqual(consoleErrors, [])
  })
})
