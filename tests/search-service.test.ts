import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import { replaceItem, type CacheEntry, type CacheStore } from '../src/background/cache.ts'
import {
  ENRICH_BATCH,
  cacheKey,
  createSearchService,
  freshnessWindow,
} from '../src/background/search-service.ts'
import {
  carryEnrichment,
  mergeEnrichments,
} from '../src/lib/github/enrichment.ts'
import type { EnrichmentResult } from '../src/lib/github/api.ts'
import type { ItemEnrichment, SearchItem, SearchPage } from '../src/lib/github/types.ts'
import type { EnrichmentUpdate, SearchUpdate } from '../src/lib/messages.ts'

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
    async readQuery(query) {
      return [...entries.values()].filter((entry) => entry.query === query)
    },
    async findItems(ids) {
      const wanted = new Set(ids)
      return [...entries.values()]
        .flatMap((entry) => entry.page.items)
        .filter((item) => wanted.has(item.id))
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
    async revisePages(revise) {
      let changed = 0
      for (const [key, entry] of entries) {
        const page = revise(entry.page)
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
  broadcasts: Array<SearchUpdate | EnrichmentUpdate>
  /** The ids each call to the second request was asked about. */
  enrichCalls: string[][]
  activeTabs: Set<number>
}

function createHarness(
  options: {
    seed?: CacheEntry[]
    now?: () => number
    page?: SearchPage
    enrich?: (ids: readonly string[]) => Promise<EnrichmentResult>
  } = {},
) {
  const state: Harness = {
    fetchCalls: 0,
    broadcasts: [],
    enrichCalls: [],
    activeTabs: new Set([1]),
  }
  const store = createMemoryStore(options.seed)
  const errors: unknown[] = []

  const service = createSearchService({
    store,
    fetchPage: async () => {
      state.fetchCalls += 1
      return options.page ?? makePage({ fetchedAt: 9999 })
    },
    enrichPage: async (ids) => {
      state.enrichCalls.push([...ids])
      return (
        options.enrich?.(ids) ?? {
          enrichments: ids.map(enrichmentFor),
          failedIds: [],
          error: null,
        }
      )
    },
    merge: { apply: mergeEnrichments, carry: carryEnrichment },
    isTabActive: async (tabId) => tabId == null || state.activeTabs.has(tabId),
    broadcast: (update) => state.broadcasts.push(update),
    onError: (error) => errors.push(error),
    now: options.now ?? (() => 10_000),
  })

  return { service, store, state, errors }
}

/** Enrichment runs after the caller has its page, so tests wait a turn. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function pullRequest(id: string, overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    id,
    kind: 'pull-request',
    number: 1,
    title: 'Fix the thing',
    url: `https://github.com/acme/app/pull/1`,
    repository: 'acme/app',
    authorLogin: 'octocat',
    authorAvatarUrl: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: 'open',
    stateReason: null,
    commentCount: 0,
    labels: [],
    labelCount: 0,
    reviewDecision: null,
    checkState: null,
    additions: null,
    deletions: null,
    headRefName: null,
    headRefOid: null,
    mergeState: null,
    failingChecks: [],
    checkCount: null,
    checksRead: 0,
    stack: null,
    enrichment: 'pending',
    ...overrides,
  }
}

/** What the second request answers with for one row. */
function enrichmentFor(id: string): ItemEnrichment {
  return {
    id,
    reviewDecision: 'APPROVED',
    checkState: 'SUCCESS',
    failingChecks: [],
    checkCount: 2,
    checksRead: 2,
    mergeState: 'clean',
    stack: null,
  }
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
    const [update] = state.broadcasts
    assert.equal(update.type, 'search-updated')
    assert.equal(update.query, QUERY)
    assert.equal(update.page.fetchedAt, 9999)
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
      enrichPage: async () => ({ enrichments: [], failedIds: [], error: null }),
      merge: { apply: mergeEnrichments, carry: carryEnrichment },
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

describe('the second request', () => {
  const request = { q: QUERY, first: 30, freshMs: 60_000 }

  const pendingPage = () =>
    makePage({ items: [pullRequest('PR_1'), pullRequest('PR_2')], fetchedAt: 9999 })

  it('does not keep the caller waiting for it', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { service, state } = createHarness({
      page: pendingPage(),
      enrich: async (ids) => {
        await gate
        return { enrichments: ids.map(enrichmentFor), failedIds: [], error: null }
      },
    })

    // The rows are handed over while the second request is still out.
    const result = await service.search({ ...request, tabId: 1 })

    assert.deepEqual(state.enrichCalls, [['PR_1', 'PR_2']])
    assert.deepEqual(
      result.items.map((item) => item.enrichment),
      ['pending', 'pending'],
    )
    assert.equal(state.broadcasts.length, 0)

    release()
    await settle()
    assert.equal(state.broadcasts.length, 1)
  })

  it('merges what it read into the cached page and tells every tab', async () => {
    const { service, store, state } = createHarness({ page: pendingPage() })

    await service.search({ ...request, tabId: 1 })
    await settle()

    const cached = store.entries.get(cacheKey(QUERY, null))!.page
    assert.deepEqual(
      cached.items.map((item) => item.enrichment),
      ['ready', 'ready'],
    )
    assert.equal(cached.items[0].reviewDecision, 'APPROVED')
    assert.equal(cached.items[0].checkState, 'SUCCESS')

    const update = state.broadcasts.find((entry) => entry.type === 'items-enriched')
    assert.ok(update)
    assert.deepEqual(
      update.enrichments.map((entry) => entry.id),
      ['PR_1', 'PR_2'],
    )
  })

  it('asks in batches, in turn, publishing each as it lands', async () => {
    const items = Array.from({ length: 12 }, (_, index) => pullRequest(`PR_${index}`))
    const { service, state } = createHarness({ page: makePage({ items, fetchedAt: 9999 }) })

    await service.search({ ...request, tabId: 1 })
    await settle()

    assert.deepEqual(
      state.enrichCalls.map((batch) => batch.length),
      [ENRICH_BATCH, ENRICH_BATCH, 2],
    )
    // One broadcast per batch, so the marks appear in waves rather than all at
    // the end. GitHub queues a token's requests anyway, so waiting for the
    // last batch would buy nothing and cost the first eleven rows their marks.
    assert.equal(
      state.broadcasts.filter((entry) => entry.type === 'items-enriched').length,
      3,
    )
  })

  it('keeps going when one batch fails, and marks only its rows', async () => {
    const items = Array.from({ length: 12 }, (_, index) => pullRequest(`PR_${index}`))
    const { service, store, errors } = createHarness({
      page: makePage({ items, fetchedAt: 9999 }),
      enrich: async (batch) => {
        if (batch.includes('PR_5')) throw new Error('took too long')
        return { enrichments: batch.map(enrichmentFor), failedIds: [], error: null }
      },
    })

    await service.search({ ...request, tabId: 1 })
    await settle()

    const cached = store.entries.get(cacheKey(QUERY, null))!.page
    assert.deepEqual(
      cached.items.map((item) => item.enrichment),
      [
        ...Array<string>(5).fill('ready'),
        ...Array<string>(5).fill('failed'),
        ...Array<string>(2).fill('ready'),
      ],
    )
    assert.equal(errors.length, 1)
  })

  it('asks about every pull request on a page it just fetched', async () => {
    const page = makePage({
      items: [
        pullRequest('PR_1', { enrichment: 'ready' }),
        pullRequest('PR_2'),
        pullRequest('I_1', { kind: 'issue', enrichment: 'ready' }),
      ],
      fetchedAt: 9999,
    })
    const { service, state } = createHarness({ page })

    await service.search({ ...request, tabId: 1 })
    await settle()

    // Including the row that already has marks: those came from the previous
    // refresh, and letting them stand would quietly stop reporting checks.
    // The issue is left out, having nothing a second request could add.
    assert.deepEqual(state.enrichCalls, [['PR_1', 'PR_2']])
  })

  it('asks only about unanswered rows when serving from the cache', async () => {
    const page = makePage({
      items: [pullRequest('PR_1', { enrichment: 'ready' }), pullRequest('PR_2')],
      fetchedAt: 1000,
    })
    const { service, state } = createHarness({
      seed: [seedEntry(9000, page)],
      now: () => 10_000,
    })

    await service.search({ ...request, tabId: 1 })
    await settle()

    assert.equal(state.fetchCalls, 0)
    assert.deepEqual(state.enrichCalls, [['PR_2']])
  })

  it('keeps the marks a row already has while the page is refetched', async () => {
    const ready = pullRequest('PR_1', {
      enrichment: 'ready',
      reviewDecision: 'APPROVED',
      checkState: 'FAILURE',
      failingChecks: [{ name: 'unit tests', url: null }],
      mergeState: 'behind',
    })
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const { service, state } = createHarness({
      seed: [seedEntry(1000, makePage({ items: [ready] }))],
      // The fetched page is the search's half of the row and nothing else.
      page: makePage({ items: [pullRequest('PR_1')], fetchedAt: 9999 }),
      now: () => 100_000,
      enrich: async (ids) => {
        await gate
        return { enrichments: ids.map(enrichmentFor), failedIds: [], error: null }
      },
    })

    await service.search({ ...request, tabId: 1 })
    await settle()

    // Without carrying them the row would lose its marks for as long as the
    // second request takes, then get them straight back — a list that flinches
    // once a minute and says nothing that was not already true.
    const [update] = state.broadcasts
    assert.equal(update.type, 'search-updated')
    const [row] = update.page.items
    assert.equal(row.enrichment, 'ready')
    assert.equal(row.checkState, 'FAILURE')
    assert.equal(row.reviewDecision, 'APPROVED')
    assert.deepEqual(row.failingChecks, [{ name: 'unit tests', url: null }])

    release()
  })

  it('does not put a stale row back when a newer one arrived meanwhile', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { service, store } = createHarness({
      page: makePage({ items: [pullRequest('PR_1', { title: 'Old title' })], fetchedAt: 9999 }),
      enrich: async (ids) => {
        await gate
        return { enrichments: ids.map(enrichmentFor), failedIds: [], error: null }
      },
    })

    await service.search({ ...request, tabId: 1 })

    // A single-row refresh lands while the second request is still out.
    const key = cacheKey(QUERY, null)
    const entry = store.entries.get(key)!
    store.entries.set(key, {
      ...entry,
      page: {
        ...entry.page,
        items: [pullRequest('PR_1', { title: 'New title', commentCount: 4 })],
      },
    })

    release()
    await settle()

    const [row] = store.entries.get(key)!.page.items
    // The costly half is merged into whichever copy is current, rather than
    // the whole row being swapped for the copy this run started with.
    assert.equal(row.title, 'New title')
    assert.equal(row.commentCount, 4)
    assert.equal(row.enrichment, 'ready')
    assert.equal(row.checkState, 'SUCCESS')
  })

  it('marks the rows it could not read, and leaves the list standing', async () => {
    const { service, store, state } = createHarness({
      page: pendingPage(),
      enrich: async (ids) => ({
        enrichments: [enrichmentFor(ids[0])],
        failedIds: ids.slice(1),
        error: 'GitHub took too long to answer this query.',
      }),
    })

    const result = await service.search({ ...request, tabId: 1 })
    await settle()

    // The page itself never fails over this.
    assert.equal(result.items.length, 2)

    const cached = store.entries.get(cacheKey(QUERY, null))!.page
    assert.deepEqual(
      cached.items.map((item) => item.enrichment),
      ['ready', 'failed'],
    )
    const update = state.broadcasts.find((entry) => entry.type === 'items-enriched')
    assert.deepEqual(update?.failedIds, ['PR_2'])
  })

  it('marks every row when the request itself throws', async () => {
    const { service, store, errors } = createHarness({
      page: pendingPage(),
      enrich: async () => {
        throw new Error('rate limited')
      },
    })

    const result = await service.search({ ...request, tabId: 1 })
    await settle()

    assert.equal(result.items.length, 2)
    const cached = store.entries.get(cacheKey(QUERY, null))!.page
    assert.deepEqual(
      cached.items.map((item) => item.enrichment),
      ['failed', 'failed'],
    )
    assert.equal(errors.length, 1)
  })

  it('finishes a page the worker was stopped part way through', async () => {
    const seeded = seedEntry(9000, pendingPage())
    const { service, state } = createHarness({ seed: [seeded], now: () => 10_000 })

    // Fresh enough to be served straight from cache, so nothing is refetched.
    const result = await service.search({ ...request, tabId: 1 })
    await settle()

    assert.equal(result.source, 'cache')
    assert.equal(state.fetchCalls, 0)
    assert.deepEqual(state.enrichCalls, [['PR_1', 'PR_2']])
  })

  it('asks about a row once, however many pages are holding it', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { service, state } = createHarness({
      page: pendingPage(),
      enrich: async (ids) => {
        await gate
        return { enrichments: ids.map(enrichmentFor), failedIds: [], error: null }
      },
    })

    await service.search({ ...request, tabId: 1 })
    await service.search({ ...request, after: 'CURSOR', tabId: 1 } as never)
    await settle()

    assert.equal(state.enrichCalls.length, 1)
    release()
  })

  it('finishes rows a page written mid-run left waiting', async () => {
    // A refresh overlapping this one writes its own copy of the page while
    // this one is still working through its batches, putting rows already
    // answered for back to waiting — and the run holding their ids is this
    // one, so nothing else will ask. The sweep afterwards is what does.
    const store = createMemoryStore()
    const key = cacheKey(QUERY, null)
    const asked: string[][] = []

    const service = createSearchService({
      store,
      fetchPage: async () =>
        makePage({
          items: Array.from({ length: 10 }, (_, index) => pullRequest(`PR_${index}`)),
          fetchedAt: 9999,
        }),
      enrichPage: async (ids) => {
        asked.push([...ids])
        if (asked.length === 2) {
          // Stands in for that other refresh landing after the first batch was
          // written, which puts its rows back to waiting.
          await store.revisePages((page) => ({
            ...page,
            items: page.items.map((item) => ({ ...item, enrichment: 'pending' as const })),
          }))
        }
        return { enrichments: ids.map(enrichmentFor), failedIds: [], error: null }
      },
      merge: { apply: mergeEnrichments, carry: carryEnrichment },
      isTabActive: async () => true,
      broadcast: () => {},
      now: () => 10_000,
    })

    await service.search({ q: QUERY, first: 30, tabId: 1, freshMs: 60_000 })
    await settle()

    assert.equal(asked.length, 3, 'expected a sweep after the two batches')
    assert.deepEqual(asked[2], ['PR_0', 'PR_1', 'PR_2', 'PR_3', 'PR_4'])
    assert.ok(
      store.entries.get(key)!.page.items.every((item) => item.enrichment === 'ready'),
      'expected no row left waiting',
    )
  })

  it('says nothing at all when a page holds only issues', async () => {
    const page = makePage({
      items: [pullRequest('I_1', { kind: 'issue', enrichment: 'ready' })],
      fetchedAt: 9999,
    })
    const { service, state } = createHarness({ page })

    await service.search({ ...request, tabId: 1 })
    await settle()

    assert.equal(state.enrichCalls.length, 0)
    assert.equal(
      state.broadcasts.some((entry) => entry.type === 'items-enriched'),
      false,
    )
  })
})
