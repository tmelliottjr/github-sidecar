import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import puppeteer, { type Browser, type Page } from 'puppeteer-core'

import { DOCK_INSET } from '../src/content/page-layout.ts'

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const distRoot = new URL('../dist/chrome/', import.meta.url)

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
  windowState: { collapsed: false, dockWidth: 420 },
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
  // A couple of rows are assigned, so grouping by assignee has something to
  // gather; the rest fall into the unassigned section.
  assignees: index % 5 === 0
    ? [{ login: 'octocat', avatarUrl: null }]
    : index % 5 === 1
      ? [{ login: 'hubot', avatarUrl: null }]
      : [],
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
    ? { id: 'STACK_4', number: 4, size: 3, baseRefName: 'main', position: 2 }
    : null,
}));
window.__items = items;
// The whole stack behind row 1, as the worker answers a stacks message.
window.__stacks = [{
  id: 'STACK_4',
  number: 4,
  size: 3,
  baseRefName: 'main',
  fetchedAt: Date.now(),
  layers: [
    {
      id: 'stack_1',
      number: 101,
      title: 'Groundwork for the feature',
      url: 'https://github.com/acme/app/pull/101',
      repository: 'acme/app',
      state: 'open',
      position: 1,
    },
    {
      id: 'item_1',
      number: 2,
      title: 'Item number 1 with a reasonably long title to wrap',
      url: 'https://github.com/acme/app/pull/2',
      repository: 'acme/app',
      state: 'draft',
      position: 2,
    },
    {
      id: 'stack_3',
      number: 103,
      title: 'The last layer',
      url: 'https://github.com/acme/app/pull/103',
      repository: 'acme/app',
      state: 'open',
      position: 3,
    },
  ],
}];
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
      if (message.type === 'layer-reviews') {
        const decisions = window.__layerReviews ?? {};
        const reviews = message.ids.map((id) => ({
          id,
          reviewDecision: decisions[id] ?? null,
          fetchedAt: Date.now(),
        }));
        return { ok: true, data: { reviews, failedIds: [] } };
      }
      if (message.type === 'stacks') {
        const wanted = new Set(message.rows.map((row) => row.stack.id));
        const stacks = window.__failStacks
          ? []
          : window.__stacks.filter((stack) => wanted.has(stack.id));
        const found = new Set(stacks.map((stack) => stack.id));
        return {
          ok: true,
          data: { stacks, failedIds: [...wanted].filter((id) => !found.has(id)) },
        };
      }
      if (message.type === 'search') {
        // Set by suites that need a later page to differ from the first.
        const custom = window.__searchPages?.[message.after ?? ''];
        return {
          ok: true,
          data: {
            items: custom ? custom.items : items,
            totalCount: 400,
            endCursor: custom ? custom.endCursor : 'CURSOR',
            hasNextPage: custom ? custom.hasNextPage : true,
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

/**
 * Waits for the launcher and the panel to finish morphing into each other, and
 * for the page to finish moving with them. Motion drives the morph from
 * JavaScript, so `getAnimations()` misses it.
 */
const settleMorph = (target: Page) =>
  target.waitForFunction(
    () =>
      !document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('[data-morphing]') &&
      !document.body.hasAttribute('data-github-sidecar-moving'),
  )

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

  it('shows its rows at once when the page loads with the panel open', async () => {
    const fades = await page.evaluate(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('.animate-list-in')),
    )
    assert.equal(fades, false, 'expected no morph to wait for on page load')
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

      // The label's color put through the same mixer at full strength, so the
      // edge can be compared with it in the space it was actually mixed in.
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
    // The label's own color fills the disc.
    assert.equal(dots.fill, 'rgb(215, 58, 74)')
    assert.doesNotMatch(dots.text, /bug/)

    // The edge is that color taken toward the text color, which is dark in
    // light mode, so even a pale label keeps a visible outline on white.
    assert.doesNotMatch(dots.border, /\//, `expected an opaque edge, saw ${dots.border}`)
    const lightness = (color: string) => Number(color.match(/[\d.]+/)![0])
    assert.ok(
      lightness(dots.border) < lightness(dots.pure),
      `expected a darker edge, saw ${dots.border} against ${dots.pure}`,
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

    // Leave the row alone again so later tests see an unhovered list. In steps,
    // so Radix sees the pointer leave the tooltip grace area and closes it.
    await page.mouse.move(0, 0, { steps: 8 })
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

  it('reports no console errors', () => {
    assert.deepEqual(consoleErrors, [])
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

describe('docked into the page', { concurrency: false, skip }, () => {
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

  const panel = async () => {
    await settleMorph(dockPage)
    return dockPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = shadow.querySelector('[role="complementary"]') as HTMLElement
      const box = node.getBoundingClientRect()
      const styles = getComputedStyle(node)
      return {
        docked: node.hasAttribute('data-docked'),
        x: box.x,
        y: box.y,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        borderLeft: styles.borderLeftWidth,
        borderRight: styles.borderRightWidth,
        radius: parseFloat(styles.borderTopLeftRadius),
        boxShadow: styles.boxShadow,
        transform: styles.transform,
      }
    })
  }

  /** Where the page itself starts drawing, and what we took to get it there. */
  const host = () =>
    dockPage.evaluate(() => {
      const chrome = document.querySelector('.AppHeader')!.getBoundingClientRect()
      const nav = document.querySelector('.js-header-wrapper')!.getBoundingClientRect()
      return {
        bodyPadding: parseFloat(getComputedStyle(document.body).paddingLeft),
        headingLeft: document.getElementById('heading')!.getBoundingClientRect().left,
        chromeLeft: chrome.left,
        chromeWidth: chrome.width,
        chromeBottom: nav.bottom,
      }
    })

  const clickControl = async (label: string) => {
    await dockPage.evaluate((selector) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector(selector) as HTMLButtonElement).click()
    }, `[aria-label="${label}"]`)
    // The dock measures the page in an effect, so let React commit first.
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
  }

  it('sits in the page gutter, below the header and nav', async () => {
    const box = await panel()

    assert.equal(box.docked, true)
    assert.equal(box.x, DOCK_INSET)
    assert.equal(box.y, (await host()).chromeBottom + DOCK_INSET)
    assert.equal(box.bottom, 900 - DOCK_INSET)
  })

  it('floats as a rounded card with an edge on every side', async () => {
    const box = await panel()
    assert.equal(box.borderLeft, '1px')
    assert.equal(box.borderRight, '1px')
    assert.ok(box.radius > 0, 'expected rounded corners')
    assert.match(box.boxShadow, /oklch/)
  })

  it('takes no space when the gutter already has room', async () => {
    const hostPage = await host()
    const box = await panel()

    assert.equal(hostPage.bodyPadding, 0)
    assert.equal(hostPage.chromeLeft, 0)
    assert.ok(
      hostPage.headingLeft > box.right,
      `expected the page clear of the panel, saw ${hostPage.headingLeft} vs ${box.right}`,
    )
  })

  it('pushes the page across when the gutter is too narrow', async () => {
    await dockPage.setViewport({ width: NARROW, height: 900 })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    const hostPage = await host()
    const box = await panel()

    assert.ok(hostPage.bodyPadding > 0, 'expected the page to be pushed across')
    assert.ok(hostPage.headingLeft >= box.right, 'expected the content clear of the panel')
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

  it('follows the nav as it scrolls away, rather than springing after it', async () => {
    await dockPage.evaluate(() => window.scrollTo(0, 0))
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    const unscrolled = await panel()

    await dockPage.evaluate(() => window.scrollTo(0, 30))
    // The top is remeasured on the frame after the scroll, then rendered.
    await dockPage.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const scrolled = await panel()

    assert.equal(scrolled.y, unscrolled.y - 30)
    assert.equal(scrolled.transform, 'none')
  })

  /** The launcher tab, measured once it settles, or null when it is not showing. */
  const launcher = async () => {
    await settleMorph(dockPage)
    return dockPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      await Promise.allSettled(shadow.getAnimations().map((animation) => animation.finished))
      const node = shadow.querySelector('[data-launcher]') as HTMLElement | null
      if (!node) return null
      const box = shadow.querySelector('[data-launcher-capsule]')!.getBoundingClientRect()
      return {
        x: box.x,
        middle: box.top + box.height / 2,
        height: box.height,
        chip: shadow.querySelector('[data-launcher-chip]')?.textContent ?? null,
        panelGone: !shadow.querySelector('[data-docked]'),
      }
    })
  }

  it('collapses to the launcher and gives the page its space back', async () => {
    await dockPage.evaluate(() => window.scrollTo(0, 0))
    await dockPage.setViewport({ width: NARROW, height: 900 })
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    assert.ok((await host()).bodyPadding > 0, 'expected the open panel to need the page moved')

    await clickControl('Collapse')
    const pill = await launcher()

    assert.ok(pill, 'expected the launcher once collapsed')
    assert.equal(pill.panelGone, true)
    // Against the left edge, halfway down the viewport.
    assert.equal(pill.x, 0)
    assert.equal(Math.round(pill.middle), 450)
    assert.equal((await host()).bodyPadding, 0)
    assert.equal(
      await dockPage.evaluate(() => document.body.style.getPropertyValue('padding-left')),
      '',
    )
  })

  /** Sends the launcher a refreshed total, as the worker does after a poll. */
  const refreshTotal = async (totalCount: number) => {
    await dockPage.evaluate((total) => {
      const broadcast = (window as unknown as { __broadcast: (m: unknown) => void })
        .__broadcast
      broadcast({
        type: 'search-updated',
        query: 'is:open is:pr',
        after: null,
        page: {
          items: [],
          totalCount: total,
          endCursor: null,
          hasNextPage: false,
          fetchedAt: Date.now(),
        },
      })
    }, totalCount)
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))
  }

  it('keeps taking results while collapsed', async () => {
    assert.equal((await launcher())!.chip, '400')

    // A refresh landing while collapsed has to reach the launcher, otherwise
    // the count it is showing is decoration rather than status.
    await refreshTotal(4321)
    assert.equal((await launcher())!.chip, '999+', 'expected the circle to cap the count')

    await refreshTotal(7)
    assert.equal((await launcher())!.chip, '7')
  })

  it('announces the query name with the count', async () => {
    const description = await dockPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const open = shadow.querySelector('[aria-label="Open GitHub Sidecar"]')!
      return shadow.getElementById(open.getAttribute('aria-describedby')!)?.textContent
    })
    assert.equal(description, 'Needs my review, 7 results')
  })

  it('opens again from the launcher, scrolled past the sticky header', async () => {
    await dockPage.evaluate(() => window.scrollTo(0, 800))
    await dockPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    await clickControl('Open GitHub Sidecar')

    const box = await panel()
    assert.equal(box.docked, true)
    assert.ok(box.width > 100, `expected the panel back, saw ${box.width}px`)

    // The pinned header still ends above the page, even though <main> has
    // scrolled up past it, so it has to stay full-bleed.
    const hostPage = await host()
    assert.ok(hostPage.bodyPadding > 0, 'expected the page to be pushed across')
    assert.equal(hostPage.chromeLeft, 0)
    assert.equal(hostPage.chromeWidth, NARROW)
  })
})

