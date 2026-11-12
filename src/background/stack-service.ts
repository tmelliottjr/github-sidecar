import type { ItemsResult, LayerReviewsResult, StacksResult } from '@/lib/github/api'
import type { FetchedItem, LayerReview, Stack, StackedRow } from '@/lib/github/types'
import type {
  LayerReviewsAnswer,
  LayerReviewsUpdate,
  StacksAnswer,
  StacksUpdate,
} from '@/lib/messages'
import { agrees } from '../lib/github/stacks.ts'
import type { ItemStore, KeyedStore, LayerReviewStore, StackStore } from './cache'
import { ENRICH_BATCH } from './search-service.ts'

type Stamped = { id: string; fetchedAt: number }

interface ReadResult<T> {
  records: T[]
  failedIds: string[]
  error: string | null
}

interface LoaderDeps<T extends Stamped> {
  /** Names the records in logged errors. */
  name: string
  store: KeyedStore<T>
  read: (ids: readonly string[]) => Promise<ReadResult<T>>
  broadcast: (records: T[], failedIds: string[]) => void
  onError?: (error: unknown) => void
}

/**
 * Reads records from GitHub, stores them, and sends them to every tab. Reads
 * already running are shared by id. A promise resolves with null for an id
 * that could not be read, and never rejects.
 */
function createLoader<T extends Stamped>({ name, store, read, broadcast, onError }: LoaderDeps<T>) {
  const inFlight = new Map<string, Promise<T | null>>()

  async function load(ids: readonly string[]): Promise<Map<string, T>> {
    let result: ReadResult<T>
    try {
      result = await read(ids)
    } catch (error) {
      onError?.(error)
      result = { records: [], failedIds: [...ids], error: null }
    }
    if (result.error) onError?.(new Error(`${name}: ${result.error}`))

    const stored = await store.write(result.records).catch((error: unknown) => {
      onError?.(error)
      return result.records
    })
    broadcast(stored, result.failedIds)
    return new Map(stored.map((record) => [record.id, record]))
  }

  return (ids: readonly string[]): Array<Promise<T | null>> => {
    const missing = ids.filter((id) => !inFlight.has(id))
    if (missing.length > 0) {
      const request = load(missing)
      for (const id of missing) {
        const record = request.then((records) => records.get(id) ?? null)
        inFlight.set(id, record)
        void record.finally(() => inFlight.delete(id))
      }
    }
    return ids.map((id) => inFlight.get(id) as Promise<T | null>)
  }
}

/** Answers from the cache where `isFresh` allows, and reads the rest. */
async function answer<T extends Stamped>(
  ids: readonly string[],
  store: KeyedStore<T>,
  isFresh: (record: T) => boolean,
  loadOnce: (ids: readonly string[]) => Array<Promise<T | null>>,
  onError?: (error: unknown) => void,
): Promise<{ records: T[]; failedIds: string[] }> {
  const cached = await store.read(ids).catch((error: unknown) => {
    onError?.(error)
    return []
  })
  const found = new Map<string, T>()
  for (const record of cached) if (isFresh(record)) found.set(record.id, record)

  const wanted = ids.filter((id) => !found.has(id))
  const loaded = await Promise.all(loadOnce(wanted))

  const failedIds: string[] = []
  wanted.forEach((id, index) => {
    const record = loaded[index]
    if (record) found.set(id, record)
    else failedIds.push(id)
  })
  return { records: [...found.values()], failedIds }
}

export interface StackServiceDeps {
  store: StackStore
  fetchStacks: (ids: readonly string[]) => Promise<StacksResult>
  broadcast: (update: StacksUpdate) => void
  onError?: (error: unknown) => void
  now?: () => number
}

export interface StacksRequest {
  /** The loaded rows in the stacks wanted. */
  rows: readonly StackedRow[]
  freshMs: number
}

