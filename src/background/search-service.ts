import type { SearchPage } from '@/lib/github/types'
import type { EnrichmentResult, SearchParams } from '@/lib/github/api'
import type { ArrivedEnrichment } from '@/lib/github/enrichment'
import type { CachedSearchPage, EnrichmentUpdate, SearchUpdate } from '@/lib/messages'
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
  /** Reads the costly half of one batch of rows, keyed by node id. */
  enrichPage: (ids: readonly string[]) => Promise<EnrichmentResult>
  /**
   * Merging the two halves of a row, and carrying a known half across a
   * refetch. Passed in rather than imported because this module is run
   * directly by the test runner, which resolves no path alias.
   */
  merge: {
    apply: (page: SearchPage, arrived: ArrivedEnrichment) => SearchPage | null
    carry: (fresh: SearchPage, previous: SearchPage | undefined) => SearchPage
  }
  /** Network revalidation is limited to the tab the user is looking at. */
  isTabActive: (tabId: number | undefined) => Promise<boolean>
  broadcast: (update: SearchUpdate | EnrichmentUpdate) => void
  onError?: (error: unknown) => void
  now?: () => number
}

/**
 * How many rows the costly fields are read for at a time.
 *
 * Five, because the limit being worked around is a time limit rather than a
 * size one: measured against `org:`-wide searches a batch of five answers in
 * two to five seconds, ten in five to seven, and thirty not at all. The margin
 * is deliberately wide — a batch that overruns costs those rows their marks.
 */
export const ENRICH_BATCH = 5

/**
 * Which rows of a page to ask about.
 *
 * A page straight off the network is asked about in full, carried marks and
 * all: those came from the last refresh, and letting them stand for ever would
 * make the panel quietly stop reporting checks. A page served from the cache
 * is only asked about where a row never got an answer at all — the worker is
 * shut down between messages and can be stopped part way through one.
 */
function toEnrich(page: SearchPage, scope: 'all' | 'unanswered'): string[] {
  return page.items
    .filter((item) =>
      scope === 'all'
        ? item.kind === 'pull-request'
        : item.enrichment === 'pending',
    )
    .map((item) => item.id)
}

function batched(ids: readonly string[], size: number): string[][] {
  const batches: string[][] = []
  for (let start = 0; start < ids.length; start += size) {
    batches.push(ids.slice(start, start + size))
  }
  return batches
}

export interface SearchRequest extends SearchParams {
  tabId: number | undefined
  freshMs: number
}

export function createSearchService({
  store,
  fetchPage,
  enrichPage,
  merge,
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

  /**
   * Rows whose second request is already running. The same row is listed by
   * more than one query and sits on more than one page, and every one of them
   * would otherwise ask for it again.
   */
  const enriching = new Set<string>()

  /**
   * Reads the costly half of a page and merges it in, without the caller
   * waiting: the rows are already on screen, and this fills in their marks.
   *
   * Nothing here can fail loudly. A refusal, a timeout, a token that cannot
   * reach one repository — each costs the rows it covers their marks and
   * leaves the list alone, which is the entire reason the request is separate.
   */
  async function enrich(page: SearchPage, scope: 'all' | 'unanswered'): Promise<void> {
    const wanted = toEnrich(page, scope).filter((id) => !enriching.has(id))
    if (wanted.length === 0) return

    const publish = async (arrived: ArrivedEnrichment) => {
      await store.revisePages((cached) => merge.apply(cached, arrived))
      broadcast({ type: 'items-enriched', ...arrived })
    }

    for (const id of wanted) enriching.add(id)
    try {
      /*
       * One batch at a time, and each one published as it lands.
       *
       * Serial because GitHub is: it queues a single token's GraphQL requests
       * behind one another, so six at once finish no sooner than six in turn —
       * measured at 26s either way for a thirty-row page. In turn, though, the
       * first five rows get their marks after five seconds instead of every
       * row getting them after twenty-six.
       */
      for (const batch of batched(wanted, ENRICH_BATCH)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { enrichments, failedIds, error } = await enrichPage(batch)
          // eslint-disable-next-line no-await-in-loop
          await publish({ enrichments, failedIds })
          if (error) onError?.(new Error(`enrichment: ${error}`))
        } catch (error) {
          // One batch failing costs its own rows their marks and nothing else.
          // They stop waiting either way; a row that waits for ever is the one
          // failure the reader cannot see.
          // eslint-disable-next-line no-await-in-loop
          await publish({ enrichments: [], failedIds: batch })
          onError?.(error)
        }
      }
    } finally {
      for (const id of wanted) enriching.delete(id)
    }
  }

  /**
   * Enriches a page just written, then checks nothing was left waiting.
   *
   * The sweep is for the narrow overlap between two refreshes: a batch of one
   * can land between the other reading the cache and writing to it, putting
   * those rows back to waiting, and the run that answered for them holds their
   * ids until its last batch — so nothing asks again. By the time this runs
   * those ids are free, and one pass is enough, since whatever is still
   * waiting now has nothing left in flight to answer it.
   */
  async function enrichThenSweep(key: string, page: SearchPage): Promise<void> {
    await enrich(page, 'all')
    const entry = await store.read(key).catch(() => undefined)
    if (entry) await enrich(entry.page, 'unanswered')
  }

  async function fetchOnce(key: string, params: SearchParams): Promise<SearchPage> {
    const existing = inFlight.get(key)
    if (existing) return existing

    const request = (async () => {
      const fetched = await fetchPage(params)
      // Read after the fetch, not alongside it: a batch published during those
      // few seconds belongs to the rows this page is about to replace, and
      // reading first would write it back out as though it never answered.
      const previous = await store.read(key).catch(() => undefined)
      // Rows the last refresh already answered for keep their marks while this
      // one is asked about, so a poll does not blank the list and fill it in
      // again once a minute.
      const page = merge.carry(fetched, previous?.page)
      await store.write({
        key,
        query: params.q,
        page,
        updatedAt: now(),
      })
      // Deliberately not awaited: the page is what the caller is waiting for,
      // and the marks arrive over the broadcast channel when they arrive.
      void enrichThenSweep(key, page).catch((error: unknown) => onError?.(error))
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
        // A cached page can hold rows that never got their second request —
        // the worker is shut down between messages, and may have been stopped
        // part way through one. Serving it is the moment to finish the job.
        void enrich(entry.page, 'unanswered').catch((error: unknown) => onError?.(error))

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
