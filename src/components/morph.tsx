import { useLayoutEffect, useRef } from 'react'

/** Matches `--ease-stack`, so the morph moves like the rest of the panel. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const DURATION = 420
/** The target fades in over the end of the morph, once the shell has nearly arrived. */
const REVEAL = 160
/** A copy of what was showing fades out over the start. */
const FADE_OUT = 120

/** Where a morph starts: the box of an element that is about to unmount. */
export interface MorphOrigin {
  left: number
  top: number
  width: number
  height: number
  radius: number
  /** A copy of the element, faded out as the shell starts to move. */
  copy: HTMLElement | null
}

/**
 * Reads where a morph starts from an element that is about to unmount.
 *
 * With `keepCopy`, a clone of the element is kept to fade out in place. The
 * clone loses its ids, roles, and `aria-*` and `data-*` attributes, so nothing
 * that looks the original up by them can find the copy instead.
 */
export function captureOrigin(element: HTMLElement, keepCopy: boolean): MorphOrigin {
  const rect = element.getBoundingClientRect()
  let copy: HTMLElement | null = null

  if (keepCopy) {
    copy = element.cloneNode(true) as HTMLElement
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      // A snapshot, since removing from the live attribute list skips entries.
      for (const name of Array.from(node.attributes, (attribute) => attribute.name)) {
        if (name === 'id' || name === 'role' || /^(aria|data)-/.test(name)) {
          node.removeAttribute(name)
        }
      }
    }
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    radius: radiusOf(element, rect),
    copy,
  }
}

function radiusOf(element: Element, rect: DOMRect): number {
  const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
  return Math.min(radius, rect.width / 2, rect.height / 2)
}

/** Jumps entrances still running on the target, or on anything around it, to their end. */
function settle(target: Element, root: Document | ShadowRoot, own: Animation[]): void {
  for (const animation of root.getAnimations()) {
    if (own.includes(animation)) continue
    const effect = animation.effect
    const element = effect instanceof KeyframeEffect ? effect.target : null
    if (!element?.contains(target)) continue
    // Spinners loop forever, and finishing an endless animation throws.
    if (effect?.getComputedTiming().endTime === Infinity) continue
    animation.finish()
  }
}

interface Props {
  origin: MorphOrigin
  /** Selector for the element the morph ends on, in the same shadow root. */
  target: string
  /** Handler that is called when the morph has finished or has nothing to end on. */
  onDone: () => void
}

/**
 * A container transform: a blank shell moves from one box to another while
 * the old contents fade out and the target fades in over the end.
 *
 * Must render before the target, so the target paints over the shell as it
 * fades in. The target is hidden from its first paint, and the shell waits two
 * frames before it moves, so a docked panel has measured the page and settled
 * where it will stay.
 */
export function Morph({ origin, target, onDone }: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const onDoneRef = useRef(onDone)

  useLayoutEffect(() => {
    onDoneRef.current = onDone
  })

  useLayoutEffect(() => {
    const shell = shellRef.current
    const root = shell?.getRootNode()
    const end =
      root instanceof ShadowRoot || root instanceof Document ? root.querySelector(target) : null
    if (!shell || !root || !(end instanceof HTMLElement)) {
      onDoneRef.current()
      return
    }

    const animations: Animation[] = []
    const reveal = end.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: REVEAL,
      delay: DURATION - REVEAL,
      easing: 'ease-out',
      fill: 'backwards',
    })
    reveal.pause()
    animations.push(reveal)

    const copy = origin.copy
    if (copy) {
      copy.inert = true
      Object.assign(copy.style, {
        position: 'fixed',
        left: `${origin.left}px`,
        top: `${origin.top}px`,
        width: `${origin.width}px`,
        height: `${origin.height}px`,
        margin: '0',
      })
      shell.append(copy)
      animations.push(
        copy.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: FADE_OUT,
          easing: 'ease-out',
          fill: 'forwards',
        }),
      )
    }

    const start = () => {
      settle(end, root as Document | ShadowRoot, animations)
      const box = end.getBoundingClientRect()
      const grow = shell.animate(
        [
          {
            left: `${origin.left}px`,
            top: `${origin.top}px`,
            width: `${origin.width}px`,
            height: `${origin.height}px`,
            borderRadius: `${origin.radius}px`,
          },
          {
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            borderRadius: `${radiusOf(end, box)}px`,
          },
        ],
        { duration: DURATION, easing: EASE, fill: 'forwards' },
      )
      animations.push(grow)
      reveal.play()
      grow.finished.then(
        () => onDoneRef.current(),
        // Cancelled by a newer morph or by unmounting, which own the cleanup.
        () => undefined,
      )
    }

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(start)
    })

    return () => {
      cancelAnimationFrame(frame)
      for (const animation of animations) animation.cancel()
      copy?.remove()
    }
  }, [origin, target])

  return (
    <div
      ref={shellRef}
      data-morph=""
      aria-hidden
      className="pointer-events-none fixed z-[2147483646] overflow-hidden border border-border bg-background shadow-window"
      style={{
        left: origin.left,
        top: origin.top,
        width: origin.width,
        height: origin.height,
        borderRadius: origin.radius,
      }}
    />
  )
}
