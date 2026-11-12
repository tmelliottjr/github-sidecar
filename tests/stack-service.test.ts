import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { KeyedStore } from '../src/background/cache.ts'
import {
  createItemService,
  createLayerReviewService,
  createStackService,
} from '../src/background/stack-service.ts'
import type { ItemsResult, LayerReviewsResult, StacksResult } from '../src/lib/github/api.ts'
import type { FetchedItem, LayerReview, Stack, StackedRow } from '../src/lib/github/types.ts'
import type { LayerReviewsUpdate, StacksUpdate } from '../src/lib/messages.ts'

function stack(overrides: Partial<Stack> = {}): Stack {
  return {
    id: 'STACK_1',
    number: 7,
    size: 2,
    baseRefName: 'main',
    layers: [
      { id: 'PR_1', number: 1, title: 'Groundwork', url: 'u1', repository: 'acme/app', state: 'open', position: 1 },
      { id: 'PR_2', number: 2, title: 'Feature', url: 'u2', repository: 'acme/app', state: 'open', position: 2 },
    ],
    fetchedAt: 1000,
    ...overrides,
  }
}

function row(overrides: Partial<StackedRow> = {}, membership: Partial<StackedRow['stack']> = {}): StackedRow {
  return {
    id: 'PR_2',
    stack: { id: 'STACK_1', number: 7, size: 2, baseRefName: 'main', position: 2, ...membership },
    ...overrides,
  }
}

/** Keeps the newer of two copies, like the IndexedDB store does in one transaction. */
function createMemoryStore<T extends { id: string; fetchedAt: number }>(seed: T[] = []) {
  const records = new Map(seed.map((entry) => [entry.id, entry]))
  const store: KeyedStore<T> & { records: Map<string, T> } = {
    records,
    async read(ids) {
      return ids.flatMap((id) => {
        const found = records.get(id)
        return found ? [found] : []
      })
    },
    async write(incoming) {
      return incoming.map((next) => {
        const current = records.get(next.id)
        if (current && current.fetchedAt >= next.fetchedAt) return current
        records.set(next.id, next)
        return next
      })
    },
    async prune() {},
  }
  return store
}

function createHarness(
  options: {
    seed?: Stack[]
    now?: number
    fetch?: (ids: readonly string[]) => Promise<StacksResult>
  } = {},
) {
  const calls: string[][] = []
  const broadcasts: StacksUpdate[] = []
  const errors: unknown[] = []
  const store = createMemoryStore<Stack>(options.seed)

  const service = createStackService({
    store,
    fetchStacks: async (ids) => {
      calls.push([...ids])
      return (
        options.fetch?.(ids) ?? {
          stacks: ids.map((id) => stack({ id, fetchedAt: 9000 })),
          failedIds: [],
          error: null,
        }
      )
    },
    broadcast: (update) => broadcasts.push(update),
    onError: (error) => errors.push(error),
    now: () => options.now ?? 10_000,
  })

  return { service, store, calls, broadcasts, errors }
}

const FRESH_MS = 60_000

