import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Github, PanelLeftOpen } from 'lucide-react'

import { Hint } from '@/components/ui/tooltip'
import { cn, clamp } from '@/lib/utils'

const MIN_DOCK_WIDTH = 280
const MAX_DOCK_WIDTH = 720

/** Never let the dock take more than half the viewport. */
export function clampDockWidth(width: number): number {
  const ceiling = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, window.innerWidth / 2))
  return clamp(width, MIN_DOCK_WIDTH, ceiling)
}

interface Props {
  width: number
  /** Viewport y the panel starts at, just below the page's own top chrome. */
  top: number
  onWidthChange: (width: number) => void
  header: ReactNode
  children: ReactNode
}

/**
 * The panel in docked mode: pinned to the left edge, filling the page's gutter
 * from the bottom of github.com's header down to the bottom of the viewport.
 * Its top edge is remeasured as the page scrolls, so it stays tucked under
 * whatever chrome github.com currently has at the top.
 * Only the inner edge resizes, and like the floating window the new width is
 * written straight to the DOM during the drag and committed on release.
 */
export function DockedPanel({ width, top, onWidthChange, header, children }: Props) {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const widthRef = useRef(clampDockWidth(width))

  useLayoutEffect(() => {
    widthRef.current = clampDockWidth(width)
    if (nodeRef.current) nodeRef.current.style.width = `${widthRef.current}px`
  }, [width])

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const node = nodeRef.current
      const origin = widthRef.current
      const startX = event.clientX
      node?.setAttribute('data-gesture', 'active')

      const onMove = (moveEvent: PointerEvent) => {
        const next = clampDockWidth(origin + moveEvent.clientX - startX)
        widthRef.current = next
        if (node) node.style.width = `${next}px`
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        node?.removeAttribute('data-gesture')
        onWidthChange(widthRef.current)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onWidthChange],
  )

  return (
    <div
      ref={nodeRef}
      role="complementary"
      aria-label="GitHub Sidecar"
      data-docked=""
      className={cn(
        'fixed bottom-0 left-0 z-[2147483646] flex flex-col overflow-hidden',
        // A hairline plus a soft shadow off the inner edge: the panel and the
        // page are both white, so a border alone reads as an accident.
        'border-r border-border bg-background text-foreground shadow-dock',
        'data-[gesture=active]:select-none',
      )}
      style={{ top, width: widthRef.current }}
    >
      {header}

      <div className="min-h-0 flex-1">{children}</div>

      <div
        onPointerDown={startResize}
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize touch-none"
        aria-hidden
      />
    </div>
  )
}

/** Width of the collapsed rail. Narrow enough to fit any page's gutter. */
export const DOCK_RAIL_WIDTH = 44

interface RailProps {
  top: number
  /** Name of the active query, so the rail says what it is holding. */
  label: string
  /** Total matches, or null while nothing has loaded yet. */
  count: number | null
  onExpand: () => void
}

/**
 * The dock with the panel put away: a rail down the edge of the gutter.
 *
 * Putting the panel away has to get it out of the way without hiding it,
 * otherwise there is nothing left to click to bring it back and the only route
 * to it is the browser's own extensions menu. The rail is small enough to fit
 * in any page's gutter — so the page is barely moved for it — while still
 * being a target the whole height of the viewport. It stands in both for a
 * dock that was collapsed and for one that has not been opened in this tab
 * yet, and it keeps reporting the result count whenever there is one, which is
 * the point of leaving it on screen at all.
 */
export function DockRail({ top, label, count, onExpand }: RailProps) {
  return (
    <Hint label={`Expand ${label}`} side="right">
      <button
        type="button"
        onClick={onExpand}
        aria-expanded={false}
        aria-label={`Expand ${label}`}
        className={cn(
          'group fixed bottom-0 left-0 z-[2147483646] flex flex-col items-center gap-2 py-3',
          'border-r border-border bg-background text-foreground shadow-dock',
          'transition-colors hover:bg-accent',
        )}
        style={{ top, width: DOCK_RAIL_WIDTH }}
      >
        <Github className="size-4 shrink-0 text-muted-foreground" />

        {count !== null && count > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-bold tabular-nums text-muted-foreground">
            {count > 99 ? '99+' : count}
          </span>
        )}

        {/*
         * Kept with the other marks at the top, where the panel's header was
         * and so where anyone looking for it will look, rather than stranded
         * at the far end of a rail the height of the viewport.
         */}
        <PanelLeftOpen className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </button>
    </Hint>
  )
}