export function createStackService({
  store,
  fetchStacks,
  broadcast,
  onError,
  now = Date.now,
}: StackServiceDeps) {
  const loadOnce = createLoader<Stack>({
    name: 'stacks',
    store,
    read: async (ids) => {
      const { stacks, failedIds, error } = await fetchStacks(ids)
      return { records: stacks, failedIds, error }
    },
    broadcast: (stacks, failedIds) => broadcast({ type: 'stacks-updated', stacks, failedIds }),
    onError,
  })

  return {
    async stacks({ rows, freshMs }: StacksRequest): Promise<StacksAnswer> {
      const rowsByStack = new Map<string, StackedRow[]>()
      for (const row of rows) {
        const group = rowsByStack.get(row.stack.id)
        if (group) group.push(row)
        else rowsByStack.set(row.stack.id, [row])
      }

      const { records, failedIds } = await answer(
        [...rowsByStack.keys()],
        store,
        (stack) =>
          now() - stack.fetchedAt < freshMs &&
          (rowsByStack.get(stack.id) ?? []).every((row) => agrees(stack, row)),
        loadOnce,
        onError,
      )
      return { stacks: records, failedIds }
    },
  }
}

export type StackService = ReturnType<typeof createStackService>

export interface LayerReviewServiceDeps {
  store: LayerReviewStore
  fetchReviews: (ids: readonly string[]) => Promise<LayerReviewsResult>
  broadcast: (update: LayerReviewsUpdate) => void
  onError?: (error: unknown) => void
  now?: () => number
}

/** Answers review decisions of stack layers, reading those missing or older than `freshMs`. */
export function createLayerReviewService({
  store,
  fetchReviews,
  broadcast,
  onError,
  now = Date.now,
}: LayerReviewServiceDeps) {
  const loadOnce = createLoader<LayerReview>({
    name: 'layer reviews',
    store,
    read: async (ids) => {
      const { reviews, failedIds, error } = await fetchReviews(ids)
      return { records: reviews, failedIds, error }
    },
    broadcast: (reviews, failedIds) =>
      broadcast({ type: 'layer-reviews-updated', reviews, failedIds }),
    onError,
  })

  return {
    async reviews({
      ids,
      freshMs,
    }: {
      ids: readonly string[]
      freshMs: number
    }): Promise<LayerReviewsAnswer> {
      const { records, failedIds } = await answer(
        [...new Set(ids)],
        store,
        (review) => now() - review.fetchedAt < freshMs,
        loadOnce,
        onError,
      )
      return { reviews: records, failedIds }
    },
  }
}

export interface ItemServiceDeps {
  store: ItemStore
  fetchItems: (ids: readonly string[]) => Promise<ItemsResult>
  /** Called with the rows each read returned. No tab lists them, so none is told. */
  onRead?: (items: FetchedItem[]) => void
  onError?: (error: unknown) => void
  now?: () => number
}

/** Answers rows by node id, reading those missing or older than `freshMs`. */
export function createItemService({
  store,
  fetchItems,
  onRead,
  onError,
  now = Date.now,
}: ItemServiceDeps) {
  const loadOnce = createLoader<FetchedItem>({
    name: 'rows',
    store,
    read: async (ids) => {
      const records: FetchedItem[] = []
      const failedIds: string[] = []
      let error: string | null = null
      // A few rows per request, as with enrichment: every field is asked for,
      // and GitHub gives a request ten seconds.
      for (let start = 0; start < ids.length; start += ENRICH_BATCH) {
        const batch = ids.slice(start, start + ENRICH_BATCH)
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await fetchItems(batch)
          records.push(...result.items)
          failedIds.push(...result.failedIds)
          error ??= result.error
        } catch (caught) {
          onError?.(caught)
          failedIds.push(...batch)
        }
      }
      return { records, failedIds, error }
    },
    broadcast: (items) => onRead?.(items),
    onError,
  })

  return {
    async items({
      ids,
      freshMs,
    }: {
      ids: readonly string[]
      freshMs: number
    }): Promise<{ items: FetchedItem[]; failedIds: string[] }> {
      const { records, failedIds } = await answer(
        [...new Set(ids)],
        store,
        (item) => now() - item.fetchedAt < freshMs,
        loadOnce,
        onError,
      )
      return { items: records, failedIds }
    },
  }
}

export type ItemService = ReturnType<typeof createItemService>
