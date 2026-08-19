import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
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
  headRefName: index % 2 ? 'octocat/branch-' + index : null,
  headRefOid: index % 2 ? 'sha' + index : null,
  // Row 1 conflicts, row 3 has fallen behind, the rest are fine.
  mergeState: index === 1 ? 'conflicting' : index === 3 ? 'behind' : index % 2 ? 'clean' : null,
  // Row 1 has more failing checks than the drawer shows at once, so it also
  // covers the list scrolling; the last has no link at all.
  failingChecks: index === 1
    ? [
        { name: 'unit tests', url: 'https://github.com/acme/app/runs/1' },
        { name: 'typecheck', url: 'https://github.com/acme/app/runs/2' },
        { name: 'lint', url: 'https://github.com/acme/app/runs/3' },
        { name: 'build (macos)', url: 'https://github.com/acme/app/runs/4' },
        { name: 'build (linux)', url: 'https://github.com/acme/app/runs/5' },
        { name: 'e2e', url: 'https://github.com/acme/app/runs/6' },
        { name: 'docs', url: 'https://github.com/acme/app/runs/7' },
        { name: 'legacy status', url: null },
      ]
    : [],
  checkCount: index === 1 ? 40 : null,
  checksRead: index === 1 ? 30 : 0,
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
window.__items = items;
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
            revalidating: window.__revalidating === true,
            // Set by the partial-results suite; GitHub can hand back rows and
            // a refusal in the same answer.
            warning: window.__searchWarning ?? null,
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

  it('renders the window with the fallback font stack and applied Tailwind styles', async () => {
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
    // This page publishes no Primer token, so the bundled default applies.
    assert.match(result.fontFamily, /Mona Sans VF/)
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

  it('shows labels as overlapping discs rather than as names', async () => {
    const dots = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector('[data-index="0"]')!
      const dot = row.querySelector('[role="img"][aria-label="bug"]') as HTMLElement
      const box = dot.getBoundingClientRect()
      const styles = getComputedStyle(dot)

      // The label's colour put through the same mixer at full strength, so the
      // fill can be compared with it in the space it was actually mixed in.
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'color-mix(in oklab, #d73a4a 100%, transparent 0%)'
      dot.after(probe)
      const pure = getComputedStyle(probe).backgroundColor
      probe.remove()

      return {
        width: box.width,
        border: styles.borderTopColor,
        fill: styles.backgroundColor,
        pure,
        // The name is carried by the label, never printed in the row.
        text: row.textContent ?? '',
      }
    })

    assert.ok(dots.width > 0 && dots.width <= 16, `saw a ${dots.width}px disc`)
    // The label's own colour draws the disc.
    assert.equal(dots.border, 'rgb(215, 58, 74)')
    assert.doesNotMatch(dots.text, /bug/)

    // The fill is that same colour taken back towards the surface: lighter
    // than the label, and opaque, so overlapping discs stay legible.
    assert.doesNotMatch(dots.fill, /\//, `expected an opaque fill, saw ${dots.fill}`)
    const lightness = (colour: string) => Number(colour.match(/[\d.]+/)![0])
    assert.ok(
      lightness(dots.fill) > lightness(dots.pure),
      `expected a lighter fill, saw ${dots.fill} against ${dots.pure}`,
    )
  })

  it('caps the dots at five and counts the rest', async () => {
    const row = await page.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[data-index="1"]')!
      // Octicons carry role="img" too once they are labelled, so the dots are
      // picked out by being the only spans drawn that way.
      const dots = [...node.querySelectorAll('span[role="img"]')] as HTMLElement[]
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

  it('offers the full title only when the row cannot show it', async () => {
    const TITLE = 'Item number 0 with a reasonably long title to wrap'

    const setPanelWidth = (width: string) =>
      page.evaluate((value) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const panel = shadow.querySelector('[role="complementary"]') as HTMLElement
        panel.style.width = value
      }, width)

    const titleNode = () =>
      page.evaluate((text) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const node = [...shadow.querySelectorAll('[data-index="0"] span')].find(
          (candidate) =>
            candidate.children.length === 0 && candidate.textContent === text,
        ) as HTMLElement
        const box = node.getBoundingClientRect()
        return {
          clamped: node.scrollHeight > node.clientHeight + 1,
          x: box.x + 10,
          y: box.y + 5,
        }
      }, TITLE)

    const namesTitle = () =>
      page.evaluate((text) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        return [...shadow.querySelectorAll('[role="tooltip"]')].some((node) =>
          node.textContent?.includes(text),
        )
      }, TITLE)

    // At full width the title is all there, and a hint would only repeat it.
    const whole = await titleNode()
    assert.equal(whole.clamped, false)
    await page.mouse.move(whole.x, whole.y)
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(await namesTitle(), false)

    await page.mouse.move(0, 0)
    await setPanelWidth('230px')

    // The panel is measured, not guessed, so wait for the row to agree it is
    // now too narrow, and for the hint's trigger to be in place, rather than
    // for a fixed number of frames.
    await page.waitForFunction(
      (text) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const node = [...shadow.querySelectorAll('[data-index="0"] span')].find(
          (candidate) =>
            candidate.children.length === 0 && candidate.textContent === text,
        ) as HTMLElement | undefined
        return (
          Boolean(node) &&
          node!.scrollHeight > node!.clientHeight + 1 &&
          node!.hasAttribute('data-state')
        )
      },
      {},
      TITLE,
    )

    const clipped = await titleNode()
    assert.equal(clipped.clamped, true)
    await page.mouse.move(clipped.x, clipped.y)
    // A nudge, so the hint hears a move even if the pointer was already there.
    await page.mouse.move(clipped.x + 3, clipped.y + 2)
    await page.waitForFunction(
      (text) =>
        [...document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll('[role="tooltip"]')].some((node) =>
          node.textContent?.includes(text),
        ),
      {},
      TITLE,
    )

    await page.mouse.move(0, 0)
    await setPanelWidth('420px')
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
<style>:root{--fontStack-sansSerif:"Test Page Face",Verdana,sans-serif}</style>
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

  it('borrows the font stack the page publishes', async () => {
    const fonts = await dockPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const container = shadow.getElementById('github-sidecar-container')!

      // Resolved through the page's own token, so both sides go through the
      // same normalisation and can be compared as strings.
      const probe = document.createElement('span')
      probe.style.fontFamily = 'var(--fontStack-sansSerif)'
      document.body.appendChild(probe)
      const pageFont = getComputedStyle(probe).fontFamily
      probe.remove()

      return { pageFont, panelFont: getComputedStyle(container).fontFamily }
    })

    assert.match(fonts.pageFont, /Test Page Face/)
    // Nothing is bundled: the panel renders in whatever github.com is using.
    assert.equal(fonts.panelFont, fonts.pageFont)
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
    await menuPage.waitForFunction(
      (text: string) =>
        [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
          (node) => node.textContent?.includes(text),
        ),
      {},
      label,
    )
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

    assert.deepEqual(labels, [
      'Pin item',
      'Remind me…',
      'Hide this row',
      'Refresh this item',
      // Every way of copying is one entry: they are the same verb on the same
      // row, and listing six of them alongside the actions read as neither.
      'Copy',
    ])
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

  it('draws the pending checks mark as a still amber dot', async () => {
    const mark = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const dot = shadow.querySelector('[data-check] svg.octicon-dot-fill')
      if (!dot) return null
      const styles = getComputedStyle(dot)
      return { animationName: styles.animationName, colour: styles.color }
    })

    assert.ok(mark, 'expected a pending checks mark to be rendered')
    // GitHub draws in-progress checks as a still dot, and the mark is
    // rotationally symmetric, so the slow spin it used to carry was motion
    // nobody could have seen.
    assert.equal(mark.animationName, 'none')
    assert.equal(mark.colour, 'oklch(0.72 0.16 70.7)')
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
    assert.deepEqual(labels, [
      'Unpin item',
      'Remind me…',
      'Hide this row',
      'Refresh this item',
      'Copy',
    ])

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

    // The section stays mounted so it can slide, so "expanded" is the state it
    // reports and the height it actually has, not the presence of its text.
    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const region = shadow.querySelector(
        '[data-index="1"] [data-stack="open"]',
      ) as HTMLElement | null
      return Boolean(region) && region!.getBoundingClientRect().height > 0
    })

    assert.match(await stackRow(), /Groundwork for the feature/)

    const layers = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[data-index="1"] [data-stack] li button')].map((node) =>
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
      const layer = [...shadow.querySelectorAll('[data-index="1"] [data-stack] li button')].find(
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

  it('shuts the stack again from the chevron along its top edge', async () => {
    const stackState = () =>
      menuPage.evaluate(() => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const region = shadow.querySelector('[data-index="1"] [data-stack]') as HTMLElement
        return {
          state: region.getAttribute('data-stack'),
          height: region.getBoundingClientRect().height,
        }
      })

    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      // The lid lives inside the slide-out, unlike the badge that opened it.
      const lid = shadow.querySelector(
        '[data-index="1"] [data-stack] [aria-label="Hide the stack"]',
      ) as HTMLButtonElement
      lid.click()
    })

    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const region = shadow.querySelector('[data-index="1"] [data-stack]') as HTMLElement
      return (
        region.getAttribute('data-stack') === 'closed' &&
        region.getBoundingClientRect().height === 0
      )
    })

    // Left open again for the context menu, which is the other way to shut it.
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const badge = shadow.querySelector(
        '[data-index="1"] [aria-label="Show the stack"]',
      ) as HTMLButtonElement
      badge.click()
    })

    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const region = shadow.querySelector('[data-index="1"] [data-stack]') as HTMLElement
      return region.getBoundingClientRect().height > 0
    })

    assert.equal((await stackState()).state, 'open')
  })

  it('offers the same toggle in the context menu, and collapses again', async () => {
    await openMenuOn(1)

    const labels = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[role="menuitem"]')].map((node) =>
        node.textContent?.trim(),
      )
    })
    assert.deepEqual(labels, [
      'Pin item',
      'Hide the stack',
      'Remind me…',
      'Hide this row',
      'Refresh this item',
      'Copy',
    ])

    await clickMenuItem('Hide the stack')
    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const region = shadow.querySelector(
        '[data-index="1"] [data-stack="closed"]',
      ) as HTMLElement | null
      // Collapsed means no height and no way in: the rows are still mounted so
      // the section can slide, but they are inert while it is shut.
      return (
        Boolean(region) &&
        region!.getBoundingClientRect().height === 0 &&
        region!.hasAttribute('inert')
      )
    })
  })

  /**
   * A test page is not a secure context, so it has no async clipboard API at
   * all. Standing one up is what puts the row on the path it takes on
   * github.com, and recording what it was handed is as close to the system
   * clipboard as a headless browser gets.
   */
  const stubClipboard = () =>
    menuPage.evaluate(() => {
      const scope = window as unknown as {
        __copied: Array<Record<string, string>>
        ClipboardItem: unknown
      }
      scope.__copied = []
      scope.ClipboardItem = class {
        readonly flavours: Record<string, Blob>
        constructor(flavours: Record<string, Blob>) {
          this.flavours = flavours
        }
        get types() {
          return Object.keys(this.flavours)
        }
        async getType(type: string) {
          return this.flavours[type]
        }
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          write: async (items: ClipboardItem[]) => {
            const flavours = items.flatMap((item) =>
              item.types.map(async (type) => [type, await (await item.getType(type)).text()]),
            )
            scope.__copied.push(Object.fromEntries(await Promise.all(flavours)))
          },
        },
      })
    })

  const copiedCount = () =>
    menuPage.evaluate(
      () => (window as unknown as { __copied: unknown[] }).__copied.length,
    )

  const lastCopy = () =>
    menuPage.evaluate(
      () =>
        (window as unknown as { __copied: Array<Record<string, string>> }).__copied.at(-1)!,
    )

  const waitForCopy = () =>
    menuPage.waitForFunction(
      () => (window as unknown as { __copied: unknown[] }).__copied.length > 0,
    )

  /** Opens the copy submenu and picks one of the ways of copying. */
  const clickCopyItem = async (label: string) => {
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const trigger = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === 'Copy',
      )
      ;(trigger as HTMLElement).click()
    })
    await menuPage.waitForFunction(
      (text: string) =>
        [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
          (node) => node.textContent?.trim() === text,
        ),
      {},
      label,
    )
    await menuPage.evaluate((text) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === text,
      )
      ;(entry as HTMLElement).click()
    }, label)
    await menuPage.waitForFunction(
      () => !document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('[role="menu"]'),
    )
  }

  /** What the copy submenu offers for the row its menu is open on. */
  const copyChoices = async () => {
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const trigger = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === 'Copy',
      )
      ;(trigger as HTMLElement).click()
    })
    await menuPage.waitForFunction(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menu"]')
          .length > 1,
    )

    return menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const submenu = [...shadow.querySelectorAll('[role="menu"]')].at(-1)!
      return [...submenu.querySelectorAll('[role="menuitem"]')].map(
        (node) => node.textContent?.trim() ?? '',
      )
    })
  }

  it('copies a link as rich text, with the bare URL underneath it', async () => {
    await stubClipboard()
    await openMenuOn(0)
    await clickCopyItem('Link')

    await waitForCopy()
    const copied = await lastCopy()

    assert.equal(copied['text/plain'], 'https://github.com/acme/app/pull/1')
    // Row 0 is the row the refresh suite above re-read, hence its title.
    assert.equal(
      copied['text/html'],
      '<a href="https://github.com/acme/app/pull/1">A refreshed title</a>',
    )
  })

  it('copies a title on its own', async () => {
    await stubClipboard()
    await openMenuOn(0)
    await clickCopyItem('Title')

    await waitForCopy()
    const copied = await lastCopy()

    assert.equal(copied['text/plain'], 'A refreshed title')
    assert.equal(copied['text/html'], undefined)
  })

  it('copies a pull request branch, and offers no branch for an issue', async () => {
    await stubClipboard()
    await openMenuOn(1)
    await clickCopyItem('Branch')

    await waitForCopy()
    assert.equal((await lastCopy())['text/plain'], 'octocat/branch-1')

    // Row 0 is an issue: no branch, and no stack either.
    await openMenuOn(0)
    const choices = await copyChoices()
    assert.deepEqual(choices, ['Link', 'Link as Markdown', 'Title'])
    assert.equal(await copiedCount(), 1)
  })

  it('copies a link as Markdown, carrying the layer of a stacked row', async () => {
    await stubClipboard()
    await openMenuOn(0)
    await clickCopyItem('Link as Markdown')

    await waitForCopy()
    assert.equal(
      (await lastCopy())['text/plain'],
      '[A refreshed title](https://github.com/acme/app/pull/1)',
    )

    // Row 1 is the middle layer of a stack, which its title says so that a
    // pasted list of them reads in order.
    await stubClipboard()
    await openMenuOn(1)
    await clickCopyItem('Link as Markdown')

    await waitForCopy()
    assert.equal(
      (await lastCopy())['text/plain'],
      '[Item number 1 with a reasonably long title to wrap <2/3>](https://github.com/acme/app/pull/2)',
    )
  })

  it('copies a whole stack, base first, plainly or as Markdown', async () => {
    await stubClipboard()
    await openMenuOn(1)
    await clickCopyItem('Stack links')

    await waitForCopy()
    assert.equal(
      (await lastCopy())['text/plain'],
      [
        'https://github.com/acme/app/pull/101',
        'https://github.com/acme/app/pull/2',
        'https://github.com/acme/app/pull/103',
      ].join('\n'),
    )

    await stubClipboard()
    await openMenuOn(1)
    await clickCopyItem('Stack links as Markdown')

    await waitForCopy()
    assert.equal(
      (await lastCopy())['text/plain'],
      [
        '[Groundwork for the feature <1/3>](https://github.com/acme/app/pull/101)',
        '[Item number 1 with a reasonably long title to wrap <2/3>](https://github.com/acme/app/pull/2)',
        '[The last layer <3/3>](https://github.com/acme/app/pull/103)',
      ].join('\n'),
    )
  })

  it('falls back to the copy command where the async API is refused', async () => {
    await menuPage.evaluate(() => {
      const scope = window as unknown as {
        __copied: Array<Record<string, string>>
        ClipboardItem: unknown
      }
      scope.__copied = []
      scope.ClipboardItem = undefined
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
      // Listens on the way back up, after the row's own capturing handler has
      // put both flavours on the event.
      document.addEventListener('copy', (event) => {
        scope.__copied.push({
          'text/plain': event.clipboardData?.getData('text/plain') ?? '',
          'text/html': event.clipboardData?.getData('text/html') ?? '',
        })
      })
    })

    await openMenuOn(0)
    await clickCopyItem('Link')

    await waitForCopy()
    const copied = await lastCopy()

    assert.equal(copied['text/plain'], 'https://github.com/acme/app/pull/1')
    // Row 0 is the row the refresh suite above re-read, hence its title.
    assert.equal(
      copied['text/html'],
      '<a href="https://github.com/acme/app/pull/1">A refreshed title</a>',
    )

    // The throwaway field the command needs must not be left behind.
    assert.equal(await menuPage.evaluate(() => document.querySelectorAll('textarea').length), 0)
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

describe('a refresh the worker started on its own', { concurrency: false, skip }, () => {
  let busyBrowser: Browser
  let busyPage: Page

  before(async () => {
    busyBrowser = await puppeteer.launch({ executablePath, headless: true })
    busyPage = await busyBrowser.newPage()
    await busyPage.setViewport({ width: 1280, height: 800 })
    await busyPage.setContent(
      '<!doctype html><html data-color-mode="light"><body></body></html>',
    )
    await busyPage.evaluate(CHROME_STUB)
    // The worker answers from cache and goes to the network behind it, which
    // is the state this tab can only learn about from the flag on the page.
    await busyPage.evaluate(() => {
      ;(window as unknown as { __revalidating: boolean }).__revalidating = true
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await busyPage.evaluate(bundle)
    await busyPage.waitForSelector('#github-sidecar-root')
  })

  after(async () => {
    await busyBrowser?.close()
  })

  const bar = () =>
    busyPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[role="progressbar"]')
      if (!node) return null
      const segment = node.firstElementChild as HTMLElement
      return {
        label: node.getAttribute('aria-label'),
        height: node.getBoundingClientRect().height,
        // A bar that is in the DOM but not actually animating would report
        // this state without ever looking like it.
        pulse: getComputedStyle(node).animationName,
        sweep: getComputedStyle(segment).animationName,
        busyHeader: shadow.querySelector('header')?.getAttribute('aria-busy'),
      }
    })

  it('reports itself, even though this tab issued no request', async () => {
    await busyPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })

    const shown = await bar()
    assert.ok(shown, 'expected the header to report a background refresh')
    assert.equal(shown.label, 'Refreshing results')
    assert.equal(shown.pulse, 'progress-pulse')
    assert.equal(shown.sweep, 'progress-sweep')
    assert.equal(shown.busyHeader, 'true')
    assert.ok(shown.height > 0, 'expected the bar to have height')
  })

  it('says so in the footer instead of quoting a stale timestamp', async () => {
    const footer = await busyPage.evaluate(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('footer')?.textContent ?? '',
    )
    assert.match(footer, /updating/)
  })

  it('stands down once the worker broadcasts the result back', async () => {
    await busyPage.evaluate(() => {
      ;(window as unknown as { __revalidating: boolean }).__revalidating = false
      ;(window as unknown as { __broadcast: (m: unknown) => void }).__broadcast({
        type: 'search-updated',
        query: 'is:open is:pr',
        after: null,
        page: {
          items: [],
          totalCount: 0,
          endCursor: null,
          hasNextPage: false,
          fetchedAt: Date.now(),
        },
      })
    })

    await busyPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[role="progressbar"]'),
      { timeout: 5_000 },
    )
    assert.equal(await bar(), null)
  })
})

