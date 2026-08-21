import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { signatureOf, type ItemMemory, type ItemSignature } from '../src/lib/attention.ts'
import {
  hiddenEntries,
  movePin,
  removePin,
  removeReminder,
  reminderEntries,
  rescheduleReminder,
  unhideItem,
} from '../src/lib/manage.ts'
import type { SearchItem } from '../src/lib/github/types.ts'

function item(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    id: 'PR_1',
    kind: 'pull-request',
    number: 34,
    title: 'Fix the thing',
    url: 'https://github.com/acme/app/pull/34',
    repository: 'acme/app',
    authorLogin: 'octocat',
    authorAvatarUrl: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: 'open',
    stateReason: null,
    commentCount: 2,
    labels: [],
    labelCount: 0,
    reviewDecision: 'REVIEW_REQUIRED',
    checkState: 'PENDING',
    additions: 1,
    deletions: 1,
    headRefName: 'octocat/fix',
    headRefOid: 'abc',
    mergeState: 'clean',
    failingChecks: [],
    checkCount: 3,
    checksRead: 3,
    stack: null,
    ...overrides,
  }
}

const signature: ItemSignature = signatureOf(item())

function memoryOf(entries: Record<string, ItemMemory>): Record<string, ItemMemory> {
  return entries
}

describe('hiddenEntries', () => {
  it('lists only hidden rows, most recently hidden first', () => {
    const memory = memoryOf({
      old: { seen: signature, seenAt: 0, hiddenAt: 100 },
      recent: { seen: signature, seenAt: 0, hiddenAt: 300 },
      seenOnly: { seen: signature, seenAt: 0 },
      middle: { seen: signature, seenAt: 0, hiddenAt: 200 },
    })
    assert.deepEqual(
      hiddenEntries(memory).map((entry) => entry.id),
      ['recent', 'middle', 'old'],
    )
  })

  it('is empty when nothing is hidden', () => {
    assert.deepEqual(hiddenEntries({ a: { seen: signature, seenAt: 0 } }), [])
  })
})

describe('reminderEntries', () => {
  it('leads with timed reminders, soonest first, then change reminders', () => {
    const memory = memoryOf({
      later: { seen: signature, seenAt: 0, reminder: { dueAt: 500, signature, setAt: 0 } },
      change: { seen: signature, seenAt: 0, reminder: { dueAt: null, signature, setAt: 10 } },
      soon: { seen: signature, seenAt: 0, reminder: { dueAt: 100, signature, setAt: 0 } },
      none: { seen: signature, seenAt: 0 },
    })
    assert.deepEqual(
      reminderEntries(memory).map((entry) => entry.id),
      ['soon', 'later', 'change'],
    )
  })
})

describe('unhideItem', () => {
  it('clears the hidden mark', () => {
    const memory = memoryOf({ PR_1: { seen: signature, seenAt: 5, hiddenAt: 100 } })
    const next = unhideItem(memory, 'PR_1')
    assert.equal(next.PR_1.hiddenAt, undefined)
    // Left untouched when no live row is passed to reset the look against.
    assert.equal(next.PR_1.seenAt, 5)
  })

  it('takes a fresh look when the live row is known', () => {
    const memory = memoryOf({ PR_1: { seen: signature, seenAt: 5, hiddenAt: 100 } })
    const moved = item({ commentCount: 9 })
    const next = unhideItem(memory, 'PR_1', moved, 999)
    assert.equal(next.PR_1.hiddenAt, undefined)
    assert.equal(next.PR_1.seenAt, 999)
    assert.deepEqual(next.PR_1.seen, signatureOf(moved))
  })

  it('leaves a row that was not hidden alone', () => {
    const memory = memoryOf({ PR_1: { seen: signature, seenAt: 5 } })
    assert.equal(unhideItem(memory, 'PR_1'), memory)
  })

  it('keeps a reminder set on a hidden row', () => {
    const reminder = { dueAt: 100, signature, setAt: 0 }
    const memory = memoryOf({ PR_1: { seen: signature, seenAt: 5, hiddenAt: 100, reminder } })
    const next = unhideItem(memory, 'PR_1')
    assert.deepEqual(next.PR_1.reminder, reminder)
  })
})

describe('removeReminder', () => {
  it('drops the reminder but keeps the rest of the memory', () => {
    const memory = memoryOf({
      PR_1: { seen: signature, seenAt: 5, hiddenAt: 100, reminder: { dueAt: 100, signature, setAt: 0 } },
    })
    const next = removeReminder(memory, 'PR_1')
    assert.equal(next.PR_1.reminder, undefined)
    assert.equal(next.PR_1.hiddenAt, 100)
  })

  it('leaves a row with no reminder alone', () => {
    const memory = memoryOf({ PR_1: { seen: signature, seenAt: 5 } })
    assert.equal(removeReminder(memory, 'PR_1'), memory)
  })
})

describe('rescheduleReminder', () => {
  it('moves a reminder to a new time while keeping its baseline', () => {
    const baseline = signatureOf(item({ commentCount: 1 }))
    const memory = memoryOf({
      PR_1: { seen: signature, seenAt: 5, reminder: { dueAt: 100, signature: baseline, setAt: 0 } },
    })
    const now = new Date('2026-02-01T08:00:00Z')
    const next = rescheduleReminder(memory, 'PR_1', 'hour', { now })
    assert.deepEqual(next.PR_1.reminder?.signature, baseline)
    assert.equal(next.PR_1.reminder?.dueAt, now.getTime() + 60 * 60_000)
    assert.equal(next.PR_1.reminder?.setAt, now.getTime())
  })

  it('turns a timed reminder into a change reminder', () => {
    const memory = memoryOf({
      PR_1: { seen: signature, seenAt: 5, reminder: { dueAt: 100, signature, setAt: 0 } },
    })
    const next = rescheduleReminder(memory, 'PR_1', 'change')
    assert.equal(next.PR_1.reminder?.dueAt, null)
  })

  it('honours developer-mode overrides', () => {
    const memory = memoryOf({
      PR_1: { seen: signature, seenAt: 5, reminder: { dueAt: 100, signature, setAt: 0 } },
    })
    const now = new Date('2026-02-01T08:00:00Z')
    const next = rescheduleReminder(memory, 'PR_1', 'week', {
      now,
      overrides: { hour: 1, evening: 2, tomorrow: 3, week: 4 },
    })
    assert.equal(next.PR_1.reminder?.dueAt, now.getTime() + 4000)
  })

  it('leaves a row with no reminder alone', () => {
    const memory = memoryOf({ PR_1: { seen: signature, seenAt: 5 } })
    assert.equal(rescheduleReminder(memory, 'PR_1', 'hour'), memory)
  })
})

describe('removePin', () => {
  it('lifts one pin and leaves the order of the rest', () => {
    assert.deepEqual(removePin(['a', 'b', 'c'], 'b'), ['a', 'c'])
  })

  it('is a no-op for a row that is not pinned', () => {
    assert.deepEqual(removePin(['a', 'b'], 'z'), ['a', 'b'])
  })
})

describe('movePin', () => {
  it('moves a pin towards the top', () => {
    assert.deepEqual(movePin(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b'])
  })

  it('moves a pin towards the bottom', () => {
    assert.deepEqual(movePin(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c'])
  })

  it('will not move the top pin up or the last pin down', () => {
    assert.deepEqual(movePin(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
    assert.deepEqual(movePin(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
  })

  it('is a no-op for a row that is not pinned', () => {
    assert.deepEqual(movePin(['a', 'b'], 'z', -1), ['a', 'b'])
  })
})
