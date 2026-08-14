import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import puppeteer, { type Browser, type Page } from 'puppeteer-core'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const distRoot = new URL('../dist/', import.meta.url)

const executablePath = CHROME_PATHS.find((candidate) => existsSync(candidate))
/** These suites drive a real browser; skip rather than fail where none exists. */
const skip = executablePath ? false : 'no Chrome binary available'

/**
 * Mimics the extension APIs the content script touches so the real bundle can
 * run on a plain page. Storage is pre-seeded with a token so the list renders
 * instead of the "connect your account" prompt.
 */
const CHROME_STUB = `
window.__sentMessages = [];
// A 1×1 transparent GIF: an avatar that resolves without a network round trip.
const AVATAR_DATA_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
window.__avatarDataUrl = AVATAR_DATA_URL;
// Whether this "tab" has the panel showing. Most suites want it open; the
// default-closed suite overrides this before the bundle is injected.
window.__tabOpen = true;
const listeners = new Set();
window.__broadcast = (message) => listeners.forEach((listener) => listener(message));
const store = {
  settings: {
    token: 'test-token',
    pollIntervalMs: 0,
    openIn: 'window',
    activeQueryId: 'seeded',
  },
  savedQueries: [{ id: 'seeded', name: 'Needs my review', query: 'is:open is:pr' }],
  windowState: {
    x: 120, y: 60, width: 420, height: 520,
    collapsed: false, locked: false,
  },
};
const items = Array.from({ length: 40 }, (_, index) => ({
  id: 'item_' + index,
  kind: index % 2 ? 'pull-request' : 'issue',
  number: index + 1,
  title: 'Item number ' + index + ' with a reasonably long title to wrap',
  url: 'https://github.com/acme/app/pull/' + (index + 1),
  repository: 'acme/app',
  authorLogin: 'octocat',
  // Only some authors have an avatar, so the row has to read either way, and
  // row 3's points nowhere so the broken case is covered too.
  authorAvatarUrl: index === 3
    ? 'https://avatars.example.invalid/u/3'
    : index % 2
      ? AVATAR_DATA_URL
      : null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  state: index % 2 ? 'draft' : 'open',
  stateReason: null,
  commentCount: index,
  // Row 1 carries more labels than fit, so the overflow count is exercised;
  // GitHub only ever hands back the first few, plus the real total.
  labels: index === 1
    ? ['bug', 'regression', 'needs-triage', 'area/api', 'good first issue'].map(
        (name, position) => ({ name, color: position % 2 ? '0e8a16' : 'd73a4a' }),
      )
    : [{ name: 'bug', color: 'd73a4a' }],
  labelCount: index === 1 ? 7 : 1,
  reviewDecision: index % 2 ? 'CHANGES_REQUESTED' : null,
  checkState: index % 3 === 2 ? 'PENDING' : index % 2 ? 'FAILURE' : 'SUCCESS',
  additions: 1,
  deletions: 1,
  // Row 1 is the middle layer of a three-deep stack; every other row is on
  // its own, so the list has to cope with both.
  stack: index === 1
    ? {
        number: 4,
        size: 3,
        baseRefName: 'main',
        position: 2,
        entries: [
          {
            id: 'stack_1',
            number: 101,
            title: 'Groundwork for the feature',
            url: 'https://github.com/acme/app/pull/101',
            repository: 'acme/app',
            state: 'open',
            reviewDecision: 'APPROVED',
            position: 1,
          },
          {
            id: 'item_1',
            number: 2,
            title: 'Item number 1 with a reasonably long title to wrap',
            url: 'https://github.com/acme/app/pull/2',
            repository: 'acme/app',
            state: 'draft',
            reviewDecision: 'CHANGES_REQUESTED',
            position: 2,
          },
          {
            id: 'stack_3',
            number: 103,
            title: 'The last layer',
            url: 'https://github.com/acme/app/pull/103',
            repository: 'acme/app',
            state: 'open',
            reviewDecision: null,
            position: 3,
          },
        ],
      }
    : null,
}));
window.chrome = {
  runtime: {
    id: 'stub',
    getURL: (path) => 'https://example.invalid/' + path,
    sendMessage: async (message) => {
      window.__sentMessages.push(message);
      if (message.type === 'tab-open') {
        return { ok: true, data: window.__tabOpen === true };
      }
      if (message.type === 'set-tab-open') {
        window.__tabOpen = message.open;
        return { ok: true, data: undefined };
      }
      if (message.type === 'refresh-item') {
        if (window.__failRefresh) throw new Error('acme/app#1 could not be found.');
        const fresh = {
          ...items[0],
          title: 'A refreshed title',
          checkState: 'SUCCESS',
          reviewDecision: 'APPROVED',
        };
        setTimeout(() => window.__broadcast({ type: 'item-updated', item: fresh }), 0);
        return { ok: true, data: fresh };
      }
      if (message.type === 'search') {
        return {
          ok: true,
          data: {
            items,
            totalCount: 400,
            endCursor: 'CURSOR',
            hasNextPage: true,
            fetchedAt: Date.now(),
            source: 'cache',
            revalidating: false,
          },
        };
      }
      return { ok: true, data: undefined };
    },
    onMessage: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
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

let browser: Browser
let page: Page
const consoleErrors: string[] = []

describe('content script', { concurrency: false, skip }, () => {
  before(async () => {
    browser = await puppeteer.launch({ executablePath, headless: true })
    page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })

    // The stub points font URLs at an unresolvable host, so those failures are
    // an artefact of the harness rather than the bundle.
    const isStubbedAsset = (text: string) => text.includes('ERR_NAME_NOT_RESOLVED')

    page.on('console', (message) => {
      if (message.type() === 'error' && !isStubbedAsset(message.text())) {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error: unknown) =>
      consoleErrors.push(error instanceof Error ? error.message : String(error)),
    )

    await page.setContent('<!doctype html><html data-color-mode="light"><body></body></html>')
    await page.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await page.evaluate(bundle)
    await page.waitForSelector('#github-sidecar-root')
  })

  after(async () => {
    await browser?.close()
  })

  it('mounts a shadow root with adopted styles', async () => {
    const result = await page.evaluate(() => {
      const host = document.getElementById('github-sidecar-root')
      const shadow = host?.shadowRoot
      return {
        hasShadow: Boolean(shadow),
        adoptedSheets: shadow?.adoptedStyleSheets.length ?? 0,
        hasContainer: Boolean(shadow?.getElementById('github-sidecar-container')),
      }
    })

    assert.equal(result.hasShadow, true)
    assert.equal(result.adoptedSheets, 1)
    assert.equal(result.hasContainer, true)
  })

  it('renders the window with Open Sans and applied Tailwind styles', async () => {
    const result = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const panel = shadow.querySelector('[role="complementary"]') as HTMLElement
      const styles = getComputedStyle(panel)
      return {
        found: Boolean(panel),
        fontFamily: styles.fontFamily,
        position: styles.position,
        width: panel.getBoundingClientRect().width,
        // Tailwind tokens must resolve inside the shadow root.
        borderRadius: styles.borderRadius,
        background: styles.backgroundColor,
      }
    })

    assert.equal(result.found, true)
    assert.match(result.fontFamily, /Open Sans Variable/)
    assert.equal(result.position, 'fixed')
    assert.equal(result.width, 420)
    assert.notEqual(result.borderRadius, '0px')
    assert.equal(result.background, 'oklch(1 0 0)')
  })

  it('renders virtualised rows rather than the whole result set', async () => {
    await page.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })

    const counts = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return {
        rendered: shadow.querySelectorAll('[data-index]').length,
        footer: shadow.querySelector('footer')?.textContent ?? '',
      }
    })

    assert.ok(counts.rendered > 0, 'expected rows to render')
    // 40 items are loaded but only a window of them should be in the DOM.
    assert.ok(counts.rendered < 40, `expected virtualisation, saw ${counts.rendered} rows`)
    assert.match(counts.footer, /of 400/)
  })

  it('shows the author as an avatar and a handle', async () => {
    const author = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const avatar = shadow.querySelector('[data-index="1"] img') as HTMLImageElement
      const styles = getComputedStyle(avatar)
      return {
        src: avatar.getAttribute('src'),
        // Decorative: the handle beside it already names the author.
        alt: avatar.getAttribute('alt'),
        loading: avatar.getAttribute('loading'),
        round: styles.borderRadius,
        width: avatar.getBoundingClientRect().width,
        text: shadow.querySelector('[data-index="1"]')?.textContent ?? '',
      }
    })

    assert.equal(
      author.src,
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    )
    assert.equal(author.alt, '')
    assert.equal(author.loading, 'lazy')
    // Tailwind's `rounded-full` resolves to an enormous radius; anything at or
    // past half the width is a circle.
    assert.ok(
      parseFloat(author.round) >= author.width / 2,
      `expected a circular avatar, saw a ${author.round} radius`,
    )
    assert.ok(author.width > 0 && author.width <= 16, `saw a ${author.width}px avatar`)
    assert.match(author.text, /octocat/)
  })

  it('falls back to the handle alone when there is no avatar', async () => {
    const row = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return {
        avatars: shadow.querySelectorAll('[data-index="0"] img').length,
        text: shadow.querySelector('[data-index="0"]')?.textContent ?? '',
      }
    })

    assert.equal(row.avatars, 0)
    assert.match(row.text, /octocat/)
  })

  it('drops an avatar that cannot load rather than tearing the row', async () => {
    // Row 3's avatar points at an unresolvable host, so it fails on load.
    await page.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector('[data-index="3"]')
      return Boolean(row) && row!.querySelectorAll('img').length === 0
    })

    const text = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelector('[data-index="3"]')?.textContent ?? ''
    })
    assert.match(text, /octocat/)
  })

  it('shows labels as overlapping dots rather than as names', async () => {
    const dots = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector('[data-index="0"]')!
      const dot = row.querySelector('[role="img"][aria-label="bug"]') as HTMLElement
      const box = dot.getBoundingClientRect()
      const styles = getComputedStyle(dot)
      return {
        width: box.width,
        colour: styles.backgroundColor,
        // The name is carried by the label, never printed in the row.
        text: row.textContent ?? '',
      }
    })

    assert.ok(dots.width > 0 && dots.width <= 12, `saw a ${dots.width}px dot`)
    assert.equal(dots.colour, 'rgb(215, 58, 74)')
    assert.doesNotMatch(dots.text, /bug/)
  })

  it('caps the dots at five and counts the rest', async () => {
    const row = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[data-index="1"]')!
      const dots = [...node.querySelectorAll('[role="img"]')] as HTMLElement[]
      return {
        names: dots.map((dot) => dot.getAttribute('aria-label')),
        // Left edges, to prove the dots actually overlap.
        lefts: dots.map((dot) => dot.getBoundingClientRect().left),
        width: dots[0]?.getBoundingClientRect().width ?? 0,
        text: node.textContent ?? '',
      }
    })

    assert.equal(row.names.length, 5)
    assert.deepEqual(row.names.slice(0, 2), ['bug', 'regression'])
    // Seven labels, five drawn.
    assert.match(row.text, /\+2/)
    assert.ok(
      row.lefts[1] - row.lefts[0] < row.width,
      `expected overlap, saw a ${row.lefts[1] - row.lefts[0]}px step`,
    )
  })

  it('names a label on hover', async () => {
    const point = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const dot = shadow.querySelector(
        '[data-index="1"] [role="img"][aria-label="regression"]',
      )!
      const box = dot.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })

    await page.mouse.move(point.x, point.y)
    await page.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[role="tooltip"]')].some((node) =>
        node.textContent?.includes('regression'),
      )
    })

    // Leave the row alone again so later tests see an unhovered list.
    await page.mouse.move(0, 0)
  })

  it('opens an item in a new window through the background worker', async () => {
    await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector('[data-index] button') as HTMLButtonElement
      row.click()
    })

    const sent = await page.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<Record<string, unknown>> })
          .__sentMessages,
    )
    const openMessage = sent.find((message) => message.type === 'open-item')

    assert.ok(openMessage, 'expected an open-item message')
    assert.equal(openMessage.target, 'window')
    assert.match(String(openMessage.url), /github\.com/)
  })

  it('collapses to the header without unmounting', async () => {
    const height = await page.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const button = shadow.querySelector('[aria-label="Collapse"]') as HTMLButtonElement
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 400))
      const panel = shadow.querySelector('[role="complementary"]') as HTMLElement
      return panel.getBoundingClientRect().height
    })

    assert.equal(height, 44)
  })

  it('reports no console errors', () => {
    assert.deepEqual(consoleErrors, [])
  })
})

describe('window geometry', { concurrency: false, skip }, () => {
  let dragBrowser: Browser
  let dragPage: Page

  before(async () => {
    dragBrowser = await puppeteer.launch({ executablePath, headless: true })
    dragPage = await dragBrowser.newPage()
    await dragPage.setViewport({ width: 1280, height: 800 })
    await dragPage.setContent(
      '<!doctype html><html data-color-mode="light"><body></body></html>',
    )
    await dragPage.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await dragPage.evaluate(bundle)
    await dragPage.waitForSelector('#github-sidecar-root')
  })

  after(async () => {
    await dragBrowser?.close()
  })

  /** Centre of the bare strip in the header that is reserved for dragging. */
  const dragRegionCentre = () =>
    dragPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const region = shadow.querySelector('[data-drag-region]') as HTMLElement
      const box = region.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width }
    })

  const panelBox = () =>
    dragPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const panel = shadow.querySelector('[role="complementary"]') as HTMLElement
      const box = panel.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    })

  it('exposes a usable drag region in the header', async () => {
    const region = await dragRegionCentre()
    assert.ok(region.width > 40, `drag region too narrow: ${region.width}px`)
  })

  it('moves the window when the header is dragged', async () => {
    const start = await panelBox()
    const handle = await dragRegionCentre()

    await dragPage.mouse.move(handle.x, handle.y)
    await dragPage.mouse.down()
    await dragPage.mouse.move(handle.x - 60, handle.y + 90, { steps: 10 })
    await dragPage.mouse.up()

    const moved = await panelBox()
    assert.equal(Math.round(moved.x - start.x), -60)
    assert.equal(Math.round(moved.y - start.y), 90)
    // Size must be untouched by a move.
    assert.equal(moved.width, start.width)
  })

  it('persists the new position to storage', async () => {
    const stored = await dragPage.evaluate(async () => {
      const result = await chrome.storage.local.get('windowState')
      return result.windowState as { x: number; y: number }
    })
    const box = await panelBox()

    assert.equal(Math.round(stored.x), Math.round(box.x))
    assert.equal(Math.round(stored.y), Math.round(box.y))
  })

  it('ignores drags once the position is locked', async () => {
    await dragPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const lock = shadow.querySelector('[aria-label="Lock position"]') as HTMLButtonElement
      lock.click()
    })
    await dragPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return Boolean(shadow?.querySelector('[aria-label="Unlock position"]'))
    })

    const start = await panelBox()
    const handle = await dragRegionCentre()

    await dragPage.mouse.move(handle.x, handle.y)
    await dragPage.mouse.down()
    await dragPage.mouse.move(handle.x - 120, handle.y + 40, { steps: 6 })
    await dragPage.mouse.up()

    const moved = await panelBox()
    assert.deepEqual({ x: moved.x, y: moved.y }, { x: start.x, y: start.y })
  })

  it('hides resize handles while locked', async () => {
    const handles = await dragPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelectorAll('[class*="cursor-nwse-resize"]').length
    })
    assert.equal(handles, 0)
  })
})

/**
 * A stand-in for a github.com page: full-width chrome above a centred column,
 * which is the layout docked mode measures itself against.
 */
const GITHUB_PAGE = `<!doctype html><html data-color-mode="light"><body style="margin:0">
<header class="AppHeader" style="position:sticky;top:0;height:64px;background:#1f2328"></header>
<div class="js-header-wrapper">
  <nav class="UnderlineNav" style="height:48px;border-bottom:1px solid #d1d9e0"></nav>
