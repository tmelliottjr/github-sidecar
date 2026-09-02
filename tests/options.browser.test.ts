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
  // Notifications are the one feature behind a permission. The stub grants or
  // refuses it on demand so both answers can be exercised.
  permissions: {
    granted: false,
    request: async () => {
      window.chrome.permissions.granted = window.__grantPermission !== false;
      return window.chrome.permissions.granted;
    },
    remove: async () => {
      window.chrome.permissions.granted = false;
      return true;
    },
    contains: async () => window.chrome.permissions.granted,
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
      'Features',
      'Notifications',
      'Saved queries',
      'Hidden rows',
      'Reminders',
      'Pinned rows',
    ])
  })

  it('falls back to GitHub’s stack where no page token exists', async () => {
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    // The options page is not github.com, so there is nothing to borrow from.
    assert.match(font, /Mona Sans VF/)
    assert.match(font, /-apple-system/)
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

/** Reads a feature switch by the title it sits beside. */
async function switchFor(target: Page, title: string) {
  return target.$(`[role="switch"][aria-label="${title}"]`)
}

describe('feature switches', { concurrency: false, skip }, () => {
  let featureServer: Server
  let featureBrowser: Browser
  let featurePage: Page

  before(async () => {
    const served = await serveDist()
    featureServer = served.server
    featureBrowser = await puppeteer.launch({ executablePath, headless: true })
    featurePage = await featureBrowser.newPage()
    await featurePage.evaluateOnNewDocument(CHROME_STUB)
    await featurePage.goto(`${served.origin}/options.html`, { waitUntil: 'networkidle0' })
    await featurePage.waitForSelector('[role="switch"]')
  })

  after(async () => {
    await featureBrowser?.close()
    featureServer?.close()
  })

  it('offers every feature, and starts with the quiet one off', async () => {
    // Scoped to the features section: developer mode has a switch of its own,
    // and it is deliberately not one of these.
    const switches = await featurePage.$$eval('section', (sections) => {
      const features = sections.find((section) => section.querySelector('h2')?.textContent === 'Features')
      return [...features!.querySelectorAll('[role="switch"]')].map((node) => [
        node.getAttribute('aria-label'),
        node.getAttribute('aria-checked'),
      ])
    })

    assert.deepEqual(switches, [
      ['What changed since you looked', 'true'],
      ['Merge conflicts and stale branches', 'true'],
      ['List the failing checks', 'true'],
      ['Remind me about a row', 'true'],
      ['Hide a row', 'true'],
      ['Keyboard navigation', 'true'],
      ['Filter and reorder', 'true'],
      // Notifications are not in this list: they have a section of their own,
      // because everything about being interrupted is decided together.
      ['Count on the toolbar icon', 'true'],
    ])
  })

  it('writes a switched-off feature straight to storage', async () => {
    const control = await switchFor(featurePage, 'Keyboard navigation')
    await control!.click()

    await featurePage.waitForFunction(
      () =>
        (document.querySelector('[aria-label="Keyboard navigation"]') as HTMLElement)
          ?.getAttribute('aria-checked') === 'false',
    )

    const stored = await featurePage.evaluate(async () =>
      (await chrome.storage.local.get('settings')).settings.features,
    )
    assert.equal(stored.keyboard, false)
    // Switching one off leaves the rest exactly as they were.
    assert.equal(stored.changes, true)
  })

})

describe('choosing a sound', { concurrency: false, skip }, () => {
  let soundServer: Server
  let soundBrowser: Browser
  let soundPage: Page

  before(async () => {
    const served = await serveDist()
    soundServer = served.server
    soundBrowser = await puppeteer.launch({ executablePath, headless: true })
    soundPage = await soundBrowser.newPage()
    await soundPage.evaluateOnNewDocument(CHROME_STUB)
    // Records what would have been heard, since a headless browser hears
    // nothing and a chosen sound has to prove it played.
    await soundPage.evaluateOnNewDocument(`
      window.__heard = [];
      class FakeAudioContext {
        constructor() { this.currentTime = 0; this.destination = {} }
        async resume() {}
        createOscillator() {
          const note = {};
          window.__heard.push(note);
          return {
            set type(value) { note.type = value },
            frequency: { set value(hz) { note.hz = hz } },
            connect: (target) => target,
            start() {}, stop() {},
          };
        }
        createGain() {
          const note = window.__heard.at(-1);
          return {
            gain: {
              setValueAtTime() {},
              linearRampToValueAtTime: (value) => { note.peak = value },
              exponentialRampToValueAtTime() {},
            },
            connect: (target) => target,
          };
        }
      }
      window.AudioContext = FakeAudioContext;
    `)
    await soundPage.goto(`${served.origin}/options.html`, { waitUntil: 'networkidle0' })
    // The tones live inside the kinds, which live inside the notification
    // switch; nothing here can be heard until that is on.
    await soundPage.waitForSelector('[aria-label="Desktop notifications"]')
    await soundPage.click('[aria-label="Desktop notifications"]')
    await soundPage.waitForSelector('[aria-label="Reminders you set sound"]')
  })

  after(async () => {
    await soundBrowser?.close()
    soundServer?.close()
  })

  const heard = () =>
    soundPage.evaluate(
      () => (window as unknown as { __heard: Array<{ hz: number; peak: number }> }).__heard,
    )

  const clickSound = (group: 'reminder' | 'change', label: string) =>
    soundPage.evaluate(
      ({ group: which, label: name }) => {
        // Each kind's sounds live under the kind itself, named for it.
        const block = document.querySelector(
          `[aria-label="${which === 'reminder' ? 'Reminders you set' : 'Rows that changed'} sound"]`,
        )!
        const button = [...block.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === name,
        )
        ;(button as HTMLElement).click()
      },
      { group, label },
    )

  it('offers every sound for both kinds, and marks the chosen ones', async () => {
    const chosen = await soundPage.evaluate(() =>
      [...document.querySelectorAll('button[aria-pressed="true"]')].map((node) =>
        node.textContent?.trim(),
      ),
    )
    assert.deepEqual(chosen, ['Chime', 'Ping'])
  })

  it('plays what it is about the moment it is chosen', async () => {
    await soundPage.evaluate(() => {
      ;(window as unknown as { __heard: unknown[] }).__heard.length = 0
    })
    await clickSound('reminder', 'Marimba')

    const notes = await heard()
    assert.deepEqual(
      notes.map((note) => note.hz),
      [587.3, 880, 1174.7],
    )

    const stored = await soundPage.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings.notifications.sounds,
    )
    assert.equal(stored.reminder, 'marimba')
    // The other kind is left exactly as it was.
    assert.equal(stored.change, 'ping')
  })

  it('remembers a quieter volume, and plays at it', async () => {
    await soundPage.evaluate(() => {
      ;(window as unknown as { __heard: unknown[] }).__heard.length = 0
      const slider = document.querySelector('input[type="range"]') as HTMLInputElement
      // React listens for `input`, and a controlled range ignores a value set
      // straight onto the element, so the native setter is used first.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(slider, '20')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await soundPage.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get('settings')).settings
      return stored?.notifications?.sounds?.volume === 0.2
    })

    const quiet = await heard()
    assert.ok(quiet.length > 0, 'expected the new volume to be played')
    assert.ok(quiet.every((note) => note.peak <= 0.12 * 0.2 + 1e-9))
  })
})

describe('notifications, gathered in one place', { concurrency: false, skip }, () => {
  let notifyServer: Server
  let notifyBrowser: Browser
  let notifyPage: Page

  before(async () => {
    const served = await serveDist()
    notifyServer = served.server
    notifyBrowser = await puppeteer.launch({ executablePath, headless: true })
    notifyPage = await notifyBrowser.newPage()
    await notifyPage.evaluateOnNewDocument(CHROME_STUB)
    await notifyPage.goto(`${served.origin}/options.html`, { waitUntil: 'networkidle0' })
    await notifyPage.waitForSelector('[aria-label="Desktop notifications"]')
  })

  after(async () => {
    await notifyBrowser?.close()
    notifyServer?.close()
  })

  const labels = () =>
    notifyPage.evaluate(() => {
      const section = document
        .querySelector('[aria-label="Desktop notifications"]')!
        .closest('section')!
      return [...section.querySelectorAll('[role="switch"]')].map((node) => [
        node.getAttribute('aria-label'),
        node.getAttribute('aria-checked'),
        node.hasAttribute('disabled'),
      ])
    })

  it('nests what depends on the switch above it, and disables it until then', async () => {
    assert.deepEqual(await labels(), [
      ['Desktop notifications', 'false', false],
      // Offered, so the reader can see what saying yes would get them, but not
      // usable until they have.
      ['Notify me about reminders', 'true', true],
      ['Notify me about changes', 'true', true],
    ])

    // The sounds hang off the kind they belong to, not off notifications as a
    // whole, and are disabled with it.
    const groups = await notifyPage.evaluate(() =>
      [...document.querySelectorAll('[role="group"]')].map((node) => [
        node.getAttribute('aria-label'),
        [...node.querySelectorAll('button')].every((button) => button.hasAttribute('disabled')),
      ]),
    )
    assert.deepEqual(groups, [
      ['Reminders you set sound', true],
      ['Rows that changed sound', true],
    ])
  })

  it('lets the two kinds be chosen separately', async () => {
    await notifyPage.click('[aria-label="Desktop notifications"]')
    await notifyPage.waitForFunction(
      () =>
        !document.querySelector('[aria-label="Notify me about changes"]')?.hasAttribute('disabled'),
    )

    await notifyPage.click('[aria-label="Notify me about changes"]')
    await notifyPage.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get('settings')).settings
      return stored?.notifications?.changes === false
    })

    const stored = await notifyPage.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings.notifications,
    )
    // One kind off, the other and the master untouched.
    assert.equal(stored.changes, false)
    assert.equal(stored.reminders, true)
    assert.equal(stored.enabled, true)
  })

  it('silences one kind without silencing the other', async () => {
    // The test above switched one kind off, and a kind that is off has no
    // sound to choose. Both are back on for this one.
    await notifyPage.evaluate(() => {
      const control = document.querySelector(
        '[aria-label="Notify me about changes"]',
      ) as HTMLElement
      if (control.getAttribute('aria-checked') === 'false') control.click()
    })
    await notifyPage.waitForFunction(
      () =>
        ![
          ...document.querySelectorAll('[aria-label="Rows that changed sound"] button'),
        ].some((button) => button.hasAttribute('disabled')),
    )

    const silence = (kind: string) =>
      notifyPage.evaluate((which) => {
        const group = document.querySelector(`[aria-label="${which} sound"]`)!
        const button = [...group.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === 'Silent',
        )
        ;(button as HTMLElement).click()
      }, kind)

    await silence('Rows that changed')
    await notifyPage.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get('settings')).settings
      return stored?.notifications?.sounds?.change === 'none'
    })

    const one = await notifyPage.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings.notifications.sounds,
    )
    // Silence is one of the sounds rather than a switch beside them, so the
    // other kind is untouched.
    assert.equal(one.change, 'none')
    assert.equal(one.reminder, 'chime')
    assert.ok(await notifyPage.$('input[type="range"]'), 'one sound left, so a volume')

    await silence('Reminders you set')
    // Nothing left to play: the volume has nothing to be the volume of.
    await notifyPage.waitForFunction(() => !document.querySelector('input[type="range"]'))
  })
  it('asks for permission before turning notifications on, and gives it back', async () => {
    const control = await switchFor(notifyPage, 'Desktop notifications')

    // Whatever the tests above left it as, this one is about turning it on.
    const on = await notifyPage.$eval(
      '[aria-label="Desktop notifications"]',
      (node) => node.getAttribute('aria-checked') === 'true',
    )
    if (on) {
      await control!.click()
      await notifyPage.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Desktop notifications"]')
            ?.getAttribute('aria-checked') === 'false',
      )
    }

    await control!.click()

    await notifyPage.waitForFunction(
      () =>
        (document.querySelector('[aria-label="Desktop notifications"]') as HTMLElement)
          ?.getAttribute('aria-checked') === 'true',
    )
    assert.equal(
      await notifyPage.evaluate(() => chrome.permissions.contains({})),
      true,
    )

    await control!.click()
    await notifyPage.waitForFunction(
      () =>
        (document.querySelector('[aria-label="Desktop notifications"]') as HTMLElement)
          ?.getAttribute('aria-checked') === 'false',
    )
    // The permission goes back with the switch, so nothing keeps one it has
    // stopped using.
    assert.equal(await notifyPage.evaluate(() => chrome.permissions.contains({})), false)
  })

  it('stays off when the permission is refused', async () => {
    await notifyPage.evaluate(() => {
      ;(window as unknown as { __grantPermission: boolean }).__grantPermission = false
    })

    const control = await switchFor(notifyPage, 'Desktop notifications')
    await control!.click()
    await new Promise((resolve) => setTimeout(resolve, 150))

    assert.equal(
      await notifyPage.$eval('[aria-label="Desktop notifications"]', (node) =>
        node.getAttribute('aria-checked'),
      ),
      'false',
    )
    const stored = await notifyPage.evaluate(async () =>
      (await chrome.storage.local.get('settings')).settings.notifications,
    )
    assert.equal(stored.enabled, false)
  })

})

