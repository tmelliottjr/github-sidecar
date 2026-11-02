/**
 * Measurements of the host page that docked mode needs.
 *
 * Docked mode drops the panel into the empty gutter github.com leaves to the
 * left of its centred content, so it has to answer two questions about a page
 * it does not control: where the page's own content starts horizontally, and
 * where the chrome at the top of the page ends. Both are measured from the
 * rendered result and the `<main>` landmark rather than read off class names,
 * because github.com serves pages from more than one frontend and each one
 * names its header differently.
 *
 * The panel sits below that chrome and never beside it: the header and the nav
 * rows go on spanning the window as github.com drew them, and only the page
 * body beneath is moved across. That is what makes the dock read as part of
 * the site rather than as something parked on top of it.
 */

import { spring } from 'motion'

import { MORPH_SPRING } from '../lib/morph-spring.ts'

export const HOST_ID = 'github-sidecar-root'

/** Marks the bars pulled back across the reservation to keep spanning the viewport. */
const FULL_BLEED_ATTR = 'data-github-sidecar-full-bleed'

/** Set on body while the page moves with the panel. */
const MOVING_ATTR = 'data-github-sidecar-moving'

/**
 * The panel spring as a CSS timing, such as `550ms linear(…)`, so the page
 * moves with the panel. Its overshoot is capped: padding stops at 0, so a
 * close that overshot would leave the header margin pulling it 1px right.
 */
const MOVE_TIMING = String(spring(MORPH_SPRING.visualDuration, MORPH_SPRING.bounce)).replace(
  /[\d.]+(?=[,)])/g,
  (point) => String(Math.min(1, Number(point))),
)
/** A frame or so past the end of a move, so it is never cut short. */
const MOVE_MS = parseFloat(MOVE_TIMING) + 50

/** Breathing room between the docked panel and the page's own content. */
export const DOCK_GAP = 16

/** Space between the docked panel and the viewport edges and the header above it. */
export const DOCK_INSET = 12

/** How far right we look before giving up on finding page content. */
const MAX_GUTTER = 760

/** How far down we look for chrome pinned to the top of the viewport. */
const MAX_CHROME = 240
const CHROME_STEP = 8
/** Widest seam between two stacked bars that is not a break in the stack. */
const CHROME_GAP = 16
/** Pinned bars thinner than this are progress bars and hairlines, not chrome. */
const MIN_BAR_HEIGHT = 8

/** Chrome in normal flow has to span this much of the viewport to count. */
const FULL_WIDTH_RATIO = 0.8

/**
 * Boxes narrower than this are cards and controls inside the page column, not
 * the column itself, so they cannot say where the gutter ends.
 */
const COLUMN_RATIO = 0.4

/** Never take more than this share of the viewport from the page. */
const MAX_PUSH_RATIO = 0.6

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
    const rect = element.getBoundingClientRect()
    return rect.width >= window.innerWidth * COLUMN_RATIO && rect.height >= MIN_BAR_HEIGHT
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

/** Skips a `<main>` that is hidden or too narrow to be the page itself. */
function mainLandmark(): Element | null {
  for (const element of document.querySelectorAll('main, [role="main"]')) {
    if (element.getBoundingClientRect().width >= window.innerWidth * COLUMN_RATIO) {
      return element
    }
  }
  return null
}

/**
 * The full-width bars github.com draws above its `<main>` landmark: the
 * header, the nav rows, and anything stacked with them, such as the staff bar.
 *
 * Boxes have to end above `<main>` to count, so a sidebar laid out beside it
 * is never taken for a header. Sticky boxes are exempt, because once pinned
 * they sit below a `<main>` that has scrolled up past them. Boxes out of flow
 * are skipped, since body padding never moves them.
 */