/**
 * github.com binds single-letter shortcuts on `document`, and skips them when
 * the keystroke came from a form field. That check reads `event.target`, which
 * for anything inside a shadow root is retargeted to the host element — so
 * every keystroke this panel receives looks to the page like it came from an
 * anonymous div, and typing a query name opens the label picker underneath.
 */
describe('keyboard isolation', { concurrency: false, skip }, () => {
  let keyBrowser: Browser
  let keyPage: Page

  before(async () => {
    keyBrowser = await puppeteer.launch({ executablePath, headless: true })
    keyPage = await keyBrowser.newPage()
    await keyPage.setViewport({ width: 1280, height: 800 })
    await keyPage.setContent(
      '<!doctype html><html data-color-mode="light"><body><input id="page-input" /></body></html>',
    )
    await keyPage.evaluate(CHROME_STUB)

    // Stands in for github.com's own shortcut handler, bound exactly where
    // theirs is and reporting what it would have acted on.
    await keyPage.evaluate(() => {
      const seen: Array<{ key: string; target: string }> = []
      ;(window as unknown as { __pageKeys: typeof seen }).__pageKeys = seen
      document.addEventListener('keydown', (event) => {
        const target = event.target as HTMLElement
        seen.push({ key: event.key, target: target.id || target.tagName })
      })
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await keyPage.evaluate(bundle)
    await keyPage.waitForSelector('#github-sidecar-root')
    await keyPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })

    // Reach the panel's own inputs, which is where the interruption bites.
    const trigger = await keyPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = (
        shadow.querySelector('[aria-haspopup="menu"]') as HTMLElement
      ).getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await keyPage.mouse.click(trigger.x, trigger.y)
    await keyPage.waitForFunction(() =>
      Boolean(
        document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector(
          '[role="menuitem"]',
        ),
      ),
    )
    await keyPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes('Manage queries'),
      )
      ;(entry as HTMLElement).click()
    })
    await keyPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')
          ?.shadowRoot?.querySelector('input[placeholder="Query name"]'),
      ),
    )
  })

  after(async () => {
    await keyBrowser?.close()
  })

  const pageKeys = () =>
    keyPage.evaluate(
      () =>
        (window as unknown as { __pageKeys: Array<{ key: string; target: string }> })
          .__pageKeys,
    )

  const clearKeys = () =>
    keyPage.evaluate(() => {
      ;(window as unknown as { __pageKeys: unknown[] }).__pageKeys.length = 0
    })

  const focusQueryName = () =>
    keyPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const input = shadow.querySelector(
        'input[placeholder="Query name"]',
      ) as HTMLInputElement
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })

  it('keeps a shortcut key typed into the panel away from the page', async () => {
    await focusQueryName()
    await clearKeys()
    // `l` opens GitHub's label picker on an issue or pull request.
    await keyPage.keyboard.type('lg')

    assert.deepEqual(await pageKeys(), [])
  })

  it('still types the character it swallowed the shortcut for', async () => {
    const value = await keyPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return (shadow.querySelector('input[placeholder="Query name"]') as HTMLInputElement)
        .value
    })

    assert.match(value, /lg$/)
  })

  it('leaves the page shortcuts working outside the panel', async () => {
    await keyPage.evaluate(() => {
      ;(document.getElementById('page-input') as HTMLInputElement).focus()
    })
    await clearKeys()
    await keyPage.keyboard.type('l')

    assert.deepEqual(await pageKeys(), [{ key: 'l', target: 'page-input' }])
  })
})