describe('developer mode', { concurrency: false, skip }, () => {
  let devServer: Server
  let devBrowser: Browser
  let devPage: Page

  before(async () => {
    const served = await serveDist()
    devServer = served.server
    devBrowser = await puppeteer.launch({ executablePath, headless: true })
    devPage = await devBrowser.newPage()
    await devPage.evaluateOnNewDocument(CHROME_STUB)
    await devPage.goto(`${served.origin}/options.html`, { waitUntil: 'networkidle0' })
    await devPage.waitForSelector('[aria-label="Developer mode"]')
  })

  after(async () => {
    await devBrowser?.close()
    devServer?.close()
  })

  it('keeps itself apart from the features, and off', async () => {
    const placed = await devPage.evaluate(() => {
      const control = document.querySelector('[aria-label="Developer mode"]')!
      const section = control.closest('section')!
      const features = [...document.querySelectorAll('section')].find(
        (node) => node.querySelector('h2')?.textContent === 'Features',
      )
      return {
        checked: control.getAttribute('aria-checked'),
        inFeatures: features === section,
        // Nothing to configure until it is switched on.
        fields: section.querySelectorAll('input[type="number"]').length,
      }
    })

    assert.deepEqual(placed, { checked: 'false', inFeatures: false, fields: 0 })
  })

  it('offers a time for every named reminder, and remembers a change', async () => {
    await devPage.click('[aria-label="Developer mode"]')
    await devPage.waitForSelector('input[type="number"]')

    const labels = await devPage.$$eval('section:last-of-type label span:first-child', (nodes) =>
      nodes.map((node) => node.textContent),
    )
    assert.deepEqual(labels.slice(-4), [
      'In an hour',
      'This evening',
      'Tomorrow morning',
      'Next week',
    ])

    // Selected rather than appended to, so the field holds exactly what was
    // typed however wide the default was.
    await devPage.focus('input[type="number"]')
    await devPage.evaluate(() =>
      (document.querySelector('input[type="number"]') as HTMLInputElement).select(),
    )
    await devPage.keyboard.type('5')

    await devPage.waitForFunction(async () => {
      const stored = (await chrome.storage.local.get('settings')).settings
      return stored?.developer?.reminderSeconds?.hour === 5
    })

    const stored = await devPage.evaluate(
      async () => (await chrome.storage.local.get('settings')).settings.developer,
    )
    assert.equal(stored.enabled, true)
    // The others keep their defaults rather than being rewritten alongside it.
    assert.deepEqual(stored.reminderSeconds, { hour: 5, evening: 60, tomorrow: 120, week: 300 })
  })

  it('lists what the panel has asked GitHub, and says which failed', async () => {
    await devPage.evaluate(() => {
      const scope = window as unknown as { chrome: typeof chrome }
      const original = scope.chrome.runtime.sendMessage
      scope.chrome.runtime.sendMessage = (async (message: { type: string }) => {
        if (message.type !== 'api-log') return original(message)
        return {
          ok: true,
          data: [
            {
              at: Date.now(),
              operation: 'enrich',
              detail: '5 rows',
              status: 502,
              durationMs: 10_600,
              requestId: 'ABCD:1234',
              ok: false,
              error: 'GitHub took too long to answer this query.',
            },
            {
              at: Date.now() - 1000,
              operation: 'search',
              detail: 'is:open is:pr',
              status: 200,
              durationMs: 4200,
              requestId: null,
              ok: true,
              error: null,
            },
          ],
        }
      }) as typeof chrome.runtime.sendMessage
    })

    await devPage.evaluate(() => {
      const node = [...document.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Refresh'),
      )
      ;(node as HTMLElement).click()
    })

    await devPage.waitForFunction(() => document.body.textContent?.includes('Row detail'))

    const rows = await devPage.$$eval('li', (nodes) =>
      nodes
        .filter((node) => node.textContent?.includes('ms') || node.textContent?.includes('s'))
        .map((node) => node.textContent),
    )
    const detail = rows.find((row) => row?.includes('Row detail'))

    // The failing request names itself, its cost, and the id GitHub knows it
    // by, which is the whole reason for keeping the log.
    assert.match(detail ?? '', /502/)
    assert.match(detail ?? '', /10\.6s/)
    assert.match(detail ?? '', /took too long/)
    assert.match(detail ?? '', /ABCD:1234/)
    assert.ok(rows.some((row) => row?.includes('Search')))
  })

  it('says what went wrong when a test notification cannot be sent', async () => {
    await devPage.evaluate(() => {
      const scope = window as unknown as { chrome: typeof chrome }
      scope.chrome.runtime.sendMessage = (async () => ({
        ok: false,
        error: 'Chrome has not been given permission to post notifications.',
      })) as typeof chrome.runtime.sendMessage
    })

    const index = await devPage.$$eval('button', (nodes) =>
      nodes.findIndex((node) => node.textContent?.includes('Send a test notification')),
    )
    assert.ok(index >= 0, 'expected a test notification button')

    await devPage.evaluate(() => {
      const node = [...document.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Send a test notification'),
      )
      ;(node as HTMLElement).click()
    })

    await devPage.waitForFunction(() =>
      document.body.textContent?.includes('permission to post notifications'),
    )
  })
})