describe('stack service', () => {
  it('reads stacks it does not hold, stores them, and tells every tab', async () => {
    const { service, store, calls, broadcasts } = createHarness()

    const answer = await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.deepEqual(calls, [['STACK_1']])
    assert.equal(answer.stacks[0].fetchedAt, 9000)
    assert.deepEqual(answer.failedIds, [])
    assert.equal(store.records.get('STACK_1')?.fetchedAt, 9000)
    assert.deepEqual(broadcasts.map((update) => update.stacks.map((entry) => entry.id)), [
      ['STACK_1'],
    ])
  })

  it('serves a fresh stack from the cache without asking GitHub', async () => {
    const { service, calls, broadcasts } = createHarness({ seed: [stack()] })

    const answer = await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.deepEqual(calls, [])
    assert.deepEqual(broadcasts, [])
    assert.equal(answer.stacks[0].fetchedAt, 1000)
  })

  it('reads a stack again once it is older than the freshness window', async () => {
    const { service, calls } = createHarness({ seed: [stack()], now: 1000 + FRESH_MS })

    await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.deepEqual(calls, [['STACK_1']])
  })

  it('reads a stack again when a loaded row disagrees with it', async () => {
    const resized = createHarness({ seed: [stack()] })
    await resized.service.stacks({ rows: [row({}, { size: 3 })], freshMs: FRESH_MS })
    assert.deepEqual(resized.calls, [['STACK_1']])

    const moved = createHarness({ seed: [stack()] })
    await moved.service.stacks({ rows: [row({ id: 'PR_9' })], freshMs: FRESH_MS })
    assert.deepEqual(moved.calls, [['STACK_1']])
  })

  it('shares one read between requests for the same stack', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { service, calls } = createHarness({
      fetch: async (ids) => {
        await gate
        return { stacks: ids.map((id) => stack({ id, fetchedAt: 9000 })), failedIds: [], error: null }
      },
    })

    const first = service.stacks({ rows: [row()], freshMs: FRESH_MS })
    const second = service.stacks({
      rows: [row(), row({ id: 'PR_5' }, { id: 'STACK_2', position: 1 })],
      freshMs: FRESH_MS,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    const answers = await Promise.all([first, second])

    assert.deepEqual(calls, [['STACK_1'], ['STACK_2']])
    assert.deepEqual(
      answers[1].stacks.map((entry) => entry.id).toSorted(),
      ['STACK_1', 'STACK_2'],
    )
  })

  it('keeps the stored stack when an older read lands after it', async () => {
    const { service, store } = createHarness({
      seed: [stack({ fetchedAt: 8000, number: 70 })],
      now: 8000 + FRESH_MS,
      fetch: async () => ({ stacks: [stack({ fetchedAt: 7000 })], failedIds: [], error: null }),
    })

    const answer = await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.equal(answer.stacks[0].number, 70)
    assert.equal(store.records.get('STACK_1')?.fetchedAt, 8000)
  })

  it('writes nothing for a stack GitHub would not answer for in full', async () => {
    const { service, store, broadcasts, errors } = createHarness({
      seed: [stack()],
      now: 1000 + FRESH_MS,
      fetch: async (ids) => ({ stacks: [], failedIds: [...ids], error: 'GitHub took too long' }),
    })

    const answer = await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.deepEqual(answer, { stacks: [], failedIds: ['STACK_1'] })
    assert.equal(store.records.get('STACK_1')?.fetchedAt, 1000)
    assert.deepEqual(broadcasts[0].failedIds, ['STACK_1'])
    assert.equal(errors.length, 1)
  })

  it('reports every stack as failed when the request itself fails', async () => {
    const { service, errors } = createHarness({
      fetch: async () => {
        throw new Error('offline')
      },
    })

    const answer = await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.deepEqual(answer.failedIds, ['STACK_1'])
    assert.equal((errors[0] as Error).message, 'offline')
  })
})

describe('layer review service', () => {
  const review = (id: string, fetchedAt: number): LayerReview => ({
    id,
    reviewDecision: 'APPROVED',
    fetchedAt,
  })

  function createReviewHarness(
    seed: LayerReview[] = [],
    fetch: (ids: readonly string[]) => Promise<LayerReviewsResult> = async (ids) => ({
      reviews: ids.map((id) => review(id, 9000)),
      failedIds: [],
      error: null,
    }),
  ) {
    const calls: string[][] = []
    const broadcasts: LayerReviewsUpdate[] = []
    const store = createMemoryStore<LayerReview>(seed)
    const service = createLayerReviewService({
      store,
      fetchReviews: async (ids) => {
        calls.push([...ids])
        return fetch(ids)
      },
      broadcast: (update) => broadcasts.push(update),
      now: () => 10_000,
    })
    return { service, store, calls, broadcasts }
  }

  it('reads only the reviews it does not hold fresh, and stores them', async () => {
    const { service, store, calls, broadcasts } = createReviewHarness([
      review('PR_fresh', 9500),
      review('PR_old', 10_000 - FRESH_MS),
    ])

    const answer = await service.reviews({ ids: ['PR_fresh', 'PR_old', 'PR_new'], freshMs: FRESH_MS })

    assert.deepEqual(calls, [['PR_old', 'PR_new']])
    assert.deepEqual(answer.reviews.map((entry) => entry.id).toSorted(), ['PR_fresh', 'PR_new', 'PR_old'])
    assert.equal(store.records.get('PR_new')?.fetchedAt, 9000)
    assert.deepEqual(broadcasts[0].reviews.map((entry) => entry.id), ['PR_old', 'PR_new'])
  })

  it('reports reviews GitHub would not answer for, and stores nothing for them', async () => {
    const { service, store } = createReviewHarness([], async (ids) => ({
      reviews: [],
      failedIds: [...ids],
      error: 'GitHub did not answer for every layer.',
    }))

    const answer = await service.reviews({ ids: ['PR_1'], freshMs: FRESH_MS })

    assert.deepEqual(answer, { reviews: [], failedIds: ['PR_1'] })
    assert.equal(store.records.size, 0)
  })
})

describe('item service', () => {
  // The service reads nothing but the id and the time, so the rest of the row
  // is left out.
  const fetched = (id: string, fetchedAt: number) => ({ id, fetchedAt }) as FetchedItem

  function createItemHarness(
    seed: FetchedItem[] = [],
    fetch: (ids: readonly string[]) => Promise<ItemsResult> = async (ids) => ({
      items: ids.map((id) => fetched(id, 9000)),
      failedIds: [],
      error: null,
    }),
  ) {
    const calls: string[][] = []
    const errors: unknown[] = []
    const store = createMemoryStore<FetchedItem>(seed)
    const service = createItemService({
      store,
      fetchItems: async (ids) => {
        calls.push([...ids])
        return fetch(ids)
      },
      onError: (error) => errors.push(error),
      now: () => 10_000,
    })
    return { service, store, calls, errors }
  }

  it('serves fresh rows from the store, and reads the rest five at a time', async () => {
    const { service, store, calls } = createItemHarness([
      fetched('PR_fresh', 9500),
      fetched('PR_old', 10_000 - FRESH_MS),
    ])
    const ids = ['PR_fresh', 'PR_old', 'PR_1', 'PR_2', 'PR_3', 'PR_4', 'PR_5']

    const answer = await service.items({ ids, freshMs: FRESH_MS })

    assert.deepEqual(calls, [['PR_old', 'PR_1', 'PR_2', 'PR_3', 'PR_4'], ['PR_5']])
    assert.deepEqual(answer.items.map((item) => item.id).toSorted(), ids.toSorted())
    assert.deepEqual(answer.failedIds, [])
    assert.equal(store.records.get('PR_old')?.fetchedAt, 9000)
  })

  it('keeps the batches that answered when another fails', async () => {
    const { service, errors } = createItemHarness([], async (ids) => {
      if (ids.includes('PR_1')) throw new Error('offline')
      return { items: ids.map((id) => fetched(id, 9000)), failedIds: [], error: null }
    })

    const answer = await service.items({
      ids: ['PR_1', 'PR_2', 'PR_3', 'PR_4', 'PR_5', 'PR_6'],
      freshMs: FRESH_MS,
    })

    assert.deepEqual(answer.items.map((item) => item.id), ['PR_6'])
    assert.deepEqual(answer.failedIds, ['PR_1', 'PR_2', 'PR_3', 'PR_4', 'PR_5'])
    assert.equal((errors[0] as Error).message, 'offline')
  })
})