describe('results GitHub only partly returned', { concurrency: false, skip }, () => {
  let warnBrowser: Browser
  let warnPage: Page
  const warning = 'Your token is not authorised for every organisation this query covers.'

  before(async () => {
    warnBrowser = await puppeteer.launch({ executablePath, headless: true })
    warnPage = await warnBrowser.newPage()
    await warnPage.setViewport({ width: 1280, height: 800 })
    await warnPage.setContent(
      '<!doctype html><html data-color-mode="light"><body></body></html>',
    )
    await warnPage.evaluate(CHROME_STUB)
    await warnPage.evaluate((text) => {
      ;(window as unknown as { __searchWarning: string }).__searchWarning = text
    }, warning)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await warnPage.evaluate(bundle)
    await warnPage.waitForSelector('#github-sidecar-root')
    await warnPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await warnBrowser?.close()
  })

  it('shows the rows it did get, with the refusal beside them', async () => {
    const shown = await warnPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const banner = shadow.querySelector('[aria-label="Dismiss warning"]')?.parentElement
      return {
        rows: shadow.querySelectorAll('[data-index]').length,
        banner: banner?.textContent?.trim() ?? null,
      }
    })

    assert.ok(shown.rows > 0, 'expected the readable rows to survive the refusal')
    assert.match(shown.banner ?? '', /not authorised/)
  })

  it('can be dismissed without taking the list with it', async () => {
    await warnPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Dismiss warning"]') as HTMLElement).click()
    })

    await warnPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[aria-label="Dismiss warning"]'),
    )

    const rows = await warnPage.evaluate(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll(
          '[data-index]',
        ).length,
    )
    assert.ok(rows > 0)
  })
})

