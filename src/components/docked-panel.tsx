import { useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'

import { DOCK_INSET } from '@/content/page-layout'
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
  /** Viewport y of the bottom of github.com's header, which the panel floats below. */
  top: number
  onWidthChange: (width: number) => void
  header: ReactNode
  children: ReactNode
}

/**
 * The panel: a card in the page gutter, inset from the left edge, the bottom
 * of the viewport, and github.com's header above it. Its top edge is
 * remeasured as the page scrolls, so it stays below whatever chrome
 * github.com currently has at the top.
 * Only the inner edge resizes. The new width is written straight to the DOM
 * during the drag and committed on release, so a drag never re-renders the list.
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
        'fixed z-[2147483646] flex flex-col overflow-hidden',
        'rounded-window border border-border bg-background text-foreground shadow-window',
        'data-[gesture=active]:select-none',
      )}
      style={{
        top: top + DOCK_INSET,
        left: DOCK_INSET,
        bottom: DOCK_INSET,
        width: widthRef.current,
      }}
    >
      {header}

      <div className="min-h-0 flex-1">{children}</div>

      <div
        onPointerDown={startResize}
        className="absolute inset-y-3 right-0 z-10 w-1.5 cursor-ew-resize touch-none"
        aria-hidden
      />
    </div>
  )
}
