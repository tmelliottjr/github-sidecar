import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { replaceItem, type CacheEntry, type CacheStore } from '../src/background/cache.ts'
import {
  cacheKey,
  createSearchService,
  freshnessWindow,
} from '../src/background/search-service.ts'
import type { SearchPage } from '../src/lib/github/types.ts'
import type { SearchUpdate } from '../src/lib/messages.ts'

function makePage(overrides: Partial<SearchPage> = {}): SearchPage {
  return {
    items: [],
    totalCount: 1,
    endCursor: 'CURSOR',
    hasNextPage: false,
    fetchedAt: 1000,
    warning: null,
    ...overrides,
  }
}

function createMemoryStore(seed: CacheEntry[] = []) {
  const entries = new Map(seed.map((entry) => [entry.key, entry]))
  const store: CacheStore & { entries: Map<string, CacheEntry> } = {
    entries,
    async read(key) {
      return entries.get(key)
    },
    async write(entry) {
      entries.set(entry.key, entry)
    },
    async deleteQuery(query) {
      for (const [key, entry] of entries) {
        if (entry.query === query) entries.delete(key)
      }
    },
    async prune() {},
    async updateItem(item) {
      let changed = 0
      for (const [key, entry] of entries) {
        const page = replaceItem(entry.page, item)
        if (!page) continue
        entries.set(key, { ...entry, page })
        changed += 1
      }
      return changed
    },
  }
  return store
}

interface Harness {
  fetchCalls: number
  broadcasts: SearchUpdate[]
  activeTabs: Set<number>
}

function createHarness(
  options: { seed?: CacheEntry[]; now?: () => number; page?: SearchPage } = {},
) {
  const state: Harness = { fetchCalls: 0, broadcasts: [], activeTabs: new Set([1]) }
  const store = createMemoryStore(options.seed)

  const service = createSearchService({
    store,
    fetchPage: async () => {
      state.fetchCalls += 1
      return options.page ?? makePage({ fetchedAt: 9999 })
    },
    isTabActive: async (tabId) => tabId == null || state.activeTabs.has(tabId),
    broadcast: (update) => state.broadcasts.push(update),
    now: options.now ?? (() => 10_000),
  })

  return { service, store, state }
}

const QUERY = 'is:open is:pr'

function seedEntry(updatedAt: number, page = makePage()): CacheEntry {
  return { key: cacheKey(QUERY, null), query: QUERY, page, updatedAt }
}

describe('freshnessWindow', () => {
  it('tracks the chosen poll interval', () => {
    assert.equal(freshnessWindow(60_000), 60_000)
  })

  it('applies a floor so a fast interval cannot flood the API', () => {
    assert.equal(freshnessWindow(1000), 15_000)
  })

  it('uses a long window when polling is disabled', () => {
    assert.equal(freshnessWindow(0), 5 * 60_000)
  })
})

describe('search service', () => {
  let request: { q: string; first: number; after: null; freshMs: number }

  beforeEach(() => {
    request = { q: QUERY, first: 30, after: null, freshMs: 60_000 }
  })

  it('serves a fresh cache entry without touching the network', async () => {
    const { service, state } = createHarness({
      seed: [seedEntry(9500)],
      now: () => 10_000,
    })

    const result = await service.search({ ...request, tabId: 1 })

    assert.equal(state.fetchCalls, 0)
    assert.equal(result.source, 'cache')
    assert.equal(result.revalidating, false)
  })

  it('fetches when nothing is cached', async () => {
    const { service, state } = createHarness()

    const result = await service.search({ ...request, tabId: 1 })

    assert.equal(state.fetchCalls, 1)
    assert.equal(result.source, 'network')
    assert.equal(result.fetchedAt, 9999)
  })

  it('stores what it fetches so the next tab is served from cache', async () => {
    const { service, store, state } = createHarness()

    await service.search({ ...request, tabId: 1 })
    const second = await service.search({ ...request, tabId: 1 })

    assert.equal(state.fetchCalls, 1)
    assert.equal(second.source, 'cache')
    assert.ok(store.entries.has(cacheKey(QUERY, null)))
  })

  it('coalesces concurrent requests from many tabs into one call', async () => {
    const { service, state } = createHarness()

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        service.search({ ...request, tabId: index + 1 }),
      ),
    )

    // Ten tabs opening at once must not produce ten API calls.
    assert.equal(state.fetchCalls, 1)
    assert.equal(results.length, 10)
  })

  it('serves stale data and revalidates for the active tab', async () => {
    const { service, state } = createHarness({
      seed: [seedEntry(1000, makePage({ fetchedAt: 1000 }))],
      now: () => 100_000,
    })

    const result = await service.search({ ...request, tabId: 1 })

    // The cached copy comes back immediately...
    assert.equal(result.source, 'cache')
    assert.equal(result.revalidating, true)
    assert.equal(result.fetchedAt, 1000)

    // ...and the refresh lands afterwards, pushed to every tab.
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(state.fetchCalls, 1)
    assert.equal(state.broadcasts.length, 1)
    assert.equal(state.broadcasts[0].query, QUERY)
    assert.equal(state.broadcasts[0].page.fetchedAt, 9999)
  })

  it('never revalidates for a tab the user is not looking at', async () => {
    const { service, state } = createHarness({
      seed: [seedEntry(1000)],
      now: () => 100_000,
    })
    state.activeTabs.clear()

    const result = await service.search({ ...request, tabId: 7 })

    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(state.fetchCalls, 0)
    assert.equal(state.broadcasts.length, 0)
    assert.equal(result.source, 'cache')
    assert.equal(result.revalidating, false)
  })

  it('still fetches for a background tab that has no cached data', async () => {
    const { service, state } = createHarness()
    state.activeTabs.clear()

    const result = await service.search({ ...request, tabId: 7 })

    // There is nothing to show otherwise, and the call is deduplicated.
    assert.equal(state.fetchCalls, 1)
    assert.equal(result.source, 'network')
  })

  it('keeps serving cached data when a revalidation fails', async () => {
    const store = createMemoryStore([seedEntry(1000)])
    const errors: unknown[] = []
    const service = createSearchService({
      store,
      fetchPage: async () => {
        throw new Error('rate limited')
      },
      isTabActive: async () => true,
      broadcast: () => assert.fail('should not broadcast a failed refresh'),
      onError: (error) => errors.push(error),
      now: () => 100_000,
    })

    const result = await service.search({ ...request, tabId: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(result.source, 'cache')
    assert.equal(errors.length, 1)
  })

  it('caches each page of a query separately', async () => {
    const { service, store, state } = createHarness()

    await service.search({ ...request, tabId: 1 })
    await service.search({ ...request, after: 'CURSOR', tabId: 1 } as never)

    assert.equal(state.fetchCalls, 2)
    assert.equal(store.entries.size, 2)
    assert.ok(store.entries.has(cacheKey(QUERY, null)))
    assert.ok(store.entries.has(cacheKey(QUERY, 'CURSOR')))
  })

  it('drops every page of a query on invalidate', async () => {
    const { service, store, state } = createHarness()

    await service.search({ ...request, tabId: 1 })
    await service.search({ ...request, after: 'CURSOR', tabId: 1 } as never)
    await service.invalidate(QUERY)

    assert.equal(store.entries.size, 0)

    // A refresh after invalidating must hit the network again.
    await service.search({ ...request, tabId: 1 })
    assert.equal(state.fetchCalls, 3)
  })
})