/**
 * The row for whatever this tab is showing. Served from a real origin rather
 * than `setContent`, because the panel reads the path it is on and a test page
 * has to be able to navigate between paths the way github.com does.
 */
describe('the page this tab is on', { concurrency: false, skip }, () => {
  let server: Server
  let origin: string
  let pageBrowser: Browser
  let onPage: Page

  before(async () => {
    ;({ server, origin } = await serveBlankPages())

    pageBrowser = await puppeteer.launch({ executablePath, headless: true })
    onPage = await pageBrowser.newPage()
    await onPage.setViewport({ width: 1280, height: 800 })
    // Row 1 of the seeded list is acme/app#2.
    await onPage.goto(`${origin}/acme/app/pull/2`)
    await onPage.evaluate(CHROME_STUB)
    // Turbo and the back button are what the panel has to hear on github.com;
    // the Navigation API is a shortcut it may not be given in an isolated
    // world, so it is taken away here to leave the route that must work.
    await onPage.evaluate(() => {
      Object.defineProperty(window, 'navigation', { configurable: true, value: undefined })
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await onPage.evaluate(bundle)
    await onPage.waitForSelector('#github-sidecar-root')
    await onPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await pageBrowser?.close()
    await new Promise((resolve) => server.close(resolve))
  })

  /** Which rows carry the mark, by their index in the list. */
  const markedRows = () =>
    onPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[data-index]')]
        .filter((row) => row.querySelector('[data-current]'))
        .map((row) => Number(row.getAttribute('data-index')))
    })

  const navigate = (path: string) =>
    onPage.evaluate((to) => {
      history.pushState({}, '', to)
      document.dispatchEvent(new Event('turbo:load'))
    }, path)

  it('marks the row for the item the tab is showing, and only that row', async () => {
    await onPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-current]'),
      ),
    )

    assert.deepEqual(await markedRows(), [1])

    // The mark is stated for assistive technology too, not just drawn.
    const current = await onPage.evaluate(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="1"] [aria-current="page"]')
          ?.textContent?.includes('Item number 1'),
    )
    assert.equal(current, true)
  })

  it('stays on the same item across that pull request\'s own tabs', async () => {
    await navigate('/acme/app/pull/2/files')
    assert.deepEqual(await markedRows(), [1])
  })

  it('follows a Turbo navigation to another item', async () => {
    await navigate('/acme/app/issues/1')
    await onPage.waitForFunction(
      () =>
        Boolean(
          document
            .getElementById('github-sidecar-root')!
            .shadowRoot!.querySelector('[data-index="0"] [data-current]'),
        ),
    )
    assert.deepEqual(await markedRows(), [0])
  })

  it('marks nothing on a page that is not an item', async () => {
    await navigate('/acme/app/issues')
    await onPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-current]'),
    )
    assert.deepEqual(await markedRows(), [])
  })

  it('follows the back button, which announces nothing of its own', async () => {
    await onPage.goBack()
    await onPage.waitForFunction(
      () =>
        Boolean(
          document
            .getElementById('github-sidecar-root')!
            .shadowRoot!.querySelector('[data-index="0"] [data-current]'),
        ),
    )
    assert.deepEqual(await markedRows(), [0])
  })

  /** Where the marker sits, against the panel edge and the row it points at. */
  const markerGeometry = () =>
    onPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marker = shadow.querySelector('[data-current-marker]') as HTMLElement | null
      if (!marker) return null
      const panel = shadow.querySelector('[role="complementary"]')!.getBoundingClientRect()
      const box = marker.getBoundingClientRect()
      const row = shadow
        .querySelector('[data-current] [data-item-body]')
        ?.getBoundingClientRect()
      return {
        visible: getComputedStyle(marker).visibility === 'visible',
        left: box.left,
        right: box.right,
        top: box.top,
        height: box.height,
        panelRight: panel.right,
        rowTop: row?.top ?? null,
        rowHeight: row?.height ?? null,
      }
    })

  it('points at the row from outside the panel, level with it', async () => {
    await navigate('/acme/app/pull/2')
    await onPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marker = shadow.querySelector('[data-current-marker]')
      return marker ? getComputedStyle(marker).visibility === 'visible' : false
    })

    const marker = (await markerGeometry())!

    // Anchored just inside the panel's edge, with its point out over the page.
    assert.ok(marker.left < marker.panelRight, 'expected the marker to meet the panel')
    // Past the edge, but only just: the point is a hint, not a tab.
    const overhang = marker.right - marker.panelRight
    assert.ok(overhang > 1 && overhang < 8, `overhang was ${overhang}px`)
    assert.equal(Math.round(marker.top), Math.round(marker.rowTop!))
    assert.equal(Math.round(marker.height), Math.round(marker.rowHeight!))
  })

  it('follows the list as it scrolls, and goes once the row has', async () => {
    const start = (await markerGeometry())!

    const scrollBy = (amount: number) =>
      onPage.evaluate((delta) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const list = shadow.querySelector('.scrollbar-slim')!
        list.scrollTop += delta
      }, amount)

    await scrollBy(40)
    await onPage.waitForFunction(
      (top: number) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const marker = shadow.querySelector('[data-current-marker]') as HTMLElement
        return Math.abs(marker.getBoundingClientRect().top - (top - 40)) < 2
      },
      {},
      start.top,
    )

    // Far enough that the row itself is gone; the marker must not be left
    // pointing at whatever took its place.
    await scrollBy(2000)
    await onPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marker = shadow.querySelector('[data-current-marker]')
      return !marker || getComputedStyle(marker).visibility === 'hidden'
    })

    await scrollBy(-2040)
    await onPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marker = shadow.querySelector('[data-current-marker]')
      return Boolean(marker) && getComputedStyle(marker!).visibility === 'visible'
    })
  })

  it('follows the panel as the window is dragged', async () => {
    const start = (await markerGeometry())!

    const handle = await onPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const region = shadow.querySelector('[data-drag-region]') as HTMLElement
      const box = region.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })

    await onPage.mouse.move(handle.x, handle.y)
    await onPage.mouse.down()
    await onPage.mouse.move(handle.x - 70, handle.y - 30, { steps: 8 })
    await onPage.mouse.up()

    await onPage.waitForFunction(
      (left: number) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const marker = shadow.querySelector('[data-current-marker]') as HTMLElement
        return Math.abs(marker.getBoundingClientRect().left - (left - 70)) < 2
      },
      {},
      start.left,
    )

    const moved = (await markerGeometry())!
    assert.ok(moved.left < moved.panelRight)
    assert.equal(
      Math.round(moved.right - moved.panelRight),
      Math.round(start.right - start.panelRight),
    )
  })

  it('marks nothing for an item this query does not hold', async () => {
    await navigate('/other/repo/pull/2')
    await onPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-current]'),
    )
    assert.deepEqual(await markedRows(), [])
  })
})

