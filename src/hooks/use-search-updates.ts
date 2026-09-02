import { useEffect } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'

import { mergeEnrichments } from '@/lib/github/enrichment'
import type { SearchPage } from '@/lib/github/types'
import type { BroadcastMessage, CachedSearchPage } from '@/lib/messages'
import { ISSUE_SEARCH_KEY, issueSearchKey } from './use-issue-search'

type SearchData = InfiniteData<CachedSearchPage, string | null>

/** Swaps one refreshed row in, or returns null if the page does not hold it. */
function replaceItem(page: SearchPage, item: SearchPage['items'][number]): SearchPage | null {
  const index = page.items.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) return null

  const items = [...page.items]
  items[index] = item
  return { ...page, items }
}

/**
 * Applies results pushed by the service worker: whole pages after it
 * revalidates a query, single rows after one is refreshed on demand, and the
 * costly half of a page as it lands.
 *
 * Only the active tab triggers a network refresh; every other tab picks the
 * result up from here rather than making its own request. A row refreshed in
 * one tab therefore updates in all of them.
 */
export function useSearchUpdates(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const listener = (message: BroadcastMessage) => {
      if (message?.type === 'search-updated') {
        queryClient.setQueryData<SearchData>(issueSearchKey(message.query), (current) => {
          if (!current) return current

          const index = current.pageParams.findIndex(
            (param) => (param ?? null) === message.after,
          )
          if (index === -1) return current

          const pages = [...current.pages]
          pages[index] = { ...message.page, source: 'network', revalidating: false }
          return { ...current, pages }
        })
        return
      }

      /**
       * Both remaining kinds rewrite rows in place. The row can be on screen
       * under any query, and the same row can sit in more than one, so every
       * cached search is offered them.
       */
      const revise =
        message?.type === 'item-updated'
          ? (page: CachedSearchPage) => replaceItem(page, message.item)
          : message?.type === 'items-enriched'
            ? (page: CachedSearchPage) => mergeEnrichments(page, message)
            : null
      if (!revise) return

      queryClient.setQueriesData<SearchData>({ queryKey: ISSUE_SEARCH_KEY }, (current) => {
        if (!current) return current

        let touched = false
        const pages = current.pages.map((page) => {
          const revised = revise(page)
          if (!revised) return page
          touched = true
          return { ...page, items: revised.items }
        })

        return touched ? { ...current, pages } : current
      })
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [queryClient])
}
