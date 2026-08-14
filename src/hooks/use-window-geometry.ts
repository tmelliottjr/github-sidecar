import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

import type { WindowState } from '@/lib/storage'
import { clamp } from '@/lib/utils'

export const MIN_WIDTH = 320
export const MIN_HEIGHT = 260
export const COLLAPSED_HEIGHT = 44
const EDGE_MARGIN = 16
/** Keeps at least this much of the window on screen and grabbable. */
const VISIBLE_STRIP = 80

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Resolves the sentinel `x: -1` to a right-aligned position. */
export function resolvePosition(state: WindowState): Rect {
  const width = clamp(state.width, MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth))
  const height = clamp(state.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight))
  const x = state.x < 0 ? window.innerWidth - width - EDGE_MARGIN : state.x
  return {
    width,
    height,
    x: clamp(x, VISIBLE_STRIP - width, window.innerWidth - VISIBLE_STRIP),
    y: clamp(state.y, 0, Math.max(0, window.innerHeight - COLLAPSED_HEIGHT)),
  }
}

interface Options {
  state: WindowState
  onCommit: (rect: Partial<WindowState>) => void
}

/**
 * Drives dragging and resizing. Geometry is written straight to the DOM node
 * during a gesture and only committed to storage on release, so a drag never
 * re-renders the list underneath it.
 */
export function useWindowGeometry({ state, onCommit }: Options) {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const rectRef = useRef<Rect>(resolvePosition(state))
  const gestureRef = useRef(false)

  // Keep the DOM in sync with committed state whenever no gesture is running.
  // Layout effect so the collapsed height is correct on the first paint.
  useLayoutEffect(() => {
    if (gestureRef.current) return
    const rect = resolvePosition(state)
    rectRef.current = rect
    apply(nodeRef.current, rect, state.collapsed)
  }, [state])

  useEffect(() => {
    const onResize = () => {
      if (gestureRef.current) return
      const rect = resolvePosition({ ...state, ...rectRef.current })
      rectRef.current = rect
      apply(nodeRef.current, rect, state.collapsed)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [state])

  const beginGesture = useCallback(
    (
      event: React.PointerEvent,
      compute: (deltaX: number, deltaY: number, origin: Rect) => Rect,
    ) => {
      if (state.locked) return
      event.preventDefault()
      event.stopPropagation()

      const origin = { ...rectRef.current }
      const startX = event.clientX
      const startY = event.clientY
      gestureRef.current = true

      const node = nodeRef.current
      node?.setAttribute('data-gesture', 'active')

      const onMove = (moveEvent: PointerEvent) => {
        const next = compute(moveEvent.clientX - startX, moveEvent.clientY - startY, origin)
        rectRef.current = next
        apply(node, next, state.collapsed)
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        gestureRef.current = false
        node?.removeAttribute('data-gesture')
        onCommit(rectRef.current)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [onCommit, state.collapsed, state.locked],
  )

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      beginGesture(event, (deltaX, deltaY, origin) => ({
        ...origin,
        // Keep a grabbable strip of the window on screen at all times.
        x: clamp(
          origin.x + deltaX,
          VISIBLE_STRIP - origin.width,
          window.innerWidth - VISIBLE_STRIP,
        ),
        y: clamp(origin.y + deltaY, 0, window.innerHeight - COLLAPSED_HEIGHT),
      }))
    },
    [beginGesture],
  )

  const startResize = useCallback(
    (event: React.PointerEvent, direction: ResizeDirection) => {
      if (state.collapsed) return
      beginGesture(event, (deltaX, deltaY, origin) => {
        const next = { ...origin }

        if (direction.includes('e')) {
          next.width = clamp(
            origin.width + deltaX,
            MIN_WIDTH,
            window.innerWidth - origin.x,
          )
        }
        if (direction.includes('w')) {
          const width = clamp(
            origin.width - deltaX,
            MIN_WIDTH,
            Math.max(MIN_WIDTH, origin.x + origin.width),
          )
          next.x = origin.x + origin.width - width
          next.width = width
        }
        if (direction.includes('s')) {
          next.height = clamp(
            origin.height + deltaY,
            MIN_HEIGHT,
            window.innerHeight - origin.y,
          )
        }
        if (direction.includes('n')) {
          const height = clamp(
            origin.height - deltaY,
            MIN_HEIGHT,
            Math.max(MIN_HEIGHT, origin.y + origin.height),
          )
          next.y = origin.y + origin.height - height
          next.height = height
        }
        return next
      })
    },
    [beginGesture, state.collapsed],
  )

  return { nodeRef, startDrag, startResize }
}

function apply(node: HTMLDivElement | null, rect: Rect, collapsed: boolean) {
  if (!node) return
  node.style.transform = `translate3d(${Math.round(rect.x)}px, ${Math.round(rect.y)}px, 0)`
  node.style.width = `${Math.round(rect.width)}px`
  node.style.height = collapsed ? `${COLLAPSED_HEIGHT}px` : `${Math.round(rect.height)}px`
}