/**
 * The shell github.com serves its newer pages from: a staff bar and a header
 * with none of the older class names, side by side above `<main>`, and a
 * fixed two-pixel progress bar across the top of the viewport.
 */
const NEWER_GITHUB_PAGE = `<!doctype html><html data-color-mode="light"><body style="margin:0">
<span class="progress-pjax-loader" style="position:fixed;top:0;left:0;width:100%;height:2px"></span>
<div><div>
  <aside id="staffbar" aria-label="Staffbar" style="height:32px;background:#1f2328"></aside>
  <header id="global-nav" class="GlobalNav" aria-label="Global navigation menu">
    <div style="height:52px"></div>
    <nav aria-label="Repository" style="height:48px;border-bottom:1px solid #d1d9e0"></nav>
  </header>
  <main>
    <div style="max-width:1280px;margin:0 auto;padding:24px">
      <h1 id="heading" style="margin:0">A repository</h1>
      <div style="height:2400px;background:#f6f8fa"></div>
    </div>
  </main>
</div></div>
</body></html>`

describe('docked on a page from the newer frontend', { concurrency: false, skip }, () => {
  let newerBrowser: Browser
  let newerPage: Page

  const NARROW = 1100

  before(async () => {
    newerBrowser = await puppeteer.launch({ executablePath, headless: true })
    newerPage = await newerBrowser.newPage()
    await newerPage.setViewport({ width: NARROW, height: 900 })
    await newerPage.setContent(NEWER_GITHUB_PAGE)
    await newerPage.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await newerPage.evaluate(bundle)
    await newerPage.waitForSelector('#github-sidecar-root')
    await newerPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  })

  after(async () => {
    await newerBrowser?.close()
  })

  const layout = () =>
    newerPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const panel = shadow.querySelector('[data-docked]')!.getBoundingClientRect()
      const box = (id: string) => {
        const rect = document.getElementById(id)!.getBoundingClientRect()
        return { left: rect.left, width: rect.width, bottom: rect.bottom }
      }
      return {
        panelTop: panel.top,
        panelRight: panel.right,
        staffbar: box('staffbar'),
        header: box('global-nav'),
        heading: box('heading'),
      }
    })

  it('moves the page clear of the panel, but not the header or staff bar', async () => {
    const boxes = await layout()

    assert.ok(boxes.heading.left >= boxes.panelRight, 'expected the content clear of the panel')
    assert.deepEqual(
      { left: boxes.staffbar.left, width: boxes.staffbar.width },
      { left: 0, width: NARROW },
    )
    assert.deepEqual(
      { left: boxes.header.left, width: boxes.header.width },
      { left: 0, width: NARROW },
    )
  })

  it('starts the panel below the header', async () => {
    const boxes = await layout()
    assert.ok(
      boxes.panelTop >= boxes.header.bottom,
      `expected the panel below ${boxes.header.bottom}, saw ${boxes.panelTop}`,
    )
  })

  it('moves up to the top once the header scrolls away, past the progress bar', async () => {
    await newerPage.evaluate(() => window.scrollTo(0, 600))
    await newerPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 150)))

    assert.equal((await layout()).panelTop, DOCK_INSET)
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
      // The token as the browser resolves it, so the minified source spelling does not matter.
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-attention)'
      dot.parentElement!.append(probe)
      const attention = getComputedStyle(probe).color
      probe.remove()
      return { animationName: styles.animationName, colour: styles.color, attention }
    })

    assert.ok(mark, 'expected a pending checks mark to be rendered')
    // GitHub draws in-progress checks as a still dot, and the mark is
    // rotationally symmetric, so the slow spin it used to carry was motion
    // nobody could have seen.
    assert.equal(mark.animationName, 'none')
    assert.equal(mark.colour, mark.attention)
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
    // An unstacked row says nothing about stacks and offers no expander. Menu
    // buttons report `aria-expanded` too, so they are left out of the count.
    const expanders = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.querySelectorAll('[data-index="0"] [aria-expanded]:not([aria-haspopup])')
        .length
    })
    assert.equal(expanders, 0)
  })

  const stackLayers = () =>
    menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[data-index="1"] [data-stack] li > button')].map(
        (node) => node.textContent?.trim() ?? '',
      )
    })

  it('loads the whole stack once its badge is focused', async () => {
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const badge = shadow.querySelector('[data-index="1"] [aria-label="Show the stack"]')
      ;(badge as HTMLElement).focus()
    })

    await menuPage.waitForFunction(() =>
      (window as unknown as { __sentMessages: Array<{ type: string }> }).__sentMessages.some(
        (message) => message.type === 'stacks',
      ),
    )
    const request = await menuPage.evaluate(() =>
      (window as unknown as { __sentMessages: Array<Record<string, unknown>> }).__sentMessages.find(
        (message) => message.type === 'stacks',
      ),
    )
    assert.deepEqual(
      (request!.rows as Array<{ id: string; stack: { id: string; position: number } }>).map(
        (row) => [row.id, row.stack.id, row.stack.position],
      ),
      [['item_1', 'STACK_4', 2]],
    )
  })

  it('expands to the rest of the stack, top layer first', async () => {
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
      return (
        Boolean(region) &&
        region!.getBoundingClientRect().height > 0 &&
        region!.querySelectorAll('li button').length === 3
      )
    })

    assert.match(await stackRow(), /Groundwork for the feature/)

    const layers = await stackLayers()

    assert.equal(layers.length, 3)
    assert.match(layers[0]!, /#103 The last layer/)
    assert.match(layers[2]!, /#101 Groundwork for the feature/)
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

  it('keeps the layers and offers a retry when the stack cannot be reloaded', async () => {
    const clickInRow = (selector: string) =>
      menuPage.evaluate((target) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        ;(shadow.querySelector(`[data-index="1"] ${target}`) as HTMLButtonElement).click()
      }, selector)
    const failure = () =>
      menuPage.evaluate(() => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        return Boolean(
          [...shadow.querySelectorAll('[data-index="1"] [data-stack] p')].find((node) =>
            node.textContent?.includes('Couldn’t load the stack.'),
          ),
        )
      })

    await menuPage.evaluate(() => {
      ;(window as unknown as { __failStacks: boolean }).__failStacks = true
    })
    await clickInRow('[data-stack] [aria-label="Hide the stack"]')
    await clickInRow('[aria-label="Show the stack"]')
    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return [...shadow.querySelectorAll('[data-index="1"] [data-stack] p')].some((node) =>
        node.textContent?.includes('Couldn’t load the stack.'),
      )
    })
    assert.equal((await stackLayers()).length, 3)

    await menuPage.evaluate(() => {
      ;(window as unknown as { __failStacks: boolean }).__failStacks = false
    })
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const retry = [...shadow.querySelectorAll('[data-index="1"] [data-stack] button')].find(
        (node) => node.textContent === 'Try again',
      ) as HTMLButtonElement
      retry.click()
    })
    await menuPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return ![...shadow.querySelectorAll('[data-index="1"] [data-stack] p')].some((node) =>
        node.textContent?.includes('Couldn’t load the stack.'),
      )
    })
    assert.equal(await failure(), false)
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

  it('lets an open submenu fall away once the pointer leaves it', async () => {
    await openMenuOn(0)

    // Open the Copy submenu the way the copy tests do.
    await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const trigger = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === 'Copy',
      )!
      ;(trigger as HTMLElement).click()
    })
    await menuPage.waitForFunction(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll(
          '[role="menu"]',
        ).length > 1,
    )

    // Slide a real pointer onto the submenu, then off it into empty space.
    const submenu = await menuPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const menu = [...shadow.querySelectorAll('[role="menu"]')].at(-1)!
      const box = menu.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await menuPage.mouse.move(submenu.x, submenu.y)
    await menuPage.mouse.move(5, 795)

    // Radix leaves it open over the empty page; we close it, and only it — the
    // parent menu stays put.
    await menuPage.waitForFunction(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll(
          '[role="menu"]',
        ).length === 1,
    )

    await menuPage.keyboard.press('Escape')
    await menuPage.waitForFunction(
      () =>
        !document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('[role="menu"]'),
    )
  })
})

