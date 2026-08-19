import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { usePortalContainer } from '@/components/ui/portal-container'

/** How far the marker reaches back inside the panel, hugging its edge. */
const INSIDE = 2
/** How far its point reaches out past the panel, over the page. */
const PROTRUSION = 5
/**
 * Half the height the point is cut from. A tip drawn across the whole row is
 * a taper of a couple of degrees, which anti-aliasing rounds off into a blob;
 * over a span of this order it reads as an arrowhead, which is the whole
 * purpose of it.
 */
const POINT_REACH = 9

const WIDTH = INSIDE + PROTRUSION

interface Props {
  /** The row to mark, or null when it is not mounted — or does not exist. */
  row: HTMLElement | null
  /** The list's scroll container, which is also where the marker is clipped. */
  viewportRef: RefObject<HTMLElement | null>
}

/**
 * The marker for the row this tab's page is on: a point on the panel's outer
 * edge, level with the row, reaching a little way out over github.com itself.
 *
 * It has to be drawn outside the panel, which clips its own children to its
 * rounded corners — as does the scrolling list, which cannot show anything
 * horizontally beyond its own box. So the marker is portalled out to the
 * shadow root and positioned against the row's measured rectangle instead of
 * flowing with it.
 *
 * Everything it depends on can move without React hearing about it: the list
 * scrolls, the page scrolls under a docked panel, and a window drag writes its
 * transform straight to the DOM. Rather than model each of those, every source
 * of movement schedules the same measure-and-place on the next frame.
 */
export function CurrentRowMarker({ row, viewportRef }: Props) {
  const container = usePortalContainer()
  const markerRef = useRef<HTMLDivElement | null>(null)
  const frame = useRef(0)

  const place = useCallback(() => {
    const marker = markerRef.current
    const viewport = viewportRef.current
    if (!marker || !row || !viewport) return

    // The item's own block, not the stack that may be hanging open below it:
    // the reader is on one pull request, not on the chain it belongs to.
    const body = row.querySelector('[data-item-body]') ?? row
    const rowRect = body.getBoundingClientRect()
    const listRect = viewport.getBoundingClientRect()
    const panel = row.closest('[role="complementary"]') ?? viewport
    const panelRect = panel.getBoundingClientRect()

    // A row half way off the top of the list is marked half way: the band is
    // what the two rectangles share, and the arrow inside it keeps the row's
    // full height and slides behind the clip.
    const top = Math.max(rowRect.top, listRect.top)
    const bottom = Math.min(rowRect.bottom, listRect.bottom)
    const height = bottom - top

    if (height <= 0) {
      marker.style.visibility = 'hidden'
      return
    }

    marker.style.visibility = 'visible'
    marker.style.height = `${height}px`
    marker.style.transform = `translate3d(${panelRect.right - INSIDE}px, ${top}px, 0)`

    const arrow = marker.firstElementChild as HTMLElement | null
    if (arrow) {
      arrow.style.height = `${rowRect.height}px`
      arrow.style.transform = `translateY(${rowRect.top - top}px)`
    }
  }, [row, viewportRef])

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(place)
  }, [place])

  useLayoutEffect(() => {
    if (!row) return
    place()

    // Capturing, because a scroll event does not bubble: this is what hears
    // the list scrolling as well as the page under a docked panel.
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)

    const observer = new ResizeObserver(schedule)
    observer.observe(row)
    const viewport = viewportRef.current
    if (viewport) observer.observe(viewport)

    // A drag or a resize writes the panel's geometry straight to its style
    // attribute, frame by frame, without a render for either to be seen in.
    const panel = row.closest('[role="complementary"]')
    const panelMoves = panel ? new MutationObserver(schedule) : null
    if (panel) {
      panelMoves?.observe(panel, { attributeFilter: ['style', 'data-gesture'] })
      observer.observe(panel)
    }

    return () => {
      cancelAnimationFrame(frame.current)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer.disconnect()
      panelMoves?.disconnect()
    }
  }, [place, row, schedule, viewportRef])

  // The row can grow — a stack opening below it — between one frame and the
  // next without any of the above firing first.
  useEffect(schedule)

  if (!row || !container) return null

  return createPortal(
    <div
      ref={markerRef}
      data-current-marker=""
      aria-hidden
      style={{ width: WIDTH, visibility: 'hidden' }}
      className="pointer-events-none fixed left-0 top-0 z-[2147483646] overflow-hidden"
    >
      <div
        style={{
          clipPath: [
            'polygon(',
            `0 0, ${INSIDE}px 0,`,
            `${INSIDE}px calc(50% - ${POINT_REACH}px),`,
            `100% 50%,`,
            `${INSIDE}px calc(50% + ${POINT_REACH}px),`,
            `${INSIDE}px 100%, 0 100%`,
            ')',
          ].join(' '),
        }}
        className="absolute inset-x-0 top-0 bg-ring"
      />
    </div>,
    container,
  )
}