function topChrome(): Element[] {
  const main = mainLandmark()
  if (!main) return []

  const mainTop = main.getBoundingClientRect().top
  const bars: Element[] = []

  let node: Element | null = main
  while (node && node !== document.body) {
    for (let bar = node.previousElementSibling; bar; bar = bar.previousElementSibling) {
      const position = getComputedStyle(bar).position
      if (position === 'fixed' || position === 'absolute') continue
      const rect = bar.getBoundingClientRect()
      if (rect.height === 0 || rect.width < window.innerWidth * FULL_WIDTH_RATIO) continue
      if (position !== 'sticky' && rect.bottom > mainTop + 1) continue
      bars.push(bar)
    }
    node = node.parentElement
  }

  return bars
}

/** Bottom of the header and nav rows, whether or not they are pinned yet. */
function chromeBottom(): number {
  let bottom = 0
  for (const bar of topChrome()) bottom = Math.max(bottom, bar.getBoundingClientRect().bottom)
  return bottom
}

/** Viewport y at which page content begins, below any top chrome. */
export function measureContentTop(): number {
  const top = Math.max(pinnedBottom(), chromeBottom())
  return Math.round(Math.min(Math.max(top, 0), window.innerHeight / 2))
}

/** Bars pulled back across the reservation, with the left margin each has bare. */
const fullBleed = new Map<HTMLElement, number>()

/**
 * Tags the bars at the top of the document so the reservation can hand them
 * back the space it takes from everything else.
 *
 * Must be called while the page is measured bare, since a bar's width is what
 * says whether it is full-bleed and the reservation would distort it.
 */
function markFullBleedChrome(): void {
  clearFullBleedChrome()
  for (const bar of topChrome()) {
    if (!(bar instanceof HTMLElement)) continue
    fullBleed.set(bar, parseFloat(getComputedStyle(bar).marginLeft) || 0)
    bar.setAttribute(FULL_BLEED_ATTR, '')
  }
}

