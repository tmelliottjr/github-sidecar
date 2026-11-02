import type { StacksResult } from '@/lib/github/api'
import type { Stack, StackedRow } from '@/lib/github/types'
import type { StacksAnswer, StacksUpdate } from '@/lib/messages'
import type { StackStore } from './cache'

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

/**
 * Whether a cached stack agrees with a row in it: the same size, and the same
 * pull request at the row position. Only a row read after the stack can
 * prove the stack wrong.
 */
function agrees(stack: Stack, row: StackedRow): boolean {
  if (row.fetchedAt <= stack.fetchedAt) return true
  if (row.stack.size !== stack.size) return false
  return stack.layers.some((layer) => layer.position === row.stack.position && layer.id === row.id)
}

export function createStackService({
  store,
  fetchStacks,
  broadcast,
  onError,
  now = Date.now,
}: StackServiceDeps) {
  /** Reads already running, by stack id. Null means the read failed. */
  const inFlight = new Map<string, Promise<Stack | null>>()

  /** Reads stacks from GitHub, stores them, and sends them to every tab. Never rejects. */
  async function load(ids: readonly string[]): Promise<Map<string, Stack>> {
    let result: StacksResult
    try {
      result = await fetchStacks(ids)
    } catch (error) {
      onError?.(error)
      result = { stacks: [], failedIds: [...ids], error: null }
    }
    if (result.error) onError?.(new Error(`stacks: ${result.error}`))

    const stored = await store.write(result.stacks).catch((error: unknown) => {
      onError?.(error)
      return result.stacks
    })
    broadcast({ type: 'stacks-updated', stacks: stored, failedIds: result.failedIds })
    return new Map(stored.map((stack) => [stack.id, stack]))
  }

  function loadOnce(ids: readonly string[]): Array<Promise<Stack | null>> {
    const missing = ids.filter((id) => !inFlight.has(id))
    if (missing.length > 0) {
      const request = load(missing)
      for (const id of missing) {
        const read = request.then((stacks) => stacks.get(id) ?? null)
        inFlight.set(id, read)
        void read.finally(() => inFlight.delete(id))
      }
    }
    return ids.map((id) => inFlight.get(id) as Promise<Stack | null>)
  }

  return {
    async stacks({ rows, freshMs }: StacksRequest): Promise<StacksAnswer> {
      const rowsByStack = new Map<string, StackedRow[]>()
      for (const row of rows) {
        const group = rowsByStack.get(row.stack.id)
        if (group) group.push(row)
        else rowsByStack.set(row.stack.id, [row])
      }
      const ids = [...rowsByStack.keys()]

      const cached = await store.read(ids).catch((error: unknown) => {
        onError?.(error)
        return []
      })
      const fresh = new Map<string, Stack>()
      for (const stack of cached) {
        const isFresh =
          now() - stack.fetchedAt < freshMs &&
          (rowsByStack.get(stack.id) ?? []).every((row) => agrees(stack, row))
        if (isFresh) fresh.set(stack.id, stack)
      }

      const wanted = ids.filter((id) => !fresh.has(id))
      const loaded = await Promise.all(loadOnce(wanted))

      const failedIds: string[] = []
      wanted.forEach((id, index) => {
        const stack = loaded[index]
        if (stack) fresh.set(id, stack)
        else failedIds.push(id)
      })
      return { stacks: [...fresh.values()], failedIds }
    },
  }
}

export type StackService = ReturnType<typeof createStackService>
