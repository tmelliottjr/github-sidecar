import type { SearchPage } from '@/lib/github/types'
import type { SearchParams } from '@/lib/github/api'
import type { CachedSearchPage, SearchUpdate } from '@/lib/messages'
import type { CacheStore } from './cache'

/** Cursors are opaque, so a null cursor marks the first page. */
export function cacheKey(query: string, cursor: string | null | undefined): string {
  return `${query}\u0000${cursor ?? ''}`
}

/** Entries older than this are dropped on startup. */
export const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000

/** Freshness floor, so a very short poll interval cannot flood the API. */
const MIN_FRESH_MS = 15_000

/** Freshness window used when background polling is switched off. */
const IDLE_FRESH_MS = 5 * 60_000

/**
 * How long a cached page is served without any network call. Derived from the
 * user's chosen refresh cadence: that is precisely how current they asked the
 * data to be.
 */
export function freshnessWindow(pollIntervalMs: number): number {
  if (pollIntervalMs <= 0) return IDLE_FRESH_MS
  return Math.max(pollIntervalMs, MIN_FRESH_MS)
}

export interface SearchServiceDeps {
  store: CacheStore
  fetchPage: (params: SearchParams) => Promise<SearchPage>
  /** Network revalidation is limited to the tab the user is looking at. */
  isTabActive: (tabId: number | undefined) => Promise<boolean>
  broadcast: (update: SearchUpdate) => void
  onError?: (error: unknown) => void
  now?: () => number
}

export interface SearchRequest extends SearchParams {
  tabId: number | undefined
  freshMs: number
}

export function createSearchService({
  store,
  fetchPage,
  isTabActive,
  broadcast,
  onError,
  now = Date.now,
}: SearchServiceDeps) {
  /**
   * Coalesces identical concurrent requests. Ten github.com tabs opening at
   * once therefore produce a single API call rather than ten.
   */
  const inFlight = new Map<string, Promise<SearchPage>>()

  async function fetchOnce(key: string, params: SearchParams): Promise<SearchPage> {
    const existing = inFlight.get(key)
    if (existing) return existing

    const request = (async () => {
      const page = await fetchPage(params)
      await store.write({
        key,
        query: params.q,
        page,
        updatedAt: now(),
      })
      return page
    })()

    inFlight.set(key, request)
    try {
      return await request
    } finally {
      inFlight.delete(key)
    }
  }

  function revalidate(key: string, params: SearchParams) {
    void fetchOnce(key, params)
      .then((page) => {
        // Push the result to every open tab so they update without each
        // issuing their own request.
        broadcast({
          type: 'search-updated',
          query: params.q,
          after: params.after ?? null,
          page,
        })
      })
      .catch((error: unknown) => {
        // The caller already has cached data, so a failed refresh is not fatal.
        onError?.(error)
      })
  }

  return {
    async search({ tabId, freshMs, ...params }: SearchRequest): Promise<CachedSearchPage> {
      const key = cacheKey(params.q, params.after)
      const entry = await store.read(key).catch((error: unknown) => {
        onError?.(error)
        return undefined
      })

      if (entry) {
        const isFresh = now() - entry.updatedAt < freshMs
        if (isFresh) {
          return { ...entry.page, source: 'cache', revalidating: false }
        }

        // Stale, but there is something to show. Serve it immediately and only
        // refresh if the user is actually looking at this tab.
        if (await isTabActive(tabId)) {
          revalidate(key, params)
          return { ...entry.page, source: 'cache', revalidating: true }
        }
        return { ...entry.page, source: 'cache', revalidating: false }
      }

      const page = await fetchOnce(key, params)
      return { ...page, source: 'network', revalidating: false }
    },

    async invalidate(query: string): Promise<void> {
      await store.deleteQuery(query)
    },
  }
}

export type SearchService = ReturnType<typeof createSearchService>
