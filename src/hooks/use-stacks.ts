import { useCallback } from 'react'
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'

import type { Stack, StackedRow } from '@/lib/github/types'
import { sendMessage } from '@/lib/messages'

const STACK_KEY = ['stack'] as const

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
    (id: string, rows: readonly StackedRow[]) =>
      queryClient.fetchQuery({
        queryKey: stackKey(id),
        queryFn: async () =>
          newerStack(queryClient.getQueryData<Stack>(stackKey(id)), await requestStack(id, rows)),
        staleTime: 0,
        retry: false,
      }),
    [queryClient],
  )
}

/** The stack the panel holds for `id`. Never starts a read; see `useLoadStack`. */
export function useStack(id: string | null) {
  const query = useQuery<Stack>({
    queryKey: stackKey(id ?? ''),
    queryFn: skipToken,
    enabled: id !== null,
  })
  return {
    stack: id === null ? undefined : query.data,
    isLoading: query.fetchStatus === 'fetching',
    isFailed: query.status === 'error',
  }
}