/**
 * Seeds the three things the management panel gathers — a hidden row, a
 * reminder, a pair of pins — and resolves their ids to rows the way the worker
 * would from its cache. Everything the panel manages is stored as a bare id, so
 * the lookup is the only thing standing between an id and a legible row.
 */
const MANAGE_STUB = `
const signature = {
  state: 'open', reviewDecision: null, checkState: null, commentCount: 0, headRefOid: null,
};
const store = {
  settings: {
    token: '', pollIntervalMs: 60000, openIn: 'tab', activeQueryId: 'seeded',
    developer: { enabled: false, reminderSeconds: { hour: 30, evening: 60, tomorrow: 120, week: 300 } },
  },
  savedQueries: [{ id: 'seeded', name: 'Needs my review', query: 'is:open is:pr' }],
  itemMemory: {
    HID_1: { seen: signature, seenAt: 0, hiddenAt: 1000 },
    REM_1: { seen: signature, seenAt: 0, reminder: { dueAt: 2524608000000, signature, setAt: 0 } },
  },
  pinnedIds: ['PIN_1', 'PIN_2'],
};
const rows = {
  HID_1: { id: 'HID_1', kind: 'pull-request', title: 'Hidden pull request', url: 'https://github.com/acme/app/pull/1', repository: 'acme/app', number: 1 },
  REM_1: { id: 'REM_1', kind: 'issue', title: 'Reminded issue', url: 'https://github.com/acme/app/issues/2', repository: 'acme/app', number: 2 },
  PIN_1: { id: 'PIN_1', kind: 'pull-request', title: 'First pin', url: 'https://github.com/acme/app/pull/3', repository: 'acme/app', number: 3 },
  PIN_2: { id: 'PIN_2', kind: 'pull-request', title: 'Second pin', url: 'https://github.com/acme/app/pull/4', repository: 'acme/app', number: 4 },
};
window.chrome = {
  runtime: {
    id: 'stub',
    getURL: (path) => '/' + path,
    sendMessage: async (message) => {
      if (message.type === 'lookup-items') {
        return { ok: true, data: message.ids.map((id) => rows[id]).filter(Boolean) };
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
  permissions: {
    granted: false,
    request: async () => true,
    remove: async () => true,
    contains: async () => false,
  },
};
`