describe('stacks folded into one row', { concurrency: false, skip }, () => {
  let server: Server
  let stackBrowser: Browser
  let stackPage: Page

  before(async () => {
    let origin: string
    ;({ server, origin } = await serveBlankPages())
    stackBrowser = await puppeteer.launch({ executablePath, headless: true })
    stackPage = await stackBrowser.newPage()
    await stackPage.setViewport({ width: 1280, height: 800 })
    // The tab is on layer 3 of stack 9, acme/app#7.
    await stackPage.goto(`${origin}/acme/app/pull/7`)
    await stackPage.evaluate(CHROME_STUB)
    // Layers 1 and 3 of stack 9 are on the first page and layer 2 on the
    // second; layer 4 is in no page at all.
    await stackPage.evaluate(() => {
      const scope = window as unknown as {
        __items: Array<Record<string, unknown>>
        __stacks: Array<Record<string, unknown>>
        __searchPages: Record<string, unknown>
        __layerReviews: Record<string, string>
      }
      scope.__layerReviews = { stack9_4: 'APPROVED' }
      const layer = (item: Record<string, unknown>, position: number, title: string) => ({
        ...item,
        kind: 'pull-request',
        state: 'open',
        title,
        stack: { id: 'STACK_9', number: 9, size: 4, baseRefName: 'main', position },
      })
      const first = scope.__items.slice(0, 12)
      first[2] = layer(first[2], 1, 'Groundwork layer')
      first[6] = layer(first[6], 3, 'Third layer')
      const second = scope.__items.slice(12, 20)
      second[3] = layer(second[3], 2, 'Second layer')
      scope.__searchPages = {
        '': { items: first, endCursor: 'PAGE_2', hasNextPage: true },
        PAGE_2: { items: second, endCursor: null, hasNextPage: false },
      }
      const entry = (item: Record<string, unknown>, position: number) => ({
        id: item.id,
        number: item.number,
        title: item.title,
        url: item.url,
        repository: 'acme/app',
        state: 'open',
        position,
      })
      scope.__stacks.push({
        id: 'STACK_9',
        number: 9,
        size: 4,
        baseRefName: 'main',
        fetchedAt: Date.now(),
        layers: [
          entry(first[2], 1),
          entry(second[3], 2),
          entry(first[6], 3),
          {
            id: 'stack9_4',
            number: 904,
            title: 'Fourth layer',
            url: 'https://github.com/acme/app/pull/904',
            repository: 'acme/app',
            state: 'open',
            position: 4,
          },
        ],
      })
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await stackPage.evaluate(bundle)
    await stackPage.waitForSelector('#github-sidecar-root')
    // The first page is short enough that the list asks for the second at once.
    await stackPage.waitForFunction(() =>
      document.getElementById('github-sidecar-root')?.shadowRoot?.querySelector('footer')?.textContent?.includes('20 of 400'),
    )
  })

  after(async () => {
    await stackBrowser?.close()
    await new Promise((resolve) => server.close(resolve))
  })

  const listText = () =>
    stackPage.evaluate(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-index]')].map(
        (row) => row.textContent ?? '',
      ),
    )

  const stackButton = () =>
    stackPage.evaluateHandle(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-stack-row] button') as HTMLButtonElement,
    )

  const nestedLayers = () =>
    stackPage.evaluate(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-stack-layer]')].map(
        (node) => ({
          position: Number(node.getAttribute('data-stack-layer')),
          full: Boolean(node.querySelector('[data-item-body]')),
          text: node.textContent ?? '',
        }),
      ),
    )

  it('shows one row for the stack, in the slot of its first layer, with a layer from a later page', async () => {
    const rows = await listText()

    assert.match(rows[2], /Groundwork layer/)
    assert.match(rows[2], /4 layers/)
    assert.equal(rows.filter((text) => /Second layer|Third layer/.test(text)).length, 0)
    // The footer still counts pull requests, folded or not.
    const footer = await stackPage.evaluate(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('footer')!.textContent,
    )
    assert.match(footer!, /20 of 400/)
  })

  /** Where focus is: a stack row, a layer by position, or something else. */
  const focused = () =>
    stackPage.evaluate(() => {
      const active = document.getElementById('github-sidecar-root')!.shadowRoot!.activeElement
      const layer = active?.closest('[data-stack-layer]')
      if (layer) return `layer ${layer.getAttribute('data-stack-layer')}`
      return active?.closest('[data-stack-row]') ? 'stack' : 'elsewhere'
    })

  it('marks the stack row while the page is one of its layers', async () => {
    await stackPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marker = shadow.querySelector('[data-current-marker]')
      return (
        Boolean(shadow.querySelector('[data-index="2"] [data-stack-row][data-current]')) &&
        marker !== null &&
        getComputedStyle(marker).visibility === 'visible'
      )
    })

    const marked = await stackPage.evaluate(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-current]')].length,
    )
    assert.equal(marked, 1)
  })

  it('expands top layer first, with full rows for loaded layers and a compact row for the rest', async () => {
    const button = await stackButton()
    await button.click()
    await stackPage.waitForFunction(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-stack-layer]').length === 4,
    )

    assert.equal(await button.evaluate((node) => node.getAttribute('aria-expanded')), 'true')
    const layers = await nestedLayers()
    assert.deepEqual(
      layers.map((layer) => [layer.position, layer.full]),
      [
        [4, false],
        [3, true],
        [2, true],
        [1, true],
      ],
    )
    assert.match(layers[0].text, /#904 Fourth layer/)

    // Only the layer that is not a loaded row has its review read.
    await stackPage.waitForFunction(() =>
      document
        .getElementById('github-sidecar-root')!
        .shadowRoot!.querySelector('[data-stack-layer="4"]')
        ?.textContent?.includes('Approved'),
    )
    const reviewRequest = await stackPage.evaluate(() =>
      (window as unknown as { __sentMessages: Array<Record<string, unknown>> }).__sentMessages.findLast(
        (message) => message.type === 'layer-reviews',
      ),
    )
    assert.deepEqual(reviewRequest!.ids, ['stack9_4'])

    // Open, the stack is no longer the page: its layer 3 is.
    await stackPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-stack-layer="3"] [data-current]'),
      ),
    )
    assert.equal(
      await stackPage.evaluate(() =>
        Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-stack-row][data-current]')),
      ),
      false,
    )

    const request = await stackPage.evaluate(() =>
      (window as unknown as { __sentMessages: Array<Record<string, unknown>> }).__sentMessages.findLast(
        (message) => message.type === 'stacks',
      ),
    )
    assert.deepEqual(
      (request!.rows as Array<{ stack: { id: string; position: number } }>)
        .filter((row) => row.stack.id === 'STACK_9')
        .map((row) => row.stack.position)
        .toSorted(),
      [1, 2, 3],
    )
  })

  it('collapses again with Enter on the stack row', async () => {
    const button = await stackButton()
    await button.focus()
    await stackPage.keyboard.press('Enter')
    await stackPage.waitForFunction(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-stack-layer]').length === 0,
    )

    assert.equal(await button.evaluate((node) => node.getAttribute('aria-expanded')), 'false')
  })

  it('opens with ArrowRight, steps in and back out, and closes with ArrowLeft', async () => {
    const button = await stackButton()
    await button.focus()
    const layerCount = () =>
      stackPage.evaluate(
        () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-stack-layer]').length,
      )

    await stackPage.keyboard.press('ArrowRight')
    await stackPage.waitForFunction(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-stack-layer]').length === 4,
    )
    assert.equal(await focused(), 'stack')

    await stackPage.keyboard.press('ArrowRight')
    assert.equal(await focused(), 'layer 4')

    await stackPage.keyboard.press('j')
    assert.equal(await focused(), 'layer 3')

    await stackPage.keyboard.press('ArrowLeft')
    assert.equal(await focused(), 'stack')

    await stackPage.keyboard.press('ArrowLeft')
    await stackPage.waitForFunction(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-stack-layer]').length === 0,
    )
    assert.equal(await layerCount(), 0)
    assert.equal(await button.evaluate((node) => node.getAttribute('aria-expanded')), 'false')
  })

  it('asks again when the stack it gets back disagrees with the rows', async () => {
    const stacksSent = () =>
      stackPage.evaluate(
        () =>
          (window as unknown as { __sentMessages: Array<{ type: string }> }).__sentMessages.filter(
            (message) => message.type === 'stacks',
          ).length,
      )
    const setSize = (size: number) =>
      stackPage.evaluate((value) => {
        const scope = window as unknown as { __stacks: Array<{ id: string; size: number }> }
        scope.__stacks.find((stack) => stack.id === 'STACK_9')!.size = value
      }, size)

    await setSize(5)
    const sentBefore = await stacksSent()
    await (await stackButton()).evaluate((node) => {
      node.blur()
      node.focus()
    })
    await stackPage.waitForFunction(
      (count) =>
        (window as unknown as { __sentMessages: Array<{ type: string }> }).__sentMessages.filter(
          (message) => message.type === 'stacks',
        ).length >= count,
      {},
      sentBefore + 2,
    )
    await setSize(4)
  })

  it('copies every layer of the stack from its menu, base first', async () => {
    await stackPage.evaluate(() => {
      const scope = window as unknown as { __copied: string[]; ClipboardItem: unknown }
      scope.__copied = []
      // A test page is not a secure context, so it has no clipboard API of its own.
      scope.ClipboardItem = class {
        readonly flavours: Record<string, Blob>
        constructor(flavours: Record<string, Blob>) {
          this.flavours = flavours
        }
        async getType(type: string) {
          return this.flavours[type]
        }
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          write: async (items: ClipboardItem[]) => {
            scope.__copied.push(await (await items[0].getType('text/plain')).text())
          },
        },
      })
    })
    const box = await (await stackButton()).boundingBox()
    await stackPage.mouse.click(box!.x + 40, box!.y + 20, { button: 'right' })

    const clickItem = async (label: string) => {
      await stackPage.waitForFunction(
        (text: string) =>
          [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]')].some(
            (node) => node.textContent?.trim() === text,
          ),
        {},
        label,
      )
      await stackPage.evaluate((text) => {
        const entry = [
          ...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[role="menuitem"]'),
        ].find((node) => node.textContent?.trim() === text)
        ;(entry as HTMLElement).click()
      }, label)
    }
    await clickItem('Copy')
    await clickItem('Stack links')
    await stackPage.waitForFunction(() => (window as unknown as { __copied: string[] }).__copied.length > 0)

    const copied = await stackPage.evaluate(() => (window as unknown as { __copied: string[] }).__copied[0])
    assert.equal(copied.split('\n').length, 4)
    assert.match(copied.split('\n')[3], /pull\/904$/)
  })
})

