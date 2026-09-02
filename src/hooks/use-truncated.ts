import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Whether an element is currently clipping its own text, by either axis so a
 * single hook covers both `truncate` and `line-clamp-*`.
 *
 * Measured rather than assumed: a title only earns a tooltip when the panel is
 * actually too narrow for it, and the panel is resizable, so the answer has to
 * be re-asked whenever the element changes size or content.
 */
export function useTruncated<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [isTruncated, setTruncated] = useState(false)

  // A sub-pixel slack: fractional layout leaves scrollWidth a hair over
  // clientWidth on text that fits perfectly well.
  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return
    setTruncated(
      element.scrollWidth > element.clientWidth + 1 ||
        element.scrollHeight > element.clientHeight + 1,
    )
  }, [])

  // No dependency list: the text itself can change under a stable element, and
  // re-measuring settles on the same answer, so the extra pass costs a render
  // only when it does not.
  useEffect(measure)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure])

  return [ref, isTruncated] as const
}
