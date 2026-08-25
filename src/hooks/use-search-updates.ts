import { useEffect } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'

import { browser } from '@/lib/browser'
import type { BroadcastMessage, CachedSearchPage } from '@/lib/messages'
import { ISSUE_SEARCH_KEY, issueSearchKey } from './use-issue-search'

type SearchData = InfiniteData<CachedSearchPage, string | null>

/**
 * Applies results pushed by the service worker: whole pages after it
 * revalidates a query, and single rows after one is refreshed on demand.
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

      if (message?.type === 'item-updated') {
        // The row can be on screen under any query, and the same row can sit
        // in more than one, so every cached search is offered the update.
        queryClient.setQueriesData<SearchData>(
          { queryKey: ISSUE_SEARCH_KEY },
          (current) => {
            if (!current) return current

            let touched = false
            const pages = current.pages.map((page) => {
              const index = page.items.findIndex((item) => item.id === message.item.id)
              if (index === -1) return page

              touched = true
              const items = [...page.items]
              items[index] = message.item
              return { ...page, items }
            })

            return touched ? { ...current, pages } : current
          },
        )
      }
    }

    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [queryClient])
}
