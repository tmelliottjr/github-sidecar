/**
 * Measurements of the host page that docked mode needs.
 *
 * Docked mode drops the panel into the empty gutter github.com leaves to the
 * left of its centred content, so it has to answer two questions about a page
 * it does not control: where the page's own content starts horizontally, and
 * where the chrome at the top of the page ends. Both are measured from the
 * rendered result by hit-testing rather than read off a selector, because
 * github.com's markup changes far more often than its layout does.
 *
 * The panel sits below that chrome and never beside it: the header and the nav
 * rows go on spanning the window as github.com drew them, and only the page
 * body beneath is moved across. That is what makes the dock read as part of
 * the site rather than as something parked on top of it.
 */

export const HOST_ID = 'github-sidecar-root'

const STYLE_ID = 'github-sidecar-dock-style'

/**
 * Marks the bars that have to keep spanning the viewport once we have taken
 * space from the page. An attribute rather than a selector in the stylesheet
 * so the rule stays one line however github.com's markup is arranged.
 */
const FULL_BLEED_ATTR = 'data-github-sidecar-full-bleed'

/** Breathing room between the docked panel and the page's own content. */
export const DOCK_GAP = 16

/** How far right we look before giving up on finding page content. */
const MAX_GUTTER = 760

/** How far down we look for chrome pinned to the top of the viewport. */
const MAX_CHROME = 240
const CHROME_STEP = 8
/** Widest seam between two stacked bars that is not a break in the stack. */
const CHROME_GAP = 16

/** Chrome in normal flow has to span this much of the viewport to count. */
const FULL_WIDTH_RATIO = 0.8

/**
 * Boxes narrower than this are cards and controls inside the page column, not
 * the column itself, so they cannot say where the gutter ends.
 */
const COLUMN_RATIO = 0.4

/** Never take more than this share of the viewport from the page. */
const MAX_PUSH_RATIO = 0.6

/**
 * How far down the document a bar can start and still be top chrome. Measured
 * from the top of the document rather than the viewport so that scrolling
 * cannot turn the header into something else while it is off screen.
 */
const TOP_CHROME_DEPTH = 320

/**
 * Full-width chrome github.com renders above the page body. At the top of a
 * page the nav row is not pinned yet, so hit-testing for sticky boxes cannot
 * find it, and the panel still has to start below it.
 */
const TOP_CHROME_SELECTOR = [
  '.AppHeader',
  'header[role="banner"]',
  '.js-header-wrapper',
  '.UnderlineNav',
  'nav[aria-label="Repository"]',
  'nav[aria-label="Global"]',
  '.pagehead',
].join(',')

/** Elements at this point, ignoring our own shadow host. */
function stackAt(x: number, y: number): Element[] {
  return document.elementsFromPoint(x, y).filter((element) => element.id !== HOST_ID)
}

/**
 * True when a bar pinned to the top of the viewport covers this point.
 *
 * github.com stacks pinned bars — the global header, and on a pull request a
 * mini header that pins beneath it — so a bar cannot be required to sit flush
 * at the top. Nor can it be required to span the viewport: the mini header is
 * only as wide as the page column. What identifies one is that it is stuck and
 * wide; the caller's walk down from the top supplies the rest by only ever
 * accepting bars contiguous with the top of the viewport.
 */
function isPinnedChrome(x: number, y: number): boolean {
  return stackAt(x, y).some((element) => {
    const position = getComputedStyle(element).position
    if (position !== 'sticky' && position !== 'fixed') return false
    return element.getBoundingClientRect().width >= window.innerWidth * COLUMN_RATIO
  })
}

/** Bottom of the stack of bars currently pinned to the top of the viewport. */
function pinnedBottom(): number {
  const limit = Math.min(MAX_CHROME, window.innerHeight)
  const column = window.innerWidth * 0.6
  let bottom = 0

  for (let y = 1; y < limit; y += CHROME_STEP) {
    if (isPinnedChrome(column, y)) bottom = y
    // Stacked bars can meet with a hairline of page showing between them, so
    // the walk gives up only once the gap is wider than a seam could be.
    else if (y - bottom > CHROME_GAP) break
  }

  return bottom === 0 ? 0 : bottom + CHROME_STEP
}

/** Bottom of the header and nav rows, whether or not they are pinned yet. */
function chromeBottom(): number {
  let bottom = 0

  for (const element of document.querySelectorAll(TOP_CHROME_SELECTOR)) {
    const rect = element.getBoundingClientRect()
    const isWide = rect.width >= window.innerWidth * FULL_WIDTH_RATIO
    const isNearTop = rect.bottom > 0 && rect.top < window.innerHeight / 2
    if (isWide && isNearTop) bottom = Math.max(bottom, rect.bottom)
  }

  return bottom
}

/** Viewport y at which page content begins, below any top chrome. */
export function measureContentTop(): number {
  const top = Math.max(pinnedBottom(), chromeBottom())
  return Math.round(Math.min(Math.max(top, 0), window.innerHeight / 2))
}

/**
 * Tags the full-width bars at the top of the document so the reservation can
 * hand them back the space it takes from everything else.
 *
 * Only the outermost box of a nested stack is tagged — github.com wraps its
 * header in a positioning div that matches too, and pulling both back would
 * move the header twice. Bars taken out of flow are skipped: body's padding
 * never moved them, so nothing owes them anything.
 *
 * Must be called while the page is measured bare, since a bar's width is what
 * says whether it is full-bleed and the reservation would distort it.
 */