</div>
<div class="application-main"><main>
  <div id="column" style="max-width:1280px;margin:0 auto;padding:24px">
    <h1 id="heading" style="margin:0">A pull request</h1>
    <div id="mini-header" data-testid="diff-comparison-viewer-sticky-header-bar"
         style="position:sticky;top:64px;height:48px;background:#fff;border-bottom:1px solid #d1d9e0">
      #444271 A pull request
    </div>
    <div style="height:2400px;background:#f6f8fa"></div>
  </div>
</main></div>
</body></html>`

describe('docked mode', { concurrency: false, skip }, () => {
  let dockBrowser: Browser
  let dockPage: Page

  /** Wide enough that the page's own gutter has room for the panel. */
  const WIDE = 2400
  /** Too narrow to fit the panel beside the column without help. */
  const NARROW = 1100

  before(async () => {
    dockBrowser = await puppeteer.launch({ executablePath, headless: true })
    dockPage = await dockBrowser.newPage()
    await dockPage.setViewport({ width: WIDE, height: 900 })
    await dockPage.setContent(GITHUB_PAGE)
    await dockPage.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await dockPage.evaluate(bundle)
    await dockPage.waitForSelector('#github-sidecar-root')
  })

  after(async () => {
    await dockBrowser?.close()
  })

  const panel = () =>
    dockPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[role="complementary"]') as HTMLElement
      const box = node.getBoundingClientRect()
      const styles = getComputedStyle(node)
      return {
        docked: node.hasAttribute('data-docked'),
        x: box.x,
        y: box.y,
        bottom: box.bottom,
        width: box.width,
        borderRight: styles.borderRightWidth,
        boxShadow: styles.boxShadow,
      }
    })

  /** Where the page itself starts drawing, and what we took to get it there. */
  const host = () =>
    dockPage.evaluate(() => {
      const chrome = document.querySelector('.AppHeader')!.getBoundingClientRect()
      return {
        bodyPadding: parseFloat(getComputedStyle(document.body).paddingLeft),
        headingLeft: document.getElementById('heading')!.getBoundingClientRect().left,
        chromeLeft: chrome.left,
        chromeWidth: chrome.width,
      }
    })

  const clickDock = async (label: string) => {
    await dockPage.evaluate((selector) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector(selector) as HTMLButtonElement).click()
    }, `[aria-label="${label}"]`)
    // The dock measures the page in an effect, so let React commit first.
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  }

  it('starts floating, leaving the page untouched', async () => {
    assert.equal((await panel()).docked, false)
    assert.equal((await host()).bodyPadding, 0)
  })

  it('docks into the page gutter, below the header and nav', async () => {
    await clickDock('Dock to the page')
    const box = await panel()

    assert.equal(box.docked, true)
    assert.equal(box.x, 0)
    // 64px header plus a 48px nav row, and it must not cover them.
    assert.ok(box.y >= 112, `expected the panel below the chrome, saw y=${box.y}`)
    assert.equal(box.bottom, 900)
  })

  it('carries an edge so it reads against a white page', async () => {
    const box = await panel()
    assert.equal(box.borderRight, '1px')
    assert.match(box.boxShadow, /oklch/)
  })

  it('takes no space when the gutter already has room', async () => {
    const hostPage = await host()
    const box = await panel()

    assert.equal(hostPage.bodyPadding, 0)
    assert.equal(hostPage.chromeLeft, 0)
    assert.ok(
      hostPage.headingLeft > box.width,
      `expected the page clear of the panel, saw ${hostPage.headingLeft} vs ${box.width}`,
    )
  })

  it('pushes the page across when the gutter is too narrow', async () => {
    await dockPage.setViewport({ width: NARROW, height: 900 })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    const hostPage = await host()
    const box = await panel()

    assert.ok(hostPage.bodyPadding > 0, 'expected the page to be pushed across')
    assert.ok(hostPage.headingLeft >= box.width, 'expected the content clear of the panel')
    // Only the page body moves. The header keeps spanning the window, and the
    // panel hangs below it rather than beside it, so the page still reads as
    // github.com with a drawer open.
    assert.equal(hostPage.chromeLeft, 0)
    assert.equal(hostPage.chromeWidth, NARROW)
    assert.ok(box.y >= 112, `expected the panel below the chrome, saw y=${box.y}`)
  })

  it('leaves the nav full-bleed too, and shifts it only once', async () => {
    const nav = await dockPage.evaluate(() => {
      const wrapper = document.querySelector('.js-header-wrapper')!
      const inner = document.querySelector('.UnderlineNav')!
      return {
        // The wrapper is the outermost match, so it is the one pulled back
        // out; marking the nav inside it as well would move the nav twice.
        marked: [...document.querySelectorAll('[data-github-sidecar-full-bleed]')].map(
          (element) => element.className,
        ),
        wrapperLeft: wrapper.getBoundingClientRect().left,
        left: inner.getBoundingClientRect().left,
        width: inner.getBoundingClientRect().width,
      }
    })

    assert.deepEqual(nav.marked, ['AppHeader', 'js-header-wrapper'])
    assert.equal(nav.wrapperLeft, 0)
    assert.equal(nav.left, 0)
    assert.equal(nav.width, NARROW)
  })

  it('anchors below a mini header that pins under the app header', async () => {
    await dockPage.setViewport({ width: WIDE, height: 900 })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    // Scrolling past the nav leaves the app header pinned with the pull
    // request's mini header stacked beneath it. The mini header is only as
    // wide as the page column, not the viewport.
    await dockPage.evaluate(() => window.scrollTo(0, 800))
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    const miniHeader = await dockPage.evaluate(() => {
      const rect = document.getElementById('mini-header')!.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, width: rect.width }
    })
    const box = await panel()

    assert.equal(miniHeader.top, 64, 'expected the mini header pinned below the header')
    assert.ok(
      miniHeader.width < WIDE * 0.9,
      'the mini header is narrower than the viewport, as the real one is',
    )
    const miniHeaderBottom = miniHeader.bottom
    assert.ok(
      box.y >= miniHeaderBottom,
      `expected the panel below the mini header at ${miniHeaderBottom}, saw y=${box.y}`,
    )
  })

  it('collapses to a rail that asks the page for far less room', async () => {
    await dockPage.evaluate(() => window.scrollTo(0, 0))
    await dockPage.setViewport({ width: NARROW, height: 900 })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    const expandedPush = (await host()).bodyPadding
    assert.ok(expandedPush > 0, 'expected the open panel to need the page moved')

    await clickDock('Collapse')

    const rail = await dockPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[aria-label^="Expand"]') as HTMLElement | null
      if (!node) return null
      const box = node.getBoundingClientRect()
      return {
        x: box.x,
        width: box.width,
        bottom: box.bottom,
        expanded: node.getAttribute('aria-expanded'),
        panelGone: !shadow.querySelector('[data-docked]'),
      }
    })

    assert.ok(rail, 'expected a rail once collapsed')
    assert.equal(rail.panelGone, true)
    assert.equal(rail.x, 0)
    assert.equal(rail.expanded, 'false')
    assert.ok(rail.width <= 48, `expected a narrow rail, saw ${rail.width}px`)
    assert.equal(rail.bottom, 900)

    // A rail fits where the panel could not, so the page gets most of its
    // layout back even on a viewport this narrow.
    const collapsedPush = (await host()).bodyPadding
    assert.ok(
      collapsedPush < expandedPush,
      `expected less room taken, ${collapsedPush} vs ${expandedPush}`,
    )
    assert.ok(collapsedPush <= rail.width + 16, `rail took ${collapsedPush}px`)
  })

  it('keeps taking results while collapsed', async () => {
    const countOn = () =>
      dockPage.evaluate(() => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        return shadow.querySelector('[aria-label^="Expand"]')?.textContent?.trim()
      })

    // The seeded query reports 400 matches, which the rail caps for width.
    assert.equal(await countOn(), '99+')

    // A refresh landing while collapsed has to reach the rail, otherwise the
    // count it is showing is decoration rather than status.
    await dockPage.evaluate(() => {
      const broadcast = (window as unknown as { __broadcast: (m: unknown) => void })
        .__broadcast
      broadcast({
        type: 'search-updated',
        query: 'is:open is:pr',
        after: null,
        page: {
          items: [],
          totalCount: 7,
          endCursor: null,
          hasNextPage: false,
          fetchedAt: Date.now(),
        },
      })
    })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))

    assert.equal(await countOn(), '7')
  })

  it('expands again from the rail alone', async () => {
    await dockPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label^="Expand"]') as HTMLButtonElement).click()
    })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))

    const box = await panel()
    assert.equal(box.docked, true)
    assert.ok(box.width > 100, `expected the panel back, saw ${box.width}px`)
  })

  it('gives the page its space back when undocked', async () => {
    await dockPage.evaluate(() => window.scrollTo(0, 0))
    await dockPage.setViewport({ width: WIDE, height: 900 })
    await clickDock('Float the window')

    const box = await panel()
    assert.equal(box.docked, false)
    assert.equal((await host()).bodyPadding, 0)
    assert.equal(
      await dockPage.evaluate(() =>
        Boolean(document.getElementById('github-sidecar-dock-style')),
      ),
      false,
    )
  })
})

describe('row context menu', { concurrency: false, skip }, () => {
  let menuBrowser: Browser
  let menuPage: Page

  before(async () => {
    menuBrowser = await puppeteer.launch({ executablePath, headless: true })
    menuPage = await menuBrowser.newPage()
    await menuPage.setViewport({ width: 1280, height: 800 })
    await menuPage.setContent(
      '<!doctype html><html data-color-mode="light"><body></body></html>',
    )
    await menuPage.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await menuPage.evaluate(bundle)
    await menuPage.waitForSelector('#github-sidecar-root')
    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await menuBrowser?.close()
  })

  const openMenuOn = async (index: number) => {
    const point = await menuPage.evaluate((rowIndex) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector(`[data-index="${rowIndex}"] button`)!
      const box = row.getBoundingClientRect()
      return { x: box.x + 40, y: box.y + 20 }
    }, index)

    await menuPage.mouse.click(point.x, point.y, { button: 'right' })
    await menuPage.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('[role="menu"]')),
    )
  }

  const clickMenuItem = async (label: string) => {
    await menuPage.evaluate((text) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes(text),
      )
      ;(entry as HTMLElement).click()
    }, label)
  }

  it('opens on right-click with pin and refresh actions', async () => {
    await openMenuOn(0)

    const labels = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[role="menuitem"]')].map((node) =>
        node.textContent?.trim(),
      )
    })

    assert.deepEqual(labels, ['Pin item', 'Refresh this item'])
  })

  it('asks the worker for that row alone, then applies the result', async () => {
    await clickMenuItem('Refresh this item')

    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelector('[data-index="0"]')?.textContent?.includes(
        'A refreshed title',
      )
    })

    const sent = await menuPage.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<Record<string, unknown>> })
          .__sentMessages,
    )
    const refresh = sent.filter((message) => message.type === 'refresh-item')

    assert.equal(refresh.length, 1)
    assert.deepEqual(refresh[0], {
      type: 'refresh-item',
      repository: 'acme/app',
      number: 1,
    })
  })

  it('surfaces a failed refresh on the row itself', async () => {
    await menuPage.evaluate(() => {
      ;(window as unknown as { __failRefresh: boolean }).__failRefresh = true
    })
    await openMenuOn(1)
    await clickMenuItem('Refresh this item')

    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(
        shadow.querySelector('[data-index="1"] [aria-label="Refresh failed"]'),
      )
    })

    const busy = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow
        .querySelector('[data-index="1"] button')!
        .getAttribute('aria-busy')
    })
    assert.equal(busy, 'false')
  })

  it('spins the pending checks mark slowly', async () => {
    const animation = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marks = [...shadow.querySelectorAll('[data-index] svg')]
      const spinning = marks.find(
        (mark) => getComputedStyle(mark).animationName !== 'none',
      )
      if (!spinning) return null
      const styles = getComputedStyle(spinning)
      return { name: styles.animationName, duration: styles.animationDuration }
    })

    assert.ok(animation, 'expected a spinning mark to be rendered')
    assert.equal(animation.name, 'spin-slow')
    // Comfortably slower than Tailwind's one-second default.
    assert.ok(
      parseFloat(animation.duration) >= 2,
      `expected a slow spin, saw ${animation.duration}`,
    )
  })

  const firstRowText = () =>
    menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelector('[data-index="0"]')?.textContent ?? ''
    })

  it('lifts a pinned row to the top and remembers it', async () => {
    await openMenuOn(3)
    await clickMenuItem('Pin item')

    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector('[data-index="0"]')
      return Boolean(
        row?.textContent?.includes('Item number 3 ') &&
          row.querySelector('[aria-label="Pinned"]'),
      )
    })

    const stored = await menuPage.evaluate(() => chrome.storage.local.get('pinnedIds'))
    assert.deepEqual(stored.pinnedIds, ['item_3'])
  })

  it('offers to unpin the row it just pinned, and puts it back', async () => {
    await openMenuOn(0)

    const labels = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[role="menuitem"]')].map((node) =>
        node.textContent?.trim(),
      )
    })
    assert.deepEqual(labels, ['Unpin item', 'Refresh this item'])

    await clickMenuItem('Unpin item')
    await menuPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="0"]')
          ?.textContent?.includes('Item number 3 '),
    )

    assert.ok(!(await firstRowText()).includes('Item number 3 '))
    const stored = await menuPage.evaluate(() => chrome.storage.local.get('pinnedIds'))
    assert.deepEqual(stored.pinnedIds, [])
  })

  const stackRow = () =>
    menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelector('[data-index="1"]')?.textContent ?? ''
    })

  it('marks a stacked row with its position in the stack', async () => {
    assert.match(await stackRow(), /2\/3/)
    // An unstacked row says nothing about stacks and offers no expander.
    const expanders = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelectorAll('[data-index="0"] [aria-expanded]').length
    })
    assert.equal(expanders, 0)
  })

  it('expands to the rest of the stack, base branch first', async () => {
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const toggle = shadow.querySelector(
        '[data-index="1"] [aria-label="Show the stack"]',
      ) as HTMLButtonElement
      toggle.click()
    })

    await menuPage.waitForFunction(() =>
      document
        .getElementById('github-sidecar-root')!
        .shadowRoot!.querySelector('[data-index="1"]')
        ?.textContent?.includes('Groundwork for the feature'),
    )

    const layers = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[data-index="1"] li button')].map((node) =>
        node.textContent?.trim(),
      )
    })

    assert.equal(layers.length, 3)
    assert.match(layers[0]!, /#101 Groundwork for the feature/)
    assert.match(layers[2]!, /#103 The last layer/)
    // The stack says where it lands, not just what is in it.
    assert.match(await stackRow(), /onto main/)

    // The row it was expanded from is marked rather than dropped.
    const current = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelector('[data-index="1"] [aria-current="true"]')?.textContent
    })
    assert.match(current!, /#2 Item number 1/)
  })

  it('opens a related pull request from the stack', async () => {
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const layer = [...shadow.querySelectorAll('[data-index="1"] li button')].find(
        (node) => node.textContent?.includes('The last layer'),
      ) as HTMLButtonElement
      layer.click()
    })

    const sent = await menuPage.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<Record<string, unknown>> })
          .__sentMessages,
    )
    const opened = sent.filter((message) => message.type === 'open-item')

    assert.deepEqual(opened.at(-1), {
      type: 'open-item',
      url: 'https://github.com/acme/app/pull/103',
      target: 'window',
    })
  })

  it('offers the same toggle in the context menu, and collapses again', async () => {
    await openMenuOn(1)

    const labels = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[role="menuitem"]')].map((node) =>
        node.textContent?.trim(),
      )
    })
    assert.deepEqual(labels, ['Pin item', 'Hide the stack', 'Refresh this item'])

    await clickMenuItem('Hide the stack')
    await menuPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="1"]')
          ?.textContent?.includes('Groundwork for the feature'),
    )
  })
})

describe('a tab that was never asked', { concurrency: false, skip }, () => {
  let quietBrowser: Browser
  let quietPage: Page

  before(async () => {
    quietBrowser = await puppeteer.launch({ executablePath, headless: true })
    quietPage = await quietBrowser.newPage()
    await quietPage.setViewport({ width: 1280, height: 800 })
    await quietPage.setContent(
      '<!doctype html><html data-color-mode="light"><body></body></html>',
    )
    await quietPage.evaluate(CHROME_STUB)
    // A fresh tab: the worker has no record of this one being opened.
    await quietPage.evaluate(() => {
      ;(window as unknown as { __tabOpen: boolean }).__tabOpen = false
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await quietPage.evaluate(bundle)
    await quietPage.waitForSelector('#github-sidecar-root')
  })

  after(async () => {
    await quietBrowser?.close()
  })

  const sent = () =>
    quietPage.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<{ type?: string }> })
          .__sentMessages,
    )

  const launcher = () =>
    quietPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[aria-label="Open GitHub Sidecar"]'))
    })

  it('starts closed, showing only the launcher', async () => {
    await quietPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))

    assert.equal(await launcher(), true)
    const panel = await quietPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[role="complementary"]'))
    })
    assert.equal(panel, false)
  })

  it('asks GitHub for nothing until it is opened', async () => {
    const searches = (await sent()).filter((message) => message.type === 'search')
    assert.deepEqual(searches, [], 'a closed tab must not cost a request')
  })

  it('loads once opened, and remembers that this tab is open', async () => {
    await quietPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(
        shadow.querySelector('[aria-label="Open GitHub Sidecar"]') as HTMLButtonElement
      ).click()
    })

    await quietPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })

    const messages = await sent()
    assert.ok(
      messages.some((message) => message.type === 'search'),
      'expected the query to run once opened',
    )
    const opened = messages.filter((message) => message.type === 'set-tab-open')
    assert.deepEqual(opened, [{ type: 'set-tab-open', open: true }])
    assert.equal(await launcher(), false)
  })
})

describe('a docked tab that was never asked', { concurrency: false, skip }, () => {
  let railBrowser: Browser
  let railPage: Page

  before(async () => {
    railBrowser = await puppeteer.launch({ executablePath, headless: true })
    railPage = await railBrowser.newPage()
    await railPage.setViewport({ width: 1280, height: 800 })
    await railPage.setContent(GITHUB_PAGE)
    await railPage.evaluate(CHROME_STUB)
    // A fresh tab, for someone who left the panel docked in the last one.
    await railPage.evaluate(async () => {
      ;(window as unknown as { __tabOpen: boolean }).__tabOpen = false
      const stored = await chrome.storage.local.get('windowState')
      await chrome.storage.local.set({
        windowState: { ...stored.windowState, docked: true, collapsed: false },
      })
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await railPage.evaluate(bundle)
    await railPage.waitForSelector('#github-sidecar-root')
    await railPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  })

  after(async () => {
    await railBrowser?.close()
  })

  const rail = () =>
    railPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[aria-label^="Expand"]') as HTMLElement | null
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, bottom: box.bottom }
    })

  const clickRail = async () => {
    await railPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label^="Expand"]') as HTMLButtonElement).click()
    })
    await railPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  }

  const panelShowing = () =>
    railPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[data-docked]'))
    })

  it('shows the rail rather than nothing at all', async () => {
    const box = await rail()

    assert.ok(box, 'expected a docked tab to leave its rail on screen')
    assert.equal(box.x, 0)
    assert.equal(box.bottom, 800)
    assert.ok(box.width <= 48, `expected a narrow rail, saw ${box.width}px`)
    // Below github.com's own chrome, exactly where the panel would have been.
    assert.ok(box.y >= 112, `expected the rail below the chrome, saw y=${box.y}`)
    assert.equal(await panelShowing(), false)
  })

  it('leaves the corner launcher to floating mode', async () => {
    const corner = await railPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[aria-label="Open GitHub Sidecar"]'))
    })
    assert.equal(corner, false)
  })

  it('still asks GitHub for nothing until it is opened', async () => {
    const sent = await railPage.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<{ type?: string }> })
          .__sentMessages,
    )
    assert.deepEqual(
      sent.filter((message) => message.type === 'search'),
      [],
      'a rail is not an open panel; it must not cost a request',
    )
  })

  it('opens from the rail alone', async () => {
    await clickRail()

    assert.equal(await panelShowing(), true)
    const opened = await railPage.evaluate(() =>
      (
        window as unknown as { __sentMessages: Array<{ type?: string; open?: boolean }> }
      ).__sentMessages.filter((message) => message.type === 'set-tab-open'),
    )
    assert.deepEqual(opened, [{ type: 'set-tab-open', open: true }])
  })

  it('takes one click to come back from hidden and collapsed at once', async () => {
    await railPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Collapse"]') as HTMLButtonElement).click()
    })
    await railPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.ok(await rail(), 'expected collapsing to leave the rail')

    // The toolbar button hides the panel in this tab, so a collapsed dock can
    // also be a hidden one. Both reasons for a rail are now set at once, and
    // one click has to clear both or expanding would just redraw the rail.
    await railPage.evaluate(() => {
      ;(window as unknown as { __broadcast: (m: unknown) => void }).__broadcast({
        type: 'toggle-sidebar',
      })
    })
    await railPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.ok(await rail(), 'expected the rail to survive being hidden')

    await clickRail()
    assert.equal(await panelShowing(), true)
  })
})
