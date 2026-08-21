import { useEffect, useMemo, useState } from 'react'

import type { SearchItem } from '@/lib/github/types'
import { sendMessage } from '@/lib/messages'

/**
 * Resolves node ids to the rows behind them, best-effort, from the worker's
 * shared cache. The management panel keeps only ids — a hidden row, a reminder,
 * a pin are each just a node id — so the title, repository and link they show
 * have to be looked up from wherever the panel last saw the row.
 *
 * A row the cache has since dropped resolves to nothing: the panel still lists
 * it by id and can still act on it, because bringing it back, dropping its
 * reminder or lifting its pin needs only the id.
 */
export function useItemLookup(ids: readonly string[]): Record<string, SearchItem> {
  const [items, setItems] = useState<Record<string, SearchItem>>({})
  // Sorted and de-duplicated, so the same rows in a fresh array — which every
  // storage change hands back — do not set off another lookup.
  const key = useMemo(() => [...new Set(ids)].toSorted().join('\u0000'), [ids])

  useEffect(() => {
    const wanted = key ? key.split('\u0000') : []
    if (wanted.length === 0) {
      setItems({})
      return
    }

    let active = true
    void sendMessage({ type: 'lookup-items', ids: wanted })
      .then((found) => {
        if (!active) return
        const next: Record<string, SearchItem> = {}
        for (const item of found ?? []) next[item.id] = item
        setItems(next)
      })
      .catch(() => {
        if (active) setItems({})
      })

    return () => {
      active = false
    }
  }, [key])

  return items
}