describe('quick actions on a row', { concurrency: false, skip }, () => {
  let quickBrowser: Browser
  let quickPage: Page

  before(async () => {
    quickBrowser = await puppeteer.launch({ executablePath, headless: true })
    quickPage = await quickBrowser.newPage()
    await quickPage.setViewport({ width: 1280, height: 900 })
    await quickPage.setContent('<!doctype html><html data-color-mode="light"><body></body></html>')
    await quickPage.evaluate(CHROME_STUB)

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await quickPage.evaluate(bundle)
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await quickBrowser?.close()
  })

  /** The quick actions on one row: their names, and how visible the group is. */
  const actionsOn = (index: number) =>
    quickPage.evaluate((rowIndex) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const group = shadow.querySelector(
        `[data-index="${rowIndex}"] [data-quick-actions]`,
      ) as HTMLElement | null
      return {
        labels: group
          ? [...group.querySelectorAll('button')].map((node) => node.getAttribute('aria-label'))
          : [],
        opacity: group ? getComputedStyle(group).opacity : null,
      }
    }, index)

  const waitForActionsShown = (index: number) =>
    quickPage.waitForFunction((rowIndex) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const group = shadow.querySelector(`[data-index="${rowIndex}"] [data-quick-actions]`)
      return Boolean(group) && getComputedStyle(group!).opacity === '1'
    }, {}, index)

  const hoverRow = async (index: number) => {
    const point = await quickPage.evaluate((rowIndex) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = shadow.querySelector(`[data-index="${rowIndex}"] button`)!.getBoundingClientRect()
      return { x: box.x + 40, y: box.y + 12 }
    }, index)
    await quickPage.mouse.move(point.x, point.y, { steps: 4 })
  }

  const clickAction = (index: number, label: string) =>
    quickPage.evaluate(
      ({ rowIndex, name }) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const button = shadow.querySelector(
          `[data-index="${rowIndex}"] [data-quick-actions] [aria-label="${name}"]`,
        ) as HTMLElement
        button.click()
      },
      { rowIndex: index, name: label },
    )

  const pinnedIds = async () =>
    (await quickPage.evaluate(() => chrome.storage.local.get('pinnedIds'))).pinnedIds as string[]

  const focusedLabel = () =>
    quickPage.evaluate(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.activeElement?.getAttribute(
          'aria-label',
        ) ?? null,
    )

  /** Waits for a menu entry by its exact text, then picks it. */
  const pickMenuItem = async (label: string) => {
    await quickPage.waitForFunction(
      (text: string) =>
        [
          ...document
            .getElementById('github-sidecar-root')!
            .shadowRoot!.querySelectorAll('[role="menuitem"]'),
        ].some((node) => node.textContent?.trim() === text),
      {},
      label,
    )
    await quickPage.evaluate((text) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === text,
      )
      ;(entry as HTMLElement).click()
    }, label)
  }

  it('stays out of sight until the row is hovered, and moves nothing when it shows', async () => {
    /** Every box in the row apart from the quick actions themselves. */
    const layout = () =>
      quickPage.evaluate(() => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const row = shadow.querySelector('[data-index="1"]')!
        const boxes = [row, ...row.querySelectorAll('*')]
          .filter((node) => !node.closest('[data-quick-actions]'))
          .map((node) => {
            const box = node.getBoundingClientRect()
            return [box.x, box.y, box.width, box.height].join(',')
          })
        return boxes
      })

    // Not built at all until the row is first hovered or focused.
    assert.equal((await actionsOn(1)).opacity, null)
    const atRest = await layout()

    await hoverRow(1)
    await waitForActionsShown(1)
    assert.deepEqual(await layout(), atRest)

    // Laid over the row's own corner, not hanging outside it.
    const inside = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const body = shadow.querySelector('[data-index="1"] [data-item-body]')!.getBoundingClientRect()
      const group = shadow
        .querySelector('[data-index="1"] [data-quick-actions]')!
        .getBoundingClientRect()
      return (
        group.left >= body.left &&
        group.right <= body.right &&
        group.top >= body.top &&
        group.bottom <= body.bottom
      )
    })
    assert.equal(inside, true)

    // Once built, it hides again as the pointer leaves.
    await quickPage.mouse.move(0, 0, { steps: 4 })
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const group = shadow.querySelector('[data-index="1"] [data-quick-actions]')
      return Boolean(group) && getComputedStyle(group!).opacity === '0'
    })
  })

  it('is reached from the keyboard right after the row, and pins it as the menu does', async () => {
    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('.scrollbar-slim') as HTMLElement).focus()
    })
    await quickPage.keyboard.press('j')
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return shadow.activeElement === shadow.querySelector('[data-index="0"] button')
    })

    // A row that holds keyboard focus shows its actions without a pointer.
    await waitForActionsShown(0)

    await quickPage.keyboard.press('Tab')
    assert.equal(await focusedLabel(), 'Pin item')

    await quickPage.keyboard.press('Enter')
    await quickPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="0"][data-pinned], [data-index="0"] [data-pinned]'),
      ),
    )
    assert.deepEqual(await pinnedIds(), ['item_0'])
    assert.deepEqual((await actionsOn(0)).labels, ['Unpin item', 'Remind me', 'Copy link'])

    await clickAction(0, 'Unpin item')
    await quickPage.waitForFunction(
      () =>
        !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-pinned]'),
    )
    assert.deepEqual(await pinnedIds(), [])
  })

  it('copies the same link the menu copies, and says it did', async () => {
    await quickPage.evaluate(() => {
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
    const copies = () =>
      quickPage.evaluate(
        () => (window as unknown as { __copied: Array<Record<string, string>> }).__copied,
      )

    await clickAction(1, 'Copy link')
    await quickPage.waitForFunction(
      () => (window as unknown as { __copied: unknown[] }).__copied.length === 1,
    )
    assert.ok((await actionsOn(1)).labels.includes('Copied'))

    // The same row, copied through the context menu instead.
    const point = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = shadow.querySelector('[data-index="1"] button')!.getBoundingClientRect()
      return { x: box.x + 40, y: box.y + 20 }
    })
    await quickPage.mouse.click(point.x, point.y, { button: 'right' })
    await pickMenuItem('Copy')
    await pickMenuItem('Link')
    await quickPage.waitForFunction(
      () => (window as unknown as { __copied: unknown[] }).__copied.length === 2,
    )

    const [quick, menu] = await copies()
    assert.equal(quick['text/plain'], 'https://github.com/acme/app/pull/2')
    assert.deepEqual(quick, menu)
  })

  it('marks a changed row as seen, as the menu does', async () => {
    // Pushed as a poll would push it, then left in the seed so a refetch agrees.
    await quickPage.evaluate(() => {
      const scope = window as unknown as {
        __items: Array<Record<string, unknown>>
        __broadcast: (message: unknown) => void
      }
      const item = { ...scope.__items[0], commentCount: 25 }
      scope.__broadcast({ type: 'item-updated', item })
      scope.__items[0] = item
    })
    await quickPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="0"] [data-change]'),
      ),
    )
    assert.deepEqual((await actionsOn(0)).labels, [
      'Mark as seen',
      'Pin item',
      'Remind me',
      'Copy link',
    ])

    // From the keyboard: the row, then the first of its actions.
    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[data-index="0"] button') as HTMLElement).focus()
    })
    await quickPage.keyboard.press('Tab')
    assert.equal(await focusedLabel(), 'Mark as seen')
    await quickPage.keyboard.press('Enter')

    await quickPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="0"] [data-change]'),
    )
    assert.deepEqual((await actionsOn(0)).labels, ['Pin item', 'Remind me', 'Copy link'])
    // The button it was on is gone, so focus moves along rather than off the panel.
    assert.equal(await focusedLabel(), 'Pin item')
  })

  it('keeps keys pressed in its reminder menu inside the menu', async () => {
    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[data-index="3"] button') as HTMLElement).focus()
    })
    await quickPage.keyboard.press('Tab')
    await quickPage.keyboard.press('Tab')
    assert.equal(await focusedLabel(), 'Remind me')

    await quickPage.keyboard.press('Enter')
    await quickPage.waitForFunction(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.activeElement?.getAttribute('role') === 'menuitem',
    )

    // The list's own keys: neither moves to a row nor pins one from inside the menu.
    await quickPage.keyboard.press('ArrowDown')
    await quickPage.keyboard.press('p')
    const state = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return {
        role: shadow.activeElement?.getAttribute('role') ?? null,
        menus: shadow.querySelectorAll('[role="menu"]').length,
      }
    })
    assert.deepEqual(state, { role: 'menuitem', menus: 1 })
    assert.deepEqual(await pinnedIds(), [])

    await quickPage.keyboard.press('Escape')
    await quickPage.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[role="menu"]'),
    )
    // Radix hands focus back to the trigger once the menu has unmounted.
    await quickPage.waitForFunction(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.activeElement?.getAttribute('aria-label') === 'Remind me',
    )
  })

  it('sets a reminder from its own menu, as the context menu does', async () => {
    await hoverRow(2)
    await waitForActionsShown(2)

    // A Radix trigger opens only on a real pointer, so click it where it is.
    const trigger = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = shadow
        .querySelector('[data-index="2"] [data-quick-actions] [aria-label="Remind me"]')!
        .getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await quickPage.mouse.click(trigger.x, trigger.y)
    await quickPage.waitForFunction(() =>
      [
        ...document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll('[role="menuitem"]'),
      ].some((node) => node.textContent?.trim() === 'When it changes'),
    )

    // Off the row and onto the menu: the actions stay up behind it.
    const entry = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const node = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (candidate) => candidate.textContent?.trim() === 'When it changes',
      )!
      const box = node.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await quickPage.mouse.move(entry.x, entry.y, { steps: 6 })
    const hovered = await quickPage.evaluate(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-index="2"]')!.matches(':hover'),
    )
    assert.equal(hovered, false)
    assert.equal((await actionsOn(2)).opacity, '1')

    await pickMenuItem('When it changes')

    await quickPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-index="2"] [data-reminder="waiting"]'),
      ),
    )
    const reminder = await quickPage.evaluate(
      async () =>
        (await chrome.storage.local.get('itemMemory')).itemMemory?.item_2?.reminder ?? null,
    )
    assert.equal(reminder?.dueAt, null)
    assert.deepEqual((await actionsOn(2)).labels, ['Pin item', 'Remind me instead', 'Copy link'])

    await quickPage.mouse.move(0, 0, { steps: 4 })
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

  const launcher = async () => {
    await settleMorph(quietPage)
    return quietPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[aria-label="Open GitHub Sidecar"]'))
    })
  }

  it('starts closed, showing only the launcher on the left edge', async () => {
    await quietPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))

    assert.equal(await launcher(), true)
    const layout = await quietPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      await Promise.allSettled(shadow.getAnimations().map((animation) => animation.finished))
      const box = shadow.querySelector('[data-launcher-capsule]')!.getBoundingClientRect()
      return {
        panel: Boolean(shadow.querySelector('[role="complementary"]')),
        left: box.left,
        middle: box.top + box.height / 2,
        // The tab draws no name, so the query is only in what screen readers announce.
        description: shadow.getElementById(
          shadow.querySelector('[aria-label="Open GitHub Sidecar"]')!.getAttribute('aria-describedby')!,
        )?.textContent,
        chip: Boolean(shadow.querySelector('[data-launcher-chip]')),
      }
    })
    assert.equal(layout.panel, false)
    assert.equal(layout.left, 0)
    assert.equal(Math.round(layout.middle), 400)
    assert.equal(layout.description, 'Needs my review')
    // Nothing has loaded in a closed tab, so there is no count to show yet.
    assert.equal(layout.chip, false)
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

