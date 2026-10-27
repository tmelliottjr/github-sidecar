import { useLayoutEffect, useRef } from 'react'

/** Matches `--ease-stack`, so the morph moves like the rest of the panel. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const DURATION = 420
/** The target fades in over the end of the morph, once the shell has nearly arrived. */
const REVEAL = 160
/** A copy of what was showing fades out over the start, riding inside the shell. */
const FADE_OUT = 150

/** Where a morph starts: the box of an element that is about to unmount. */
export interface MorphOrigin {
  left: number
  top: number
  width: number
  height: number
  /** A `border-radius` value with all four corners, since a tab rounds only its outer side. */
  radius: string
  /** A copy of the element, faded out as the shell starts to move. */
  copy: HTMLElement
  /**
   * Scroll offsets for the scrolled elements in the copy. A clone starts
   * scrolled to the top, and offsets only apply once it is in the document.
   */
  scrolls: Array<{ node: Element; top: number; left: number }>
}

/**
 * Reads where a morph starts from an element that is about to unmount, and
 * keeps a clone of it to fade out inside the shell. The clone loses its ids,
 * roles, and `aria-*` and `data-*` attributes, so nothing that looks the
 * original up by them can find the copy instead.
 */
export function captureOrigin(element: HTMLElement): MorphOrigin {
  const rect = element.getBoundingClientRect()
  const copy = element.cloneNode(true) as HTMLElement
  const originals = [element, ...element.querySelectorAll('*')]
  const nodes = [copy, ...copy.querySelectorAll('*')]
  const scrolls = originals.flatMap((original, index) =>
    original.scrollTop || original.scrollLeft
      ? [{ node: nodes[index], top: original.scrollTop, left: original.scrollLeft }]
      : [],
  )

  for (const node of nodes) {
    // A snapshot, since removing from the live attribute list skips entries.
    for (const name of Array.from(node.attributes, (attribute) => attribute.name)) {
      if (name === 'id' || name === 'role' || /^(aria|data)-/.test(name)) {
        node.removeAttribute(name)
      }
    }
    // A clone replays CSS entrances from the start, which would fade the
    // copied rows in from nothing while the copy fades out.
    if (node instanceof HTMLElement || node instanceof SVGElement) {
      node.style.animation = 'none'
    }
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    radius: radiusOf(element, rect),
    copy,
    scrolls,
  }
}

function radiusOf(element: Element, rect: DOMRect): string {
  const style = getComputedStyle(element)
  const limit = Math.min(rect.width, rect.height) / 2
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
    .map((corner) => `${Math.min(parseFloat(corner) || 0, limit)}px`)
    .join(' ')
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

    // Pinned to the top-left corner of the shell, so the shell clips it while
    // it moves rather than leaving it to fade where it was.
    const copy = origin.copy
    const border = parseFloat(getComputedStyle(shell).borderTopWidth) || 0
    copy.inert = true
    Object.assign(copy.style, {
      position: 'absolute',
      left: `${-border}px`,
      top: `${-border}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${origin.width}px`,
      height: `${origin.height}px`,
      margin: '0',
    })
    shell.append(copy)
    for (const { node, top, left } of origin.scrolls) {
      node.scrollTop = top
      node.scrollLeft = left
    }
    animations.push(
      copy.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_OUT,
        easing: 'ease-out',
        fill: 'forwards',
      }),
    )

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
            borderRadius: origin.radius,
          },
          {
            left: `${box.left}px`,
            top: `${box.top}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            borderRadius: radiusOf(end, box),
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
      copy.remove()
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
