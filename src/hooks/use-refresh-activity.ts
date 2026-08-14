import { useEffect, useRef, useState } from 'react'

/**
 * How long the indicator stays up once raised. A refresh answered from a warm
 * cache can be over in tens of milliseconds, and a bar that appears and
 * vanishes inside one frame reads as a glitch rather than as progress.
 */
const MIN_VISIBLE_MS = 400

/**
 * A revalidation that fails is only logged in the worker — no `search-updated`
 * broadcast is ever sent, so the page it was refreshing keeps its
 * `revalidating` flag for as long as it stays cached. Without a ceiling the
 * indicator would simply never come down again.
 */
const MAX_VISIBLE_MS = 20_000

/**
 * Smooths a raw "something is in flight" signal into one that is worth showing
 * a user: never so brief that it flickers, never so long that a refresh which
 * quietly died leaves the panel claiming to be busy forever.
 */
export function useRefreshActivity(active: boolean): boolean {
  const [visible, setVisible] = useState(false)
  const raisedAt = useRef(0)

  useEffect(() => {
    if (active) {
      raisedAt.current = Date.now()
      setVisible(true)
      const ceiling = setTimeout(() => setVisible(false), MAX_VISIBLE_MS)
      return () => clearTimeout(ceiling)
    }

    const remaining = MIN_VISIBLE_MS - (Date.now() - raisedAt.current)
    if (remaining <= 0) {
      setVisible(false)
      return
    }

    const hold = setTimeout(() => setVisible(false), remaining)
    return () => clearTimeout(hold)
  }, [active])

  return visible
}