describe('a github.com tab that was never asked', { concurrency: false, skip }, () => {
  let closedBrowser: Browser
  let closedPage: Page

  before(async () => {
    closedBrowser = await puppeteer.launch({ executablePath, headless: true })
    closedPage = await closedBrowser.newPage()
    await closedPage.setViewport({ width: 1280, height: 800 })
    await closedPage.setContent(GITHUB_PAGE)
    await closedPage.evaluate(CHROME_STUB)
    await closedPage.evaluate(() => {
      ;(window as unknown as { __tabOpen: boolean }).__tabOpen = false
    })

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await closedPage.evaluate(bundle)
    await closedPage.waitForSelector('#github-sidecar-root')
    await closedPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  })

  after(async () => {
    await closedBrowser?.close()
  })

  const pill = async () => {
    await settleMorph(closedPage)
    return closedPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      await Promise.allSettled(shadow.getAnimations().map((animation) => animation.finished))
      return Boolean(shadow.querySelector('[data-launcher]'))
    })
  }

  const clickLauncher = async () => {
    await closedPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(
        shadow.querySelector('[aria-label="Open GitHub Sidecar"]') as HTMLButtonElement
      ).click()
    })
    await closedPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  }

  const panelShowing = async () => {
    await settleMorph(closedPage)
    return closedPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return Boolean(shadow.querySelector('[data-docked]'))
    })
  }

  it('leaves the page where it is until the panel opens', async () => {
    assert.equal(await pill(), true)
    assert.equal(await panelShowing(), false)
    const layout = await closedPage.evaluate(() => ({
      bodyPadding: parseFloat(getComputedStyle(document.body).paddingLeft),
      reserved: Boolean(document.body.style.getPropertyValue('padding-left')),
    }))
    assert.deepEqual(layout, { bodyPadding: 0, reserved: false })
  })

  /**
   * Clicks a control, or the toolbar button, then follows the element taking
   * over frame by frame until the morph ends and the element it replaced is gone.
   */
  const morphOn = (label: string | 'toolbar', from: string, to: string) =>
    closedPage.evaluate(
      async (control, fromSelector, toSelector) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect()
          return [rect.left, rect.top, rect.width, rect.height].map(Math.round)
        }
        const present = (selector: string) =>
          [...shadow.querySelectorAll<HTMLElement>(selector)].find((element) => !element.inert)

        const start = box(shadow.querySelector(fromSelector)!)
        if (control === 'toolbar') {
          ;(window as unknown as { __broadcast: (m: unknown) => void }).__broadcast({
            type: 'toggle-sidebar',
          })
        } else {
          ;(shadow.querySelector(`[aria-label="${control}"]`) as HTMLElement).click()
        }

        const seen = {
          first: null as number[] | null,
          last: null as number[] | null,
          oldStayed: false,
          frames: 0,
        }
        const follow = (): Promise<void> =>
          new Promise((resolve) => requestAnimationFrame(resolve)).then(() => {
            seen.frames += 1
            if (shadow.querySelector<HTMLElement>(fromSelector)?.inert) seen.oldStayed = true
            const target = present(toSelector)
            if (target && getComputedStyle(target).transform !== 'none') {
              seen.first ??= box(target)
              seen.last = box(target)
            }
            const done =
              target && !target.hasAttribute('data-morphing') && !shadow.querySelector(fromSelector)
            return done || seen.frames >= 120 ? undefined : follow()
          })
        await follow()

        const target = present(toSelector)!
        return { ...seen, start, end: box(target), opacity: getComputedStyle(target).opacity }
      },
      label,
      from,
      to,
    )

  /** Whether every edge of a box is within `slack` pixels of another box. */
  const near = (actual: number[] | null, expected: number[], slack: number) =>
    actual !== null && actual.every((value, index) => Math.abs(value - expected[index]) <= slack)

  /**
   * Whether the first frame drawn is still close to where the morph starts.
   * Motion skips up to 40ms of an animation whose first frame is late, and
   * opening renders the whole panel before that frame.
   */
  const startsOn = ({ first, start, end }: { first: number[] | null; start: number[]; end: number[] }) =>
    first !== null &&
    first.every((value, index) => Math.abs(value - start[index]) <= 0.15 * Math.abs(end[index] - start[index]) + 1)

  it('opens from the launcher alone, growing the pill into the panel', async () => {
    const morph = await morphOn(
      'Open GitHub Sidecar',
      '[data-launcher-capsule]',
      '[role="complementary"]',
    )

    assert.ok(startsOn(morph), `expected it to start on the pill at ${morph.start}, saw ${morph.first}`)
    assert.ok(morph.oldStayed, 'expected the pill to stay, inert, while it fades')
    // A tab that was never opened has not measured the page yet, so a stale
    // dock position would show as a jump on the last frame.
    assert.ok(near(morph.last, morph.end, 3), `expected it to land on ${morph.end}, saw ${morph.last}`)
    assert.equal(morph.opacity, '1')

    assert.equal(await panelShowing(), true)
    const opened = await closedPage.evaluate(() =>
      (
        window as unknown as { __sentMessages: Array<{ type?: string; open?: boolean }> }
      ).__sentMessages.filter((message) => message.type === 'set-tab-open'),
    )
    assert.deepEqual(opened, [{ type: 'set-tab-open', open: true }])
  })

  /** The message the worker sends when the toolbar icon is clicked in this tab. */
  const clickToolbar = async () => {
    await closedPage.evaluate(() => {
      ;(window as unknown as { __broadcast: (m: unknown) => void }).__broadcast({
        type: 'toggle-sidebar',
      })
    })
    await closedPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
  }

  it('comes back from collapsed with one toolbar click, and hides with the next', async () => {
    await closedPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Collapse"]') as HTMLButtonElement).click()
    })
    await closedPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 200)))
    assert.ok(await pill(), 'expected collapsing to leave the launcher')

    // Collapsed is shared across tabs and open is per tab, so opening has to
    // clear both or the toolbar would only redraw the launcher.
    await clickToolbar()
    assert.equal(await panelShowing(), true)

    await clickToolbar()
    assert.equal(await panelShowing(), false)
    assert.ok(await pill(), 'expected hiding to leave the launcher')

    await clickLauncher()
    assert.equal(await panelShowing(), true)
  })

  it('shrinks the panel back into the pill when hidden', async () => {
    const morph = await morphOn('Hide sidebar', '[role="complementary"]', '[data-launcher-capsule]')

    assert.ok(startsOn(morph), `expected it to start on the panel at ${morph.start}, saw ${morph.first}`)
    assert.ok(morph.oldStayed, 'expected the panel to stay, inert, while it fades')
    assert.ok(near(morph.last, morph.end, 3), `expected it to land on ${morph.end}, saw ${morph.last}`)
    assert.equal(morph.opacity, '1')
  })

  /** How opaque the launcher count looks, through every element above it. */
  const chipOpacity = () =>
    closedPage.evaluate(() => {
      let opacity = 1
      let node = document
        .getElementById('github-sidecar-root')!
        .shadowRoot!.querySelector('[data-launcher-chip]')
      while (node instanceof Element) {
        opacity *= parseFloat(getComputedStyle(node).opacity)
        node = node.parentElement
      }
      return opacity
    })

  it('shows the whole pill again when the panel is hidden mid-morph', async () => {
    await closedPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const start = performance.now()
      const until = (ms: number): Promise<void> =>
        performance.now() - start >= ms
          ? Promise.resolve()
          : new Promise((resolve) => requestAnimationFrame(() => resolve(until(ms))))
      ;(shadow.querySelector('[aria-label="Open GitHub Sidecar"]') as HTMLElement).click()
      // Past the fade of the pill contents, before the pill has gone.
      await until(250)
      ;(shadow.querySelector('[aria-label="Hide sidebar"]') as HTMLElement).click()
    })
    await settleMorph(closedPage)

    assert.equal(await panelShowing(), false)
    assert.equal(await chipOpacity(), 1)
  })

  it('keeps the panel fading out through a refresh that lands mid-morph', async () => {
    await clickLauncher()
    await settleMorph(closedPage)

    const midway = await closedPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const start = performance.now()
      const until = (ms: number): Promise<void> =>
        performance.now() - start >= ms
          ? Promise.resolve()
          : new Promise((resolve) => requestAnimationFrame(() => resolve(until(ms))))
      ;(shadow.querySelector('[aria-label="Hide sidebar"]') as HTMLElement).click()
      await until(50)
      ;(window as unknown as { __broadcast: (m: unknown) => void }).__broadcast({
        type: 'search-updated',
        query: 'is:open is:pr',
        after: null,
        page: {
          items: (window as unknown as { __items: unknown[] }).__items,
          totalCount: 12,
          endCursor: null,
          hasNextPage: false,
          fetchedAt: Date.now(),
        },
      })
      // Past the fade of the panel contents, before the panel has gone.
      await until(250)
      return {
        chip: shadow.querySelector('[data-launcher-chip]')?.textContent,
        panel: Boolean(shadow.querySelector('[data-docked]')),
      }
    })

    assert.equal(midway.chip, '12', 'expected the refresh to re-render the launcher')
    assert.equal(midway.panel, true, 'expected the panel to stay until it has faded')
    assert.equal(await panelShowing(), false)
  })

  it('shows the edge of the pill again when the window is resized mid-morph', async () => {
    await clickLauncher()
    await settleMorph(closedPage)
    await closedPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Hide sidebar"]') as HTMLElement).click()
    })
    await closedPage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))

    // Motion finishes the morph early when the width changes.
    await closedPage.setViewport({ width: 1240, height: 800 })
    try {
      await closedPage.waitForFunction(
        () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-morphing]'),
        { timeout: 2000 },
      )
    } finally {
      await closedPage.setViewport({ width: 1280, height: 800 })
    }
    assert.equal(await panelShowing(), false)
  })

  it('closes an open menu as soon as the panel starts to go', async () => {
    await clickLauncher()
    await settleMorph(closedPage)
    const trigger = await closedPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = shadow.querySelector('[data-docked] [aria-haspopup="menu"]')!.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await closedPage.mouse.click(trigger.x, trigger.y)
    await closedPage.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[role="menu"]')),
    )

    await closedPage.evaluate(() => {
      ;(window as unknown as { __broadcast: (m: unknown) => void }).__broadcast({
        type: 'toggle-sidebar',
      })
    })
    await closedPage.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-docked][inert]')),
    )
    const menu = await closedPage.evaluate(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[role="menu"]')),
    )

    assert.equal(menu, false)
    assert.equal(await panelShowing(), false)
  })

  /**
   * Sets the motion preference, then waits for it to reach Motion, which reads
   * it from a media query listener that hears about it a frame or so later.
   */
  const preferReducedMotion = async (reduce: boolean) => {
    const changed = closedPage.evaluate(
      () =>
        new Promise((resolve) => {
          matchMedia('(prefers-reduced-motion)').addEventListener('change', resolve, { once: true })
        }),
    )
    await closedPage.emulateMediaFeatures(
      reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [],
    )
    await changed
  }

  it('skips the morph for anyone who asks for reduced motion', async () => {
    await preferReducedMotion(true)
    try {
      const morph = await morphOn(
        'Open GitHub Sidecar',
        '[data-launcher-capsule]',
        '[role="complementary"]',
      )
      assert.equal(morph.first, null, 'expected the panel never to be scaled')
      assert.equal(morph.opacity, '1')
      assert.equal(
        await closedPage.evaluate(() => document.body.style.getPropertyValue('transition')),
        '',
        'expected the page to move at once',
      )
    } finally {
      await preferReducedMotion(false)
    }
  })

  it('lands below the nav when the toolbar opens it on a scrolled page', async () => {
    await clickToolbar()
    assert.equal(await panelShowing(), false)
    await closedPage.evaluate(() => window.scrollTo(0, 30))

    // The page has scrolled since the panel last measured it.
    const morph = await morphOn('toolbar', '[data-launcher-capsule]', '[role="complementary"]')
    const navBottom = await closedPage.evaluate(
      () => document.querySelector('.js-header-wrapper')!.getBoundingClientRect().bottom,
    )

    assert.equal(morph.end[1], navBottom + DOCK_INSET)
    assert.ok(near(morph.last, morph.end, 3), `expected it to land on ${morph.end}, saw ${morph.last}`)
  })

  /**
   * Clicks a control, then reads how far across the page is drawn, and where
   * the header starts, on each frame until the panel and the page settle.
   */
  const pageMoveOn = (label: string) =>
    closedPage.evaluate(async (control) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const header = document.querySelector('.AppHeader')!
      const insets: number[] = []
      const headerLefts: number[] = []
      ;(shadow.querySelector(`[aria-label="${control}"]`) as HTMLElement).click()
      const follow = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(resolve)).then(() => {
          insets.push(Math.round(parseFloat(getComputedStyle(document.body).paddingLeft)))
          headerLefts.push(Math.round(header.getBoundingClientRect().left))
          const settled =
            !shadow.querySelector('[data-morphing]') &&
            !document.body.hasAttribute('data-github-sidecar-moving')
          return settled || insets.length >= 120 ? undefined : follow()
        })
      await follow()
      return { insets, headerLefts, inline: document.body.style.cssText }
    }, label)

  /** Opens or hides the panel, then waits for it and the page to settle. */
  const showPanel = async (open: boolean) => {
    if ((await panelShowing()) !== open) {
      await closedPage.evaluate((label) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        ;(shadow.querySelector(`[aria-label="${label}"]`) as HTMLElement).click()
      }, open ? 'Open GitHub Sidecar' : 'Hide sidebar')
    }
    await settleMorph(closedPage)
  }

  it('moves the page back with the panel, and puts its own body styles back', async () => {
    await closedPage.evaluate(() => window.scrollTo(0, 0))
    await showPanel(true)
    const open = await closedPage.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.body).paddingLeft)),
    )
    assert.ok(open > 0, 'expected the open panel to need the page moved')

    const move = await pageMoveOn('Hide sidebar')

    assert.ok(
      move.insets.some((inset) => inset > 0 && inset < open),
      `expected the page to pass through the space between, saw ${move.insets}`,
    )
    assert.equal(move.insets.at(-1), 0)
    assert.ok(move.headerLefts.every((left) => left === 0), `expected the header to hold still, saw ${move.headerLefts}`)
    // The fixture body carries its own inline margin, which must survive.
    assert.equal(move.inline, 'margin: 0px;')
  })

  it('moves the page from where it is drawn when reopened partway through closing', async () => {
    await showPanel(true)

    const insets = await closedPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const inset = () => Math.round(parseFloat(getComputedStyle(document.body).paddingLeft))
      const start = performance.now()
      const until = (ms: number): Promise<void> =>
        performance.now() - start >= ms
          ? Promise.resolve()
          : new Promise((resolve) => requestAnimationFrame(() => resolve(until(ms))))
      ;(shadow.querySelector('[aria-label="Hide sidebar"]') as HTMLElement).click()
      await until(150)
      const closing = inset()
      ;(shadow.querySelector('[aria-label="Open GitHub Sidecar"]') as HTMLElement).click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return { closing, reopened: inset() }
    })

    assert.ok(insets.closing > 0, 'expected the page partway back')
    // One frame of the spring moves the page far less than this.
    assert.ok(
      insets.reopened >= insets.closing - 2 && insets.reopened <= insets.closing + 40,
      `expected the page to carry on from ${insets.closing}, saw ${insets.reopened}`,
    )
    await settleMorph(closedPage)
  })

  it('lands the page at once when a navigation interrupts the move back', async () => {
    await showPanel(true)

    const landed = await closedPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Hide sidebar"]') as HTMLElement).click()
      await new Promise((resolve) => setTimeout(resolve, 100))
      // Turbo swaps in a fresh header, which the move back has not tagged.
      const fresh = document.createElement('header')
      fresh.className = 'AppHeader'
      fresh.style.cssText = 'position:sticky;top:0;height:64px;background:#1f2328'
      document.querySelector('.AppHeader')!.replaceWith(fresh)
      document.dispatchEvent(new Event('turbo:load'))
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return {
        inset: parseFloat(getComputedStyle(document.body).paddingLeft),
        headerLeft: fresh.getBoundingClientRect().left,
        moving: document.body.hasAttribute('data-github-sidecar-moving'),
      }
    })

    assert.deepEqual(landed, { inset: 0, headerLeft: 0, moving: false })
    await settleMorph(closedPage)
  })

  it('moves the page back to the padding it had, with the header held still', async () => {
    await showPanel(false)
    await closedPage.evaluate(() => document.body.style.setProperty('padding-left', '24px'))
    try {
      await showPanel(true)
      const move = await pageMoveOn('Hide sidebar')

      assert.ok(Math.min(...move.insets) >= 23, `expected the page never to pass its padding, saw ${move.insets}`)
      assert.equal(move.insets.at(-1), 24)
      assert.ok(
        move.headerLefts.every((left) => left === move.headerLefts[0]),
        `expected the header to hold still, saw ${move.headerLefts}`,
      )
    } finally {
      await closedPage.evaluate(() => document.body.style.removeProperty('padding-left'))
    }
  })

  it('grows without its rows, then fades them in once it has landed', async () => {
    await showPanel(false)

    const seen = await closedPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Open GitHub Sidecar"]') as HTMLElement).click()
      const start = performance.now()
      const result = {
        rowsEarly: 0,
        heightWithRows: null as number | null,
        height: 0,
      }
      const follow = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(resolve)).then(() => {
          const elapsed = performance.now() - start
          const rows = shadow.querySelectorAll('[data-index]').length
          const panel = shadow.querySelector<HTMLElement>('[data-docked]:not([inert])')
          if (elapsed < 200) result.rowsEarly = Math.max(result.rowsEarly, rows)
          if (rows > 0 && panel) result.heightWithRows ??= panel.getBoundingClientRect().height
          const done = panel && !panel.hasAttribute('data-morphing') && rows > 0
          if (done) result.height = panel.offsetHeight
          return done || elapsed > 2000 ? undefined : follow()
        })
      await follow()
      return {
        ...result,
        fades: Boolean(shadow.querySelector('[data-docked] .animate-list-in [data-index]')),
      }
    })

    assert.equal(seen.rowsEarly, 0, 'expected no rows while the panel is still small')
    // The panel is still when they arrive, rather than growing a little more after.
    assert.ok(
      seen.heightWithRows !== null && Math.abs(seen.heightWithRows - seen.height) <= 1,
      `expected the rows on a panel already ${seen.height}px tall, saw ${seen.heightWithRows}`,
    )
    assert.equal(seen.fades, true)
    await settleMorph(closedPage)
  })

  it('keeps an inline style github.com writes while the panel is open', async () => {
    await showPanel(true)
    await closedPage.evaluate(() => document.body.style.setProperty('padding-left', '33px'))
    try {
      await showPanel(false)
      assert.equal(
        await closedPage.evaluate(() => document.body.style.getPropertyValue('padding-left')),
        '33px',
      )
    } finally {
      await closedPage.evaluate(() => document.body.style.removeProperty('padding-left'))
    }
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

  it('follows the panel edge as the panel is resized', async () => {
    const start = (await markerGeometry())!

    // Low on the edge, clear of the marker that sits over it level with the row.
    const handle = await onPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const edge = shadow.querySelector('[role="complementary"] > .cursor-ew-resize') as HTMLElement
      const box = edge.getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.bottom - 20 }
    })

    await onPage.mouse.move(handle.x, handle.y)
    await onPage.mouse.down()
    await onPage.mouse.move(handle.x + 60, handle.y, { steps: 8 })
    await onPage.mouse.up()

    await onPage.waitForFunction(
      (left: number) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const marker = shadow.querySelector('[data-current-marker]') as HTMLElement
        return Math.abs(marker.getBoundingClientRect().left - (left + 60)) < 2
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

  it('hides while the panel morphs, and points at the row again once it lands', async () => {
    await onPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Collapse"]') as HTMLElement).click()
    })
    await onPage.waitForFunction(() =>
      Boolean(document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-docked][inert]')),
    )
    const whileLeaving = await onPage.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const marker = shadow.querySelector('[data-current-marker]')
      return {
        panel: Boolean(shadow.querySelector('[data-docked]')),
        marker: marker ? getComputedStyle(marker).visibility : null,
      }
    })
    assert.deepEqual(whileLeaving, { panel: true, marker: 'hidden' })
    await settleMorph(onPage)

    const shownWhileOpening = await onPage.evaluate(async () => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Open GitHub Sidecar"]') as HTMLElement).click()
      let shown = false
      const follow = (): Promise<void> =>
        new Promise((resolve) => requestAnimationFrame(resolve)).then(() => {
          const panel = shadow.querySelector('[data-docked]:not([inert])')
          const marker = shadow.querySelector('[data-current-marker]')
          const morphing = !panel || panel.hasAttribute('data-morphing')
          if (morphing && marker && getComputedStyle(marker).visibility === 'visible') shown = true
          return morphing ? follow() : undefined
        })
      await follow()
      return shown
    })
    assert.equal(shownWhileOpening, false)

    await onPage.waitForFunction(() => {
      const marker = document
        .getElementById('github-sidecar-root')!
        .shadowRoot!.querySelector('[data-current-marker]')
      return marker ? getComputedStyle(marker).visibility === 'visible' : false
    })
    const marker = (await markerGeometry())!
    assert.equal(Math.round(marker.top), Math.round(marker.rowTop!))
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
      ;(shadow.querySelector('input[aria-label="Filter the rows already loaded"]') as HTMLElement).focus()
    })
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

  it('lifts a row into a card only while a drawer lists something', async () => {
    const settlesTo = (expected: boolean) =>
      panel.waitForFunction((want) => {
        const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
        const row = shadow.querySelector('[data-index="1"] [data-item-body]')!.parentElement!
        return (getComputedStyle(row).boxShadow !== 'none') === want
      }, {}, expected)

    await settlesTo(false)

    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[data-index="1"] [aria-label="Show the failing checks"]') as HTMLElement).click()
    })
    await settlesTo(true)

    // The checks go green while the drawer is still open, so nothing is listed.
    const failing = await panel.evaluate(
      () => (window as unknown as { __items: Array<Record<string, unknown>> }).__items[1]!.failingChecks,
    )
    await changeItem(1, { failingChecks: [] })
    await settlesTo(false)

    await changeItem(1, { failingChecks: failing })
    await settlesTo(true)
    await panel.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[data-index="1"] [aria-label="Hide the failing checks"]') as HTMLElement).click()
    })
    await settlesTo(false)
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
    await panel.waitForFunction(
      () =>
        document.getElementById('github-sidecar-root')!.shadowRoot!.activeElement?.getAttribute('aria-label') ===
        'Filter the rows already loaded',
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

    // Escape clears what was typed, and a second one leaves the box.
    await panel.keyboard.press('Escape')
    await panel.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const input = shadow.querySelector<HTMLInputElement>('input[aria-label="Filter the rows already loaded"]')
      return (
        input?.value === '' &&
        shadow.activeElement === input &&
        [...shadow.querySelectorAll('[data-index]')].some(
          (row) => !row.textContent?.includes('Item number 1 '),
        )
      )
    })
    await panel.keyboard.press('Escape')
    await panel.waitForFunction(
      () => document.getElementById('github-sidecar-root')!.shadowRoot!.activeElement === null,
    )
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

