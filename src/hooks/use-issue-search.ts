import { useInfiniteQuery } from '@tanstack/react-query'

import { sendMessage, RequestError, type CachedSearchPage } from '@/lib/messages'

export const PAGE_SIZE = 30

/**
 * Caps how many pages stay resident. Each poll revalidates every retained page,
 * so this bounds both memory and rate-limit cost on long scrolls.
 */
const MAX_PAGES = 10

/** Matches every cached search, whichever saved query it came from. */
export const ISSUE_SEARCH_KEY = ['issue-search'] as const

export function issueSearchKey(query: string | null) {
  return [...ISSUE_SEARCH_KEY, query] as const
}

interface Options {
  query: string | null
  pollIntervalMs: number
  enabled: boolean
}

/**
 * GitHub exposes no push channel for search, so freshness comes from polling on
 * an interval. Every request goes to the service worker, which answers from its
 * shared IndexedDB cache and only reaches the network when this tab is the one
 * the user is looking at and the cached copy has aged out.
 */
export function useIssueSearch({ query, pollIntervalMs, enabled }: Options) {
  return useInfiniteQuery({
    queryKey: issueSearchKey(query),
    enabled: enabled && Boolean(query),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      sendMessage({
        type: 'search',
        q: query as string,
        first: PAGE_SIZE,
        after: pageParam,
      }),
    getNextPageParam: (lastPage: CachedSearchPage) =>
      lastPage.hasNextPage ? lastPage.endCursor : undefined,
    maxPages: MAX_PAGES,
    refetchInterval: pollIntervalMs > 0 ? pollIntervalMs : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // The worker owns freshness; asking it again is cheap but pointless within
    // this window.
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    // A refused token or a query GitHub will not parse fails the same way
    // however many times it is asked, so the worker says outright whether
    // trying again could change the answer.
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof RequestError && !error.retryable),
    // Keep the previous query's rows on screen while a new one loads instead of
    // flashing an empty list.
    placeholderData: (previous) => previous,
  })
}
