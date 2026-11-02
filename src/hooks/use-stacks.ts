import { useCallback } from 'react'
import {
  queryOptions,
  skipToken,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryObserverResult,
} from '@tanstack/react-query'

import { agrees } from '@/lib/github/stacks'
import type { LayerReview, Stack, StackedRow } from '@/lib/github/types'
import type { StackView } from '@/lib/list-view'
import { sendMessage } from '@/lib/messages'

const STACK_KEY = ['stack'] as const
const LAYER_REVIEWS_KEY = ['layer-reviews'] as const

/** Layer reviews by pull request id. An id that is missing has not been read yet. */
export type LayerReviewMap = Readonly<Record<string, LayerReview>>

/** Keeps the later read of each review. Answers and broadcasts can land in either order. */
export function mergeLayerReviews(
  current: LayerReviewMap | undefined,
  incoming: readonly LayerReview[],
): LayerReviewMap {
  const next: Record<string, LayerReview> = { ...current }
  for (const review of incoming) {
    const held = next[review.id]
    if (!held || held.fetchedAt < review.fetchedAt) next[review.id] = review
  }
  return next
}

export function layerReviewsKey() {
  return LAYER_REVIEWS_KEY
}

export function stackKey(id: string) {
  return [...STACK_KEY, id] as const
}

/** Keeps the copy read later. Answers and broadcasts can land in either order. */
export function newerStack(current: Stack | undefined, incoming: Stack): Stack {
  return current && current.fetchedAt >= incoming.fetchedAt ? current : incoming
}

interface Waiting {
  id: string
  rows: readonly StackedRow[]
  resolve: (stack: Stack) => void
  reject: (error: unknown) => void
}

let waiting: Waiting[] = []

/** Sends every stack asked for in one tick as one `stacks` message. */
async function flush(): Promise<void> {
  const batch = waiting
  waiting = []
  try {
    const { stacks } = await sendMessage({
      type: 'stacks',
      rows: batch.flatMap((entry) => entry.rows),
    })
    const byId = new Map(stacks.map((stack) => [stack.id, stack]))
    for (const entry of batch) {
      const stack = byId.get(entry.id)
      if (stack) entry.resolve(stack)
      else entry.reject(new Error('GitHub did not return this stack.'))
    }
  } catch (error) {
    for (const entry of batch) entry.reject(error)
  }
}

function requestStack(id: string, rows: readonly StackedRow[]): Promise<Stack> {
  return new Promise((resolve, reject) => {
    if (waiting.length === 0) setTimeout(() => void flush(), 0)
    waiting.push({ id, rows, resolve, reject })
  })
}

/**
 * Loads a whole stack through the worker, given the loaded rows in it. The
 * worker answers from its cache when the stack is fresh and agrees with the
 * rows, so the panel asks on every intent and keeps no freshness of its own.
 */
export function useLoadStack() {
  const queryClient = useQueryClient()
  return useCallback(
    async (id: string, rows: readonly StackedRow[]) => {
      const load = () =>
        queryClient.fetchQuery({
          queryKey: stackKey(id),
          queryFn: async () =>
            newerStack(queryClient.getQueryData<Stack>(stackKey(id)), await requestStack(id, rows)),
          staleTime: 0,
          retry: false,
        })
      const stack = await load()
      // A read already running is shared, and it checked the rows it was given, not these.
      return rows.every((row) => agrees(stack, row)) ? stack : load()
    },
    [queryClient],
  )
}

function viewOf(query: Pick<QueryObserverResult<Stack>, 'data' | 'fetchStatus' | 'status'>): StackView {
  return {
    stack: query.data,
    isLoading: query.fetchStatus === 'fetching',
    isFailed: query.status === 'error',
  }
}

/** The stack the panel holds for `id`. Never starts a read; see `useLoadStack`. */
export function useStack(id: string | null): StackView {
  const query = useQuery<Stack>({
    queryKey: stackKey(id ?? ''),
    queryFn: skipToken,
    enabled: id !== null,
  })
  return id === null ? { stack: undefined, isLoading: false, isFailed: false } : viewOf(query)
}

/** The stacks the panel holds for `ids`, by id. Never starts a read. */
export function useStackViews(ids: readonly string[]): ReadonlyMap<string, StackView> {
  return useQueries({
    queries: ids.map((id) => queryOptions<Stack>({ queryKey: stackKey(id), queryFn: skipToken })),
    combine: useCallback(
      (results: Array<QueryObserverResult<Stack>>) =>
        new Map(results.map((result, index) => [ids[index], viewOf(result)])),
      [ids],
    ),
  })
}

/**
 * Loads review decisions for stack layers through the worker, which answers
 * from its cache unless a review is older than the refresh window.
 */
export function useLoadLayerReviews() {
  const queryClient = useQueryClient()
  return useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0) return
      const { reviews } = await sendMessage({ type: 'layer-reviews', ids: [...ids] })
      queryClient.setQueryData<LayerReviewMap>(LAYER_REVIEWS_KEY, (current) =>
        mergeLayerReviews(current, reviews),
      )
    },
    [queryClient],
  )
}

/** Every layer review the panel holds. Never starts a read. */
export function useLayerReviews(): LayerReviewMap | undefined {
  return useQuery<LayerReviewMap>({ queryKey: LAYER_REVIEWS_KEY, queryFn: skipToken }).data
}