describe('grouping the loaded rows', { concurrency: false, skip }, () => {
  let groupBrowser: Browser
  let groupPage: Page

  before(async () => {
    groupBrowser = await puppeteer.launch({ executablePath, headless: true })
    groupPage = await groupBrowser.newPage()
    await groupPage.setViewport({ width: 1280, height: 800 })
    await groupPage.setContent(
      '<!doctype html><html data-color-mode="light"><body></body></html>',
    )
    // Two queries so grouping can be shown to stay with the one it was set on.
    await groupPage.evaluate(
      CHROME_STUB.replace(
        "savedQueries: [{ id: 'seeded', name: 'Needs my review', query: 'is:open is:pr' }],",
        "savedQueries: [{ id: 'seeded', name: 'Needs my review', query: 'is:open is:pr' }, { id: 'second', name: 'My pull requests', query: 'is:open is:pr author:@me' }],",
      ),
    )

    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await groupPage.evaluate(bundle)
    await groupPage.waitForSelector('#github-sidecar-root')
    await groupPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await groupBrowser?.close()
  })

  const savedQueries = () =>
    groupPage.evaluate(async () => {
      const api = (
        window as unknown as {
          chrome: {
            storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } }
          }
        }
      ).chrome
      const result = await api.storage.local.get('savedQueries')
      return result.savedQueries as Array<{ id: string; groupBy?: string }>
    })

  const groupHeaderCount = () =>
    groupPage.evaluate(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll(
            'button[aria-label^="Collapse "], button[aria-label^="Expand "]',
          ).length,
    )

  it('keeps a grouping with the query it was chosen on, and saves it', async () => {
    // A flat list to begin with: no section headers.
    assert.equal(await groupHeaderCount(), 0)

    await groupPage.waitForFunction(() =>
      Boolean(
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[aria-label="Group the rows"]'),
      ),
    )

    // The grouping control is a Radix trigger, which opens only on a real
    // pointer, so click it by its coordinates.
    const trigger = await groupPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const box = shadow
        .querySelector('[aria-label="Group the rows"]')!
        .getBoundingClientRect()
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    })
    await groupPage.mouse.click(trigger.x, trigger.y)
    await groupPage.waitForFunction(() =>
      [
        ...document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll('[role="menuitem"]'),
      ].some((node) => node.textContent?.trim() === 'By status'),
    )

    // The menu item selects on click, so a synthetic one carries.
    await groupPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const item = [...shadow.querySelectorAll('[role="menuitem"]')].find(
        (node) => node.textContent?.trim() === 'By status',
      )
      ;(item as HTMLElement).click()
    })

    // The rows break into sections, so headers appear.
    await groupPage.waitForFunction(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll(
            'button[aria-label^="Collapse "], button[aria-label^="Expand "]',
          ).length > 0,
    )

    // The grouping is written onto the query it was set on, and no other.
    await groupPage.waitForFunction(async () => {
      const api = (
        window as unknown as {
          chrome: {
            storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } }
          }
        }
      ).chrome
      const result = await api.storage.local.get('savedQueries')
      const queries = result.savedQueries as Array<{ id: string; groupBy?: string }>
      return queries[0]?.groupBy === 'status'
    })

    const stored = await savedQueries()
    assert.equal(stored[0]?.groupBy, 'status')
    assert.equal(stored[1]?.groupBy, undefined)
  })
})