/** Any path answers with the same empty page, so navigation is all that varies. */
function serveBlankPages(): Promise<{ server: Server; origin: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><html data-color-mode="light"><head><title>acme/app</title></head><body></body></html>')
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, origin: `http://127.0.0.1:${port}` })
    })
  })
}

/**
 * The features that turn a list of state into a list of what has moved: change
 * marks, reminders, hidden rows, the failing-check drawer, the filter, and the
 * keyboard. All are switched on by default, which is what the stub's settings
 * leave them as.
 */
describe('changes, reminders, hidden rows, and filtering', { concurrency: false, skip }, () => {
  let panelBrowser: Browser
  let panel: Page

  before(async () => {
    panelBrowser = await puppeteer.launch({ executablePath, headless: true })
    panel = await panelBrowser.newPage()
    await panel.setViewport({ width: 1280, height: 900 })
    await panel.setContent('<!doctype html><html data-color-mode="light"><body></body></html>')
    await panel.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await panel.evaluate(bundle)
    await panel.waitForSelector('#github-sidecar-root')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await panelBrowser?.close()
  })

  const shadowText = (selector: string) =>
    panel.evaluate((query) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelector(query)?.textContent?.trim() ?? null
    }, selector)

  const openMenuOn = async (index: number) => {
    const point = await panel.evaluate((rowIndex) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector(`[data-index="${rowIndex}"] button`)!
      const box = row.getBoundingClientRect()
      return { x: box.x + 40, y: box.y + 20 }
    }, index)

    await panel.mouse.click(point.x, point.y, { button: 'right' })
    await panel.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('[role="menu"]')),
    )
  }

  const clickMenuItem = async (label: string) => {
    // The menu is mounted before the items that depend on the row's state
    // have rendered, so the entry is waited for rather than assumed.
    await panel.waitForFunction(
      (text: string) =>
        [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
          (node) => node.textContent?.includes(text),
        ),
      {},
      label,
    )
    await panel.evaluate((text) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes(text),
      )
      ;(entry as HTMLElement).click()
    }, label)
    await panel.waitForFunction(
      () => !document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('[role="menu"]'),
    )
  }

  /**
   * Pushes a changed copy of one seeded row back, as a poll would, and leaves
   * the seeded row changed so a later refetch agrees with it.
   *
   * Order matters both ways round. The broadcast has to go first, because the
   * panel's query cache holds the seeded array itself and editing it in place
   * would make the update deep-equal to what is already there — react-query
   * would drop it as a no-op. The seed has to be updated after, or the next
   * search would hand the old row back and undo the change.
   */
  const changeItem = (index: number, patch: Record<string, unknown>) =>
    panel.evaluate(
      ({ index: at, patch: fields }) => {
        const scope = window as unknown as {
          __items: Array<Record<string, unknown>>
          __broadcast: (message: unknown) => void
        }
        const item = { ...scope.__items[at], ...fields }
        scope.__broadcast({ type: 'item-updated', item })
        scope.__items[at] = item
      },
      { index, patch },
    )

  it('starts every row seen, so nothing is marked on first sight', async () => {
    const remembered = await panel.evaluate(
      async () => Object.keys((await chrome.storage.local.get('itemMemory')).itemMemory ?? {}).length,
    )
    assert.ok(remembered > 0, 'expected the rows on screen to have been remembered')

    assert.equal(await shadowText('[data-change]'), null)
  })

  it('marks a row that moved, in the words of what happened', async () => {
    await changeItem(0, { commentCount: 12 })

    await panel.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-index="0"] [data-change]')),
    )
    assert.equal(await shadowText('[data-index="0"] [data-change]'), '12 new comments')
  })

  it('clears the mark once the row has been marked as seen', async () => {
    await openMenuOn(0)
    await clickMenuItem('Mark as seen')

    await panel.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-change]'),
    )
  })

  it('hides a row, says where it went, and brings it back', async () => {
    await openMenuOn(1)
    await clickMenuItem('Hide this row')

    await panel.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.textContent?.includes('Item number 1 '),
    )

    const control = () =>
      panel.evaluate(() => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        return [...shadow.querySelectorAll('button')]
          .map((node) => node.textContent?.trim())
          .find((text) => text?.includes('hidden'))
      })
    assert.equal(await control(), 'show 1 hidden')

    const clickControl = () =>
      panel.evaluate(() => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const node = [...shadow.querySelectorAll('button')].find((button) =>
          button.textContent?.includes('hidden'),
        )
        ;(node as HTMLElement).click()
      })

    // Reviewing them is what makes hiding safe: they are listed, marked as
    // hidden, and one menu away from coming back.
    await clickControl()
    await panel.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-row-hidden]')),
    )

    await openMenuOn(1)
    const labels = await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[role="menuitem"]')].map((node) =>
        node.textContent?.trim(),
      )
    })
    assert.ok(labels.includes('Show it again'), labels.join(', '))
    await clickMenuItem('Show it again')

    await panel.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-row-hidden]'),
    )
    assert.equal(await control(), undefined)
  })

  it('offers to show hidden rows only where this view holds one', async () => {
    const control = () =>
      panel.evaluate(() =>
        [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('button')]
          .map((node) => node.textContent?.trim())
          .find((text) => text?.includes('hidden')),
      )

    await openMenuOn(0)
    await clickMenuItem('Hide this row')
    await panel.waitForFunction(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('button')].some(
        (node) => node.textContent?.includes('hidden'),
      ),
    )
    assert.equal(await control(), 'show 1 hidden')

    // A filter that the hidden row does not match makes the offer an empty
    // one: clicking it would change nothing, so it is not made.
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Filter these rows"]') as HTMLElement).click()
    })
    await panel.waitForSelector('#github-sidecar-root')
    await panel.keyboard.type('regression')
    await panel.waitForFunction(
      () =>
        ![...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('button')].some(
          (node) => node.textContent?.includes('hidden'),
        ),
    )

    await panel.keyboard.press('Escape')
    await panel.waitForFunction(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('button')].some(
        (node) => node.textContent?.includes('hidden'),
      ),
    )
    assert.equal(await control(), 'show 1 hidden')

    // Put it back, so the rows that follow are the rows that were seeded.
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = [...shadow.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('hidden'),
      )
      ;(node as HTMLElement).click()
    })
    await panel.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-row-hidden]')),
    )
    await openMenuOn(0)
    await clickMenuItem('Show it again')
    await panel.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-row-hidden]'),
    )
  })

  it('leaves a row where it is when a reminder is set on it', async () => {
    await openMenuOn(1)
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const trigger = [...shadow.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes('Remind me'),
      )
      ;(trigger as HTMLElement).click()
    })
    await panel.waitForFunction(() =>
      Boolean(
        [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
          (node) => node.textContent?.trim() === 'When it changes',
        ),
      ),
    )
    await clickMenuItem('When it changes')

    // Still listed, and now marked as waiting: a reminder is not a way of
    // getting rid of a row.
    await panel.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="1"] [data-reminder="waiting"]'),
      ),
    )
    const row = await shadowText('[data-index="1"]')
    assert.match(row ?? '', /Item number 1 /)
  })

  it('speaks up when the row a reminder was set on moves', async () => {
    await changeItem(1, { commentCount: 44 })

    await panel.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="1"] [data-reminder="due"]'),
      ),
    )
  })

  it('retires a reminder that has been answered, and cancels one that has not', async () => {
    // Reading the row is the answer to a reminder that has come round.
    await openMenuOn(1)
    await clickMenuItem('Mark as seen')
    await panel.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-reminder]'),
    )

    // One still waiting stays until it is cancelled outright: the reader asked
    // for a time, and looking at the row now is not that time.
    await openMenuOn(1)
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const trigger = [...shadow.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes('Remind me'),
      )
      ;(trigger as HTMLElement).click()
    })
    await panel.waitForFunction(() =>
      Boolean(
        [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
          (node) => node.textContent?.trim() === 'Tomorrow morning',
        ),
      ),
    )
    await clickMenuItem('Tomorrow morning')
    await panel.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-reminder="waiting"]')),
    )

    // Reading the row now is not the time they asked for, so opening it —
    // which is as read as a row gets — leaves the reminder standing.
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[data-index="1"] button') as HTMLElement).click()
    })
    await new Promise((resolve) => setTimeout(resolve, 150))

    const stillWaiting = await panel.evaluate(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-reminder="waiting"]')),
    )
    assert.equal(stillWaiting, true)

    await openMenuOn(1)
    await clickMenuItem('Clear the reminder')
    await panel.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-reminder]'),
    )
  })

  it('opens the failing checks under the row, and each one links out', async () => {
    const mark = await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const button = shadow.querySelector('[data-check="FAILURE"]') as HTMLElement
      const text = button.textContent?.trim() ?? ''
      button.click()
      return text
    })
    // The mark counts them rather than naming one of them.
    assert.match(mark, /^8/)

    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const drawer = shadow.querySelector('[data-checks="open"]') as HTMLElement | null
      return Boolean(drawer) && drawer!.getBoundingClientRect().height > 0
    })

    const listed = await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const list = shadow.querySelector('[data-checks="open"] ul') as HTMLElement
      return {
        names: [...list.querySelectorAll('li')].map((node) => node.textContent?.trim()),
        // More checks than fit, so the list scrolls rather than growing.
        scrolls: list.scrollHeight > list.clientHeight,
      }
    })

    assert.deepEqual(listed.names, [
      'unit tests',
      'typecheck',
      'lint',
      'build (macos)',
      'build (linux)',
      'e2e',
      'docs',
      'legacy status',
      // The rollup had more checks than the query read, and says so — counted
      // against what was read, not against what failed.
      'and 10 more checks not read',
    ])
    assert.equal(listed.scrolls, true)

    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[data-checks="open"] button')].find((node) =>
        node.textContent?.includes('build (linux)'),
      )
      ;(entry as HTMLElement).click()
    })

    const opened = await panel.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<{ type?: string; url?: string }> })
          .__sentMessages.filter((message) => message.type === 'open-item'),
    )
    assert.equal(opened.at(-1)?.url, 'https://github.com/acme/app/runs/5')

    // The lid shuts it again, as the stack's does.
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Hide the failing checks"]') as HTMLElement).click()
    })
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const drawer = shadow.querySelector('[data-checks="closed"]') as HTMLElement | null
      return Boolean(drawer) && drawer!.getBoundingClientRect().height === 0
    })
  })

  it('says why a red row cannot name a check, rather than looking arbitrary', async () => {
    // A rollup GitHub calls red while naming nothing red is the case that made
    // two rows with the same mark behave differently.
    await changeItem(0, { checkState: 'FAILURE', failingChecks: [], checkCount: null })

    await panel.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="0"] [data-check="FAILURE"]'),
      ),
    )

    const mark = await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[data-index="0"] [data-check="FAILURE"]')!
      return { tag: node.tagName, text: node.textContent?.trim() }
    })

    // No count and no drawer, because there is nothing to list — and the mark
    // says as much rather than leaving the difference unexplained.
    assert.equal(mark.tag, 'SPAN')
    assert.equal(mark.text, 'Checks failing, though GitHub names none of them as red')
  })

  it('narrows the loaded rows from the keyboard, and asks GitHub for nothing', async () => {
    const searches = () =>
      panel.evaluate(
        () =>
          (window as unknown as { __sentMessages: Array<{ type?: string }> }).__sentMessages.filter(
            (message) => message.type === 'search',
          ).length,
      )
    const searchesBefore = await searches()

    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[data-index="0"] button') as HTMLElement).focus()
    })
    await panel.keyboard.press('/')
    await panel.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('input[aria-label="Filter the rows already loaded"]'),
      ),
    )

    // A label only one row carries, so what is left is unambiguous. The rows
    // are matched on everything they show, labels included.
    await panel.keyboard.type('regression')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      // The trailing row is the loader for the next page, not a result.
      const rows = [...shadow.querySelectorAll('[data-index]')].filter(
        (row) => !row.textContent?.includes('Loading more'),
      )
      return rows.length > 0 && rows.every((row) => row.textContent?.includes('Item number 1 '))
    })

    // Filtering reads what is loaded. It must not go looking for matches in
    // pages nobody asked for — which is also what stops a short filtered list
    // paging through the whole result set.
    assert.equal(await searches(), searchesBefore)

    await panel.keyboard.press('Escape')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return (
        !shadow.querySelector('input[aria-label="Filter the rows already loaded"]') &&
        [...shadow.querySelectorAll('[data-index]')].some(
          (row) => !row.textContent?.includes('Item number 1 '),
        )
      )
    })
  })

  it('survives a row cached before the newer fields existed', async () => {
    // Exactly what an extension update leaves behind: a tab still holding rows
    // fetched by the build before it. The row must cost the panel those marks,
    // never the list.
    await panel.evaluate(() => {
      const scope = window as unknown as {
        __items: Array<Record<string, unknown>>
        __broadcast: (message: unknown) => void
      }
      const old = { ...scope.__items[2] }
      for (const field of ['failingChecks', 'checkCount', 'checksRead', 'mergeState', 'headRefOid']) {
        delete old[field]
      }
      old.title = 'A row from an older build'
      scope.__broadcast({ type: 'item-updated', item: old })
    })

    await panel.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.textContent?.includes('A row from an older build'),
      ),
    )

    const rows = await panel.evaluate(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-index]')
          .length,
    )
    assert.ok(rows > 1, 'expected the list to survive the older row')
  })

  it('moves through the list with j and k, and pins with p', async () => {
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('.scrollbar-slim') as HTMLElement).focus()
    })

    await panel.keyboard.press('j')
    await panel.keyboard.press('j')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const row = shadow.querySelector('[data-index="1"] button')
      return shadow.activeElement === row
    })

    await panel.keyboard.press('k')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.activeElement === shadow.querySelector('[data-index="0"] button')
    })

    await panel.keyboard.press('p')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[data-pinned]'))
    })

    const stored = await panel.evaluate(() => chrome.storage.local.get('pinnedIds'))
    assert.equal(stored.pinnedIds.length, 1)
  })
})

