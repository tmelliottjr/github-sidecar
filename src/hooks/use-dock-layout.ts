import { useEffect, useState } from 'react'

import {
  DOCK_GAP,
  DOCK_INSET,
  clearReservation,
  measureContentTop,
  reserveGutter,
} from '@/content/page-layout'

interface Options {
  enabled: boolean
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
 */
export function useDockLayout({ enabled, width }: Options): number {
  const [contentTop, setContentTop] = useState(0)

  useEffect(() => {
    if (!enabled) {
      clearReservation()
      return
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

    syncAll()

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