function clearFullBleedChrome(): void {
  for (const bar of fullBleed.keys()) {
    bar.removeAttribute(FULL_BLEED_ATTR)
    restoreStyle(bar)
  }
  fullBleed.clear()
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

interface Replaced {
  /** What github.com had inline, which clearing puts back. */
  value: string
  priority: string
  /** What the reservation last wrote, as the browser reads it back. */
  applied: string
}

/** Inline values the reservation has replaced, per element. */
const replaced = new WeakMap<HTMLElement, Map<string, Replaced>>()

function setStyle(element: HTMLElement, property: string, value: string): void {
  let saved = replaced.get(element)
  if (!saved) {
    saved = new Map()
    replaced.set(element, saved)
  }
  const current = element.style.getPropertyValue(property)
  const entry = saved.get(property)
  // github.com may have written its own value since the reservation last did;
  // that one is what clearing has to put back.
  if (!entry || current !== entry.applied) {
    saved.set(property, {
      value: current,
      priority: element.style.getPropertyPriority(property),
      applied: '',
    })
  }
  element.style.setProperty(property, value, 'important')
  saved.get(property)!.applied = element.style.getPropertyValue(property)
}

/** Puts back one property, or with none named, every property the reservation set. */
function restoreStyle(element: HTMLElement, property?: string): void {
  const saved = replaced.get(element)
  if (!saved) return
  for (const [name, { value, priority, applied }] of saved) {
    if (property !== undefined && name !== property) continue
    saved.delete(name)
    // Left alone if github.com has written its own value since.
    if (element.style.getPropertyValue(name) !== applied) continue
    if (value) element.style.setProperty(name, value, priority)
    else element.style.removeProperty(name)
  }
}

/** Left padding body has bare, which a close moves back to. */
let basePadding = 0
/** Whether the page keeps its reservation once a move ends. */
let isReserved = false
let moveEnd: number | undefined

/**
 * The reservation lives on `<body>` rather than a content wrapper because body
 * is the one element Turbo navigation never replaces, so it survives a
 * navigation without having to be reapplied. It is written inline: changing a
 * stylesheet restyles every element on github.com, which costs a frame.
 *
 * border-box stops the padding widening body past the viewport. The tagged
 * bars are pulled back out by the same amount; their width is left auto so
 * the negative margin alone restretches them across the window, which no
 * padding or border on the bar itself can throw off.
 *
 * A move eases the page from where it is drawn to `pixels` on the panel
 * spring, with the bars eased the same way so they hold still.
 */
function writeReservation(pixels: number, move: boolean): void {
  const body = document.body
  const inset = Math.round(pixels)
  const shift = inset - basePadding

  for (const [element, property] of [
    [body, 'padding-left'],
    ...[...fullBleed.keys()].map((bar) => [bar, 'margin-left'] as const),
  ] as const) {
    // Restoring the transition also cancels a move that is still running.
    if (move) setStyle(element, 'transition', `${property} ${MOVE_TIMING}`)
    else restoreStyle(element, 'transition')
  }

  setStyle(body, 'box-sizing', 'border-box')
  setStyle(body, 'padding-left', `${inset}px`)
  for (const [bar, margin] of fullBleed) {
    setStyle(bar, 'margin-left', `${margin - shift}px`)
    setStyle(bar, 'margin-right', '0px')
    setStyle(bar, 'width', 'auto')
    setStyle(bar, 'max-width', 'none')
  }
}

/** Where the page is drawn now, partway through a move or not. */
function drawnInset(): number {
  return parseFloat(getComputedStyle(document.body).paddingLeft) || 0
}

/**
 * Starts a move from where the page is drawn now. Reading the computed style
 * commits that position; without it, Firefox starts the move a little behind.
 */
function moveReservation(from: number, to: number): void {
  document.body.setAttribute(MOVING_ATTR, '')
  writeReservation(from, false)
  drawnInset()
  writeReservation(to, true)
  window.clearTimeout(moveEnd)
  moveEnd = window.setTimeout(endMove, MOVE_MS)
}

function endMove(): void {
  window.clearTimeout(moveEnd)
  moveEnd = undefined
  document.body.removeAttribute(MOVING_ATTR)
  if (isReserved) {
    restoreStyle(document.body, 'transition')
    for (const bar of fullBleed.keys()) restoreStyle(bar, 'transition')
  } else {
    restoreStyle(document.body)
    clearFullBleedChrome()
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Gives the page its space back. With `move`, the page eases back across on
 * the panel spring first.
 */
export function clearReservation({ move = false }: { move?: boolean } = {}): void {
  isReserved = false
  if (move && !prefersReducedMotion()) {
    const drawn = drawnInset()
    if (Math.round(drawn) !== Math.round(basePadding)) {
      moveReservation(drawn, basePadding)
      return
    }
  }
  endMove()
}

export interface Reservation {
  /** Viewport y at which page content begins, below any top chrome. */
  contentTop: number
  /** How much space was taken from the page, if any. */
  reserved: number
}

/**
 * Makes the page's own content start clear of the panel's right edge. With
 * `move`, the page eases there on the panel spring from wherever it is drawn.
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
export function reserveGutter(
  target: number,
  { move = false }: { move?: boolean } = {},
): Reservation {
  const moving = move && !prefersReducedMotion()
  const drawn = moving ? drawnInset() : 0

  window.clearTimeout(moveEnd)
  document.body.removeAttribute(MOVING_ATTR)
  restoreStyle(document.body)
  clearFullBleedChrome()
  const contentTop = measureContentTop()
  basePadding = drawnInset()
  const bare = measureGutter(contentTop)

  const reserved =
    bare >= target ? 0 : Math.min(target, window.innerWidth * MAX_PUSH_RATIO)
  isReserved = reserved > 0
  const goal = isReserved ? reserved : basePadding
  const moves = moving && Math.round(drawn) !== Math.round(goal)

  // Still measured bare here, which is the only state the tagging can trust.
  // A page moving back from a reservation needs its bars held too.
  if (isReserved || moves) markFullBleedChrome()

  if (moves) moveReservation(drawn, goal)
  else if (isReserved) writeReservation(reserved, false)

  return { contentTop, reserved }
}