/**
 * Developer mode, which is how a reminder set for tomorrow morning can be seen
 * to work today. The panel is given a stub whose settings ask for reminders in
 * a second or two.
 */
describe('reminders in developer mode', { concurrency: false, skip }, () => {
  let devBrowser: Browser
  let devPanel: Page

  before(async () => {
    devBrowser = await puppeteer.launch({ executablePath, headless: true })
    devPanel = await devBrowser.newPage()
    await devPanel.setViewport({ width: 1280, height: 900 })
    await devPanel.setContent('<!doctype html><html data-color-mode="light"><body></body></html>')
    await devPanel.evaluate(
      CHROME_STUB.replace(
        "activeQueryId: 'seeded',",
        "activeQueryId: 'seeded',\n    developer: { enabled: true, reminderSeconds: { hour: 1, evening: 2, tomorrow: 3, week: 4 } },",
      ),
    )

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await devPanel.evaluate(bundle)
    await devPanel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await devBrowser?.close()
  })

  it('says in the menu what the named times have become', async () => {
    const point = await devPanel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = shadow.querySelector('[data-index="0"] button')!.getBoundingClientRect()
      return { x: box.x + 40, y: box.y + 20 }
    })
    await devPanel.mouse.click(point.x, point.y, { button: 'right' })
    await devPanel.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[role="menu"]')),
    )

    await devPanel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const trigger = [...shadow.querySelectorAll('[role="menuitem"]')].find((node) =>
        node.textContent?.includes('Remind me'),
      )
      ;(trigger as HTMLElement).click()
    })

    await devPanel.waitForFunction(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
        (node) => node.textContent?.trim() === 'In an hour · 1s',
      ),
    )

    const choices = await devPanel.evaluate(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')]
        .map((node) => node.textContent?.trim())
        .filter((text) => text?.includes('·') || text === 'When it changes'),
    )
    assert.deepEqual(choices, [
      'In an hour · 1s',
      'This evening · 2s',
      'Tomorrow morning · 3s',
      'Next week · 4s',
      // The one that waits on the row is untouched: it has no clock to
      // override, so it says what it always says.
      'When it changes',
    ])
  })

  it('comes round on its own, without waiting for anything else to happen', async () => {
    await devPanel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === 'In an hour · 1s',
      )
      ;(entry as HTMLElement).click()
    })

    await devPanel.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="0"] [data-reminder="waiting"]'),
      ),
    )

    // Nothing polls, nothing is broadcast, nothing is clicked: the mark has to
    // change itself.
    await devPanel.waitForFunction(
      () =>
        Boolean(
          document
            .getElementById('github-sidecar-root')!
            .shadowRoot!.querySelector('[data-index="0"] [data-reminder="due"]'),
        ),
      { timeout: 8000 },
    )
  })
})
