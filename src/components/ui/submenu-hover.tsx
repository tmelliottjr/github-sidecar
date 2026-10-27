import * as React from 'react'

type SubHover = {
  /** Cancel a pending close (pointer re-entered the trigger or submenu). */
  keepOpen: () => void
  /** Close the submenu shortly, unless the pointer comes back first. */
  closeSoon: () => void
}

/** Shared by a submenu's trigger and content, so either can hold it open. */
export const SubHoverContext = React.createContext<SubHover | null>(null)

/**
 * How long to wait after the pointer leaves a submenu before closing it. Long
 * enough to cross the small gap toward an adjacent submenu (Radix's safe
 * triangle), short enough that leaving to empty space feels responsive.
 */
const SUB_CLOSE_DELAY_MS = 250

/** Run the caller's pointer handler, then the hover-intent one (mouse only). */
export function composeMousePointer(
  original: ((event: React.PointerEvent<HTMLDivElement>) => void) | undefined,
  next: (() => void) | undefined,
) {
  return (event: React.PointerEvent<HTMLDivElement>) => {
    original?.(event)
    if (event.pointerType === 'mouse') next?.()
  }
}

/**
 * Radix closes a submenu only when a sibling item steals focus, on Escape, or
 * via the keyboard — never when the pointer just leaves it for empty space
 * (e.g. the underlying github.com page), which leaves it looking stuck. This
 * makes the Sub controlled and closes it a beat after the pointer leaves,
 * cancelling that timer whenever the pointer re-enters the trigger or the
 * submenu content so open-on-hover and safe-triangle traversal still work.
 *
 * Pass `open` and `onOpenChange` to the Radix `Sub`, and provide `hover`
 * through `SubHoverContext` to its trigger and content.
 */
export function useSubmenuHover(onOpenChange: ((open: boolean) => void) | undefined) {
  const [open, setOpen] = React.useState(false)
  const closeTimer = React.useRef<number | null>(null)

  const keepOpen = React.useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      keepOpen()
      setOpen(next)
      onOpenChange?.(next)
    },
    [keepOpen, onOpenChange],
  )

  const hover = React.useMemo<SubHover>(
    () => ({
      keepOpen,
      closeSoon: () => {
        keepOpen()
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = null
          handleOpenChange(false)
        }, SUB_CLOSE_DELAY_MS)
      },
    }),
    [keepOpen, handleOpenChange],
  )

  React.useEffect(() => keepOpen, [keepOpen])

  return { open, onOpenChange: handleOpenChange, hover }
}