describe('quick filters', { concurrency: false, skip }, () => {
  let quickBrowser: Browser
  let quickPage: Page

  before(async () => {
    quickBrowser = await puppeteer.launch({ executablePath, headless: true })
    quickPage = await quickBrowser.newPage()
    await quickPage.setViewport({ width: 1280, height: 900 })
    await quickPage.setContent('<!doctype html><html data-color-mode="light"><body></body></html>')
    await quickPage.evaluate(CHROME_STUB)
    const bundle = await readFile(fileURLToPath(new URL('content.js', distRoot)), 'utf8')
    await quickPage.evaluate(bundle)
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')?.shadowRoot
      return (shadow?.querySelectorAll('[data-index]').length ?? 0) > 0
    })
  })

  after(async () => {
    await quickBrowser?.close()
  })

  const searches = () =>
    quickPage.evaluate(
      () =>
        (window as unknown as { __sentMessages: Array<{ type?: string }> }).__sentMessages.filter(
          (message) => message.type === 'search',
        ).length,
    )

  /** The row titles on screen, without the loader row. */
  const titles = () =>
    quickPage.evaluate(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-index]')]
        .map((row) => row.querySelector('button')?.textContent ?? '')
        .filter((text) => !text.includes('Loading more')),
    )

  /** Radix opens a trigger only on a real pointer, so click it by its coordinates. */
  const openMenu = async () => {
    const box = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const rect = shadow
        .querySelector('[aria-label="Filter by status or person"]')!
        .getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    })
    await quickPage.mouse.click(box.x, box.y)
    await quickPage.waitForFunction(() =>
      Boolean(
        document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[role="menu"]'),
      ),
    )
  }

  // Radix hands focus back to the trigger on a timer after the menu closes;
  // moving focus before that lands would have it taken away again.
  const closeMenu = async () => {
    await quickPage.keyboard.press('Escape')
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return (
        !shadow.querySelector('[role="menu"]') &&
        shadow.activeElement?.getAttribute('aria-label') === 'Filter by status or person'
      )
    })
  }

  const clickMenuEntry = (text: string) =>
    quickPage.evaluate((label) => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')].find(
        (node) => node.textContent?.startsWith(label),
      )
      ;(entry as HTMLElement).click()
    }, text)

  it('is there from the start, without taking focus from the page', async () => {
    const state = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return {
        hasSearch: Boolean(shadow.querySelector('input[aria-label="Filter the rows already loaded"]')),
        hasHeaderToggle: Boolean(shadow.querySelector('[aria-label="Filter these rows"]')),
        focusedInPanel: shadow.activeElement !== null,
      }
    })
    assert.deepEqual(state, { hasSearch: true, hasHeaderToggle: false, focusedInPanel: false })
  })

  it('narrows to the rows with a mark, keeps the menu open, and asks GitHub for nothing', async () => {
    const searchesBefore = await searches()

    await openMenu()
    // Only row 1 conflicts and only row 3 has fallen behind.
    const entries = await quickPage.evaluate(() =>
      [
        ...document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll('[role="menuitemcheckbox"]'),
      ].map((node) => node.textContent),
    )
    assert.ok(entries.includes('Conflicts1'), `expected a Conflicts entry, got ${entries}`)
    assert.ok(entries.includes('Behind1'), `expected a Behind entry, got ${entries}`)

    await clickMenuEntry('Conflicts')
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const rows = [...shadow.querySelectorAll('[data-index]')].filter(
        (row) => !row.textContent?.includes('Loading more'),
      )
      return rows.length > 0 && rows.every((row) => row.textContent?.includes('Item number 1 '))
    })

    const state = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const entry = [...shadow.querySelectorAll('[role="menuitemcheckbox"]')].find((node) =>
        node.textContent?.startsWith('Conflicts'),
      )
      return {
        menuOpen: Boolean(shadow.querySelector('[role="menu"]')),
        checked: entry?.getAttribute('aria-checked'),
        token: shadow.querySelector('[data-quick-filter="merge"]')?.textContent,
      }
    })
    assert.equal(state.menuOpen, true, 'expected the menu to stay open for another choice')
    assert.equal(state.checked, 'true')
    assert.equal(state.token, 'MergeConflicts')
    assert.equal(await searches(), searchesBefore)

    await closeMenu()
  })

  it('picks a person from a submenu, and clears every choice at once', async () => {
    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;([...shadow.querySelectorAll('button')].find((node) => node.textContent === 'Clear') as HTMLElement).click()
    })
    await quickPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-quick-filter]'),
    )

    await openMenu()
    await clickMenuEntry('Assignee')
    await quickPage.waitForFunction(() =>
      [
        ...document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelectorAll('[role="menuitemcheckbox"]'),
      ].some((node) => node.textContent?.startsWith('hubot')),
    )
    await clickMenuEntry('hubot')

    // Rows 1, 6, 11, … are assigned to hubot.
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const rows = [...shadow.querySelectorAll('[data-index] button')]
        .map((node) => node.textContent ?? '')
        .filter((text) => text.startsWith('Item number'))
      return rows.length > 0 && rows.every((text) => Number(/Item number (\d+)/.exec(text)?.[1]) % 5 === 1)
    })
    const token = await quickPage.evaluate(
      () =>
        document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-quick-filter="assignee"]')?.textContent,
    )
    assert.equal(token, 'Assigneehubot')

    // One Escape closes the submenu and the menu under it.
    await closeMenu()
  })

  it('clears the typed text on Escape, and keeps the chosen filters', async () => {
    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('input[aria-label="Filter the rows already loaded"]') as HTMLElement).focus()
    })
    // A label only row 1 carries, and row 1 is one of hubot's.
    await quickPage.keyboard.type('regression')
    await quickPage.waitForFunction(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      const rows = [...shadow.querySelectorAll('[data-index] button')]
        .map((node) => node.textContent ?? '')
        .filter((text) => text.startsWith('Item number'))
      return rows.length > 0 && rows.every((text) => text.includes('Item number 1 '))
    })

    await quickPage.keyboard.press('Escape')
    await quickPage.waitForFunction(() =>
      [...document.getElementById('github-sidecar-root')!.shadowRoot!.querySelectorAll('[data-index] button')].some(
        (node) => node.textContent?.includes('Item number 6 '),
      ),
    )
    const state = await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      return {
        text: shadow.querySelector<HTMLInputElement>('input[aria-label="Filter the rows already loaded"]')?.value,
        token: shadow.querySelector('[data-quick-filter="assignee"]')?.textContent,
      }
    })
    assert.deepEqual(state, { text: '', token: 'Assigneehubot' })
    assert.ok((await titles()).every((text) => Number(/Item number (\d+)/.exec(text)?.[1]) % 5 === 1))

    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;([...shadow.querySelectorAll('button')].find((node) => node.textContent === 'Clear') as HTMLElement).click()
    })
    await quickPage.waitForFunction(
      () => !document.getElementById('github-sidecar-root')!.shadowRoot!.querySelector('[data-quick-filter]'),
    )
  })

  it('keeps focus in the bar as tokens are removed', async () => {
    await openMenu()
    await clickMenuEntry('Conflicts')
    await clickMenuEntry('Draft')
    await closeMenu()

    const focused = () =>
      quickPage.evaluate(() => {
        const active = document.getElementById('github-sidecar-root')!.shadowRoot!.activeElement
        return active?.getAttribute('aria-label') ?? null
      })

    await quickPage.evaluate(() => {
      const shadow = document.getElementById('github-sidecar-root')!.shadowRoot!
      ;(shadow.querySelector('[aria-label="Remove the merge filter"]') as HTMLElement).focus()
    })
    await quickPage.keyboard.press('Enter')
    await quickPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-quick-filter="merge"]'),
    )
    assert.equal(await focused(), 'Remove the state filter')

    await quickPage.keyboard.press('Enter')
    await quickPage.waitForFunction(
      () =>
        !document
          .getElementById('github-sidecar-root')!
          .shadowRoot!.querySelector('[data-quick-filter]'),
    )
    assert.equal(await focused(), 'Filter the rows already loaded')
  })
})