describe('managing what is set aside', { concurrency: false, skip }, () => {
  let manageServer: Server
  let manageBrowser: Browser
  let managePage: Page

  before(async () => {
    const served = await serveDist()
    manageServer = served.server
    manageBrowser = await puppeteer.launch({ executablePath, headless: true })
    managePage = await manageBrowser.newPage()
    await managePage.evaluateOnNewDocument(MANAGE_STUB)
    await managePage.goto(`${served.origin}/options.html`, { waitUntil: 'networkidle0' })
    await managePage.waitForSelector('main')
  })

  after(async () => {
    await manageBrowser?.close()
    manageServer?.close()
  })

  /** Reads the rows a management section lists, by the title beside each. */
  const rowsUnder = (heading: string) =>
    managePage.evaluate((title) => {
      const section = [...document.querySelectorAll('section')].find(
        (node) => node.querySelector('h2')?.textContent === title,
      )!
      return [...section.querySelectorAll('a[target="_blank"]')].map((node) =>
        node.textContent?.trim(),
      )
    }, heading)

  /** Clicks the first button under a section whose text matches. */
  const clickIn = (heading: string, label: string) =>
    managePage.evaluate(
      ({ title, text }) => {
        const section = [...document.querySelectorAll('section')].find(
          (node) => node.querySelector('h2')?.textContent === title,
        )!
        const button = [...section.querySelectorAll('button')].find(
          (node) => node.textContent?.trim() === text,
        )!
        ;(button as HTMLElement).click()
      },
      { title: heading, text: label },
    )

  it('lists every row it has set aside, resolved to a title and a link', async () => {
    assert.deepEqual(await rowsUnder('Hidden rows'), ['Hidden pull request'])
    assert.deepEqual(await rowsUnder('Reminders'), ['Reminded issue'])
    assert.deepEqual(await rowsUnder('Pinned rows'), ['First pin', 'Second pin'])
  })

  it('moves a reminder to a different time', async () => {
    // The reminder's "Change" is a Radix trigger, which opens on real pointer
    // events rather than a synthetic click, so it and the menu are clicked the
    // way a reader would rather than through the DOM.
    const buttons = await managePage.$$('button')
    const labels = await Promise.all(
      buttons.map((button) => button.evaluate((node) => node.textContent?.trim())),
    )
    await buttons[labels.indexOf('Change')].click()

    await managePage.waitForSelector('[role="menuitem"]')
    const items = await managePage.$$('[role="menuitem"]')
    const choices = await Promise.all(
      items.map((item) => item.evaluate((node) => node.textContent?.trim())),
    )
    await items[choices.indexOf('In an hour')].click()

    await managePage.waitForFunction(async () => {
      const memory = (await chrome.storage.local.get('itemMemory')).itemMemory
      return memory.REM_1.reminder.dueAt !== 2524608000000
    })
    const reminder = await managePage.evaluate(
      async () => (await chrome.storage.local.get('itemMemory')).itemMemory.REM_1.reminder,
    )
    // Roughly an hour out now, not the far-future time it was seeded with.
    assert.ok(reminder.dueAt < 2524608000000)
    assert.ok(reminder.dueAt > Date.now())
  })

  it('drops a reminder, leaving nothing to manage', async () => {
    await clickIn('Reminders', 'Remove')
    await managePage.waitForFunction(async () => {
      const memory = (await chrome.storage.local.get('itemMemory')).itemMemory
      return memory.REM_1.reminder === undefined
    })
    assert.deepEqual(await rowsUnder('Reminders'), [])
  })

  it('reorders the pins', async () => {
    await managePage.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find(
        (node) => node.querySelector('h2')?.textContent === 'Pinned rows',
      )!
      ;(section.querySelector('[aria-label="Move down"]') as HTMLElement).click()
    })
    await managePage.waitForFunction(async () => {
      const pins = (await chrome.storage.local.get('pinnedIds')).pinnedIds
      return pins[0] === 'PIN_2'
    })
    assert.deepEqual(await rowsUnder('Pinned rows'), ['Second pin', 'First pin'])
  })

  it('lifts a pin', async () => {
    await clickIn('Pinned rows', 'Unpin')
    await managePage.waitForFunction(async () => {
      const pins = (await chrome.storage.local.get('pinnedIds')).pinnedIds
      return pins.length === 1
    })
    // The reorder above put the second pin first, so lifting the first leaves
    // the one that started at the top.
    assert.deepEqual(await managePage.evaluate(async () =>
      (await chrome.storage.local.get('pinnedIds')).pinnedIds,
    ), ['PIN_1'])
  })

  it('brings a hidden row back', async () => {
    await clickIn('Hidden rows', 'Show')
    await managePage.waitForFunction(async () => {
      const memory = (await chrome.storage.local.get('itemMemory')).itemMemory
      return memory.HID_1.hiddenAt === undefined
    })
    assert.deepEqual(await rowsUnder('Hidden rows'), [])
  })
})

