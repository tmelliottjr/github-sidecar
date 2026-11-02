import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  DOCK_GAP,
  DOCK_INSET,
  clearReservation,
  measureContentTop,
  reserveGutter,
} from '@/content/page-layout'

interface Options {
  /** Whether the panel is on screen, or null while that is still loading. */
  enabled: boolean | null
  width: number
}

/**
 * Keeps the docked panel aligned with the host page, and reserves room for it
 * when the page's own gutter is too narrow to hold it. Returns the viewport y
 * of the bottom of github.com's header, which the panel floats just below.
 *
 * The panel always sits below github.com's own chrome, whether it found room
 * or had to take it: the header goes on spanning the window and the panel
 * reads as part of the site rather than as an overlay. It stays there as the
 * page scrolls, which is a matter of remeasuring rather than of holding still —
 * github.com's header scrolls away and a mini header pins in its place, and
 * the panel's top edge has to follow.
 *
 * The two measurements run on different schedules because they cost very
 * different amounts. The vertical offset changes whenever github.com's header
 * pins or unpins, so it is remeasured on every scroll and its probe is
 * deliberately shallow. Measuring the gutter forces a layout, and only a
 * resize or a navigation can change the answer, so it stays off the scroll
 * path entirely.
 *
 * Measures before paint, so a panel that has just opened is already in its
 * final place when Motion reads where its morph ends.
 *
 * Opening, closing, and resizing the panel move the page with it. Window
 * resizes and navigations do not, and neither does the first known state on
 * page load, which has nothing to move from.
 */
export function useDockLayout({ enabled, width }: Options): number {
  const [contentTop, setContentTop] = useState(0)
  const hasRun = useRef(false)

  useLayoutEffect(() => {
    if (enabled === null) return
    const move = hasRun.current
    hasRun.current = true

    if (!enabled) {
      clearReservation({ move })
      // A navigation or a resize lands a move at once: the bars it holds may
      // have been replaced, and the panel has stopped morphing.
      const land = () => clearReservation()
      window.addEventListener('resize', land)
      document.addEventListener('turbo:load', land)
      document.addEventListener('pjax:end', land)
      return () => {
        window.removeEventListener('resize', land)
        document.removeEventListener('turbo:load', land)
        document.removeEventListener('pjax:end', land)
      }
    }

    let frame = 0
    const syncTop = () => {
      frame = 0
      setContentTop(measureContentTop())
    }
    const scheduleTop = () => {
      if (frame === 0) frame = requestAnimationFrame(syncTop)
    }

    const syncAll = () => {
      setContentTop(reserveGutter(DOCK_INSET + width + DOCK_GAP).contentTop)
    }

    setContentTop(reserveGutter(DOCK_INSET + width + DOCK_GAP, { move }).contentTop)

    window.addEventListener('scroll', scheduleTop, { passive: true })
    window.addEventListener('resize', syncAll)
    document.addEventListener('turbo:load', syncAll)
    document.addEventListener('pjax:end', syncAll)

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleTop)
      window.removeEventListener('resize', syncAll)
      document.removeEventListener('turbo:load', syncAll)
      document.removeEventListener('pjax:end', syncAll)
    }
  }, [enabled, width])

  // Unmounting has to hand the page its space back too.
  useEffect(() => () => clearReservation(), [])

  return contentTop
}