function markFullBleedChrome(): void {
  clearFullBleedChrome()

  const bars = [...document.querySelectorAll(TOP_CHROME_SELECTOR)].filter((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < window.innerWidth * FULL_WIDTH_RATIO) return false
    if (rect.top + window.scrollY > TOP_CHROME_DEPTH) return false
    return getComputedStyle(element).position !== 'fixed'
  })

  for (const bar of bars) {
    if (bars.some((other) => other !== bar && other.contains(bar))) continue
    bar.setAttribute(FULL_BLEED_ATTR, '')
  }
}

function clearFullBleedChrome(): void {
  for (const marked of document.querySelectorAll(`[${FULL_BLEED_ATTR}]`)) {
    marked.removeAttribute(FULL_BLEED_ATTR)
  }
}

/**
 * Viewport x of the left edge of body's content box, which is where the page
 * lays itself out from — our own reservation included.
 */
function pageOrigin(): number {
  const body = document.body
  if (!body) return 0
  const style = getComputedStyle(body)
  return (
    body.getBoundingClientRect().left +
    (parseFloat(style.borderLeftWidth) || 0) +
    (parseFloat(style.paddingLeft) || 0)
  )
}

/**
 * Left edge of the page's own content at one probe point.
 *
 * github.com centres its pages in a max-width column, so the gutter is that
 * column's inset. Insets are measured from where the page lays out rather than
 * from the viewport edge, because once we have reserved space the wrappers no
 * longer start at x=0 and would otherwise be mistaken for the column itself.
 * Wrappers have no inset and are skipped, which leaves the outermost box that
 * is genuinely indented — and leaves the origin on a viewport too narrow for
 * the column to be centred at all. Returns null when the probe found no page
 * layout, so an empty row cannot report a gutter of zero.
 */
function contentEdgeAt(x: number, y: number, origin: number): number | null {
  let found = false
  let edge = origin

  // elementsFromPoint runs innermost first, so the last match is outermost.
  for (const element of stackAt(x, y)) {
    if (element === document.body || element === document.documentElement) continue
    const rect = element.getBoundingClientRect()
    if (rect.width < window.innerWidth * COLUMN_RATIO) continue
    found = true
    if (rect.left - origin > 0.5) edge = rect.left
  }

  return found ? edge : null
}

/**
 * Where the page's content starts, in viewport coordinates. Probing several
 * rows keeps a full-bleed banner, or a page too short to fill the viewport,
 * from reporting a gutter the rest of the page does not have.
 */
function measureGutter(contentTop: number): number {
  const x = window.innerWidth / 2
  const origin = pageOrigin()
  const rows = [
    contentTop + 24,
    (contentTop + window.innerHeight) / 2,
    window.innerHeight - 24,
  ].filter((y) => y > contentTop && y < window.innerHeight)

  let gutter: number | null = null

  for (const y of rows) {
    const edge = contentEdgeAt(x, y, origin)
    if (edge === null) continue
    gutter = gutter === null ? edge : Math.min(gutter, edge)
  }

  return gutter === null ? MAX_GUTTER : Math.min(gutter, MAX_GUTTER)
}

/**
 * The reservation lives on `<body>` rather than a content wrapper because body
 * is the one element Turbo navigation never replaces, so it survives a
 * navigation without having to be reapplied.
 */
function reservationStyle(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ID)
  if (existing instanceof HTMLStyleElement) return existing

  const style = document.createElement('style')
  style.id = STYLE_ID
  document.head.append(style)
  return style
}

function writeReservation(style: HTMLStyleElement, pixels: number): void {
  if (pixels <= 0) {
    style.textContent = ''
    return
  }

  const inset = Math.round(pixels)

  // border-box stops the padding widening body past the viewport. The tagged
  // bars are pulled back out by the same amount; their width is left auto so
  // the negative margin alone restretches them across the window, which no
  // padding or border on the bar itself can throw off.
  style.textContent =
    `body{box-sizing:border-box!important;padding-left:${inset}px!important}` +
    `[${FULL_BLEED_ATTR}]{margin-left:-${inset}px!important;margin-right:0!important;` +
    `width:auto!important;max-width:none!important}`
}

export function clearReservation(): void {
  document.getElementById(STYLE_ID)?.remove()
  clearFullBleedChrome()
}

export interface Reservation {
  /** Viewport y at which page content begins, below any top chrome. */
  contentTop: number
  /** How much space was taken from the page, if any. */
  reserved: number
}

/**
 * Makes the page's own content start clear of the panel's right edge.
 *
 * The whole target is reserved rather than just the shortfall. Padding body
 * moves every box on the page by exactly that much, so reserving the target is
 * what guarantees the centred column begins clear of the panel. Reserving only
 * the difference would leave the column's own inset absorbing part of the
 * padding, and the page would still start underneath us.
 *
 * The chrome at the top is then given that space straight back, because the
 * panel hangs below it rather than beside it. A header stopping short of the
 * window is the one thing that would give away that the page has been moved at
 * all, and it is the part of github.com a reader is most likely to know by
 * sight.
 *
 * Reading a box forces layout, so the page is measured bare and restored
 * without ever being painted that way.
 */
export function reserveGutter(target: number): Reservation {
  const style = reservationStyle()

  writeReservation(style, 0)
  const contentTop = measureContentTop()
  const bare = measureGutter(contentTop)

  const reserved =
    bare >= target ? 0 : Math.min(target, window.innerWidth * MAX_PUSH_RATIO)

  // Still measured bare here, which is the only state the tagging can trust.
  if (reserved > 0) markFullBleedChrome()
  else clearFullBleedChrome()

  writeReservation(style, reserved)

  return { contentTop, reserved }
}
