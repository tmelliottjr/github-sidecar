import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { StackStore } from '../src/background/cache.ts'
import { createStackService } from '../src/background/stack-service.ts'
import type { StacksResult } from '../src/lib/github/api.ts'
import type { Stack, StackedRow } from '../src/lib/github/types.ts'
import type { StacksUpdate } from '../src/lib/messages.ts'

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
    fetchedAt: 500,
    ...overrides,
  }
}

/** Keeps the newer of two copies, like the IndexedDB store does in one transaction. */
function createMemoryStore(seed: Stack[] = []) {
  const stacks = new Map(seed.map((entry) => [entry.id, entry]))
  const store: StackStore & { stacks: Map<string, Stack> } = {
    stacks,
    async read(ids) {
      return ids.flatMap((id) => {
        const found = stacks.get(id)
        return found ? [found] : []
      })
    },
    async write(incoming) {
      return incoming.map((next) => {
        const current = stacks.get(next.id)
        if (current && current.fetchedAt >= next.fetchedAt) return current
        stacks.set(next.id, next)
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
  const store = createMemoryStore(options.seed)

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
    assert.equal(store.stacks.get('STACK_1')?.fetchedAt, 9000)
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

  it('reads a stack again when a row read after it disagrees with it', async () => {
    const later = 2000
    const resized = createHarness({ seed: [stack()] })
    await resized.service.stacks({
      rows: [row({ fetchedAt: later }, { size: 3 })],
      freshMs: FRESH_MS,
    })
    assert.deepEqual(resized.calls, [['STACK_1']])

    const moved = createHarness({ seed: [stack()] })
    await moved.service.stacks({
      rows: [row({ id: 'PR_9', fetchedAt: later })],
      freshMs: FRESH_MS,
    })
    assert.deepEqual(moved.calls, [['STACK_1']])
  })

  it('trusts a stack read after the row that disagrees with it', async () => {
    const { service, calls } = createHarness({ seed: [stack()] })

    await service.stacks({ rows: [row({ fetchedAt: 500 }, { size: 3 })], freshMs: FRESH_MS })

    assert.deepEqual(calls, [])
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
    assert.equal(store.stacks.get('STACK_1')?.fetchedAt, 8000)
  })

  it('writes nothing for a stack GitHub would not answer for in full', async () => {
    const { service, store, broadcasts, errors } = createHarness({
      seed: [stack()],
      now: 1000 + FRESH_MS,
      fetch: async (ids) => ({ stacks: [], failedIds: [...ids], error: 'GitHub took too long' }),
    })

    const answer = await service.stacks({ rows: [row()], freshMs: FRESH_MS })

    assert.deepEqual(answer, { stacks: [], failedIds: ['STACK_1'] })
    assert.equal(store.stacks.get('STACK_1')?.fetchedAt, 1000)
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
