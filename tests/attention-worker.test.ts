import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  badgeText,
  nextReminderAt,
  pendingNotifications,
  signatureOf,
  uniqueItems,
  waitingItems,
  waitingStamp,
  type ItemMemory,
  type WaitingItem,
} from '../src/lib/attention.ts'
import type { SearchItem } from '../src/lib/github/types.ts'

function item(id: string, overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    id,
    kind: 'pull-request',
    number: 34,
    title: 'Fix the thing',
    url: `https://github.com/acme/app/pull/34`,
    repository: 'acme/app',
    authorLogin: null,
    authorAvatarUrl: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: 'open',
    stateReason: null,
    commentCount: 1,
    labels: [],
    labelCount: 0,
    reviewDecision: null,
    checkState: 'PENDING',
    additions: null,
    deletions: null,
    headRefName: 'octocat/fix',
    headRefOid: 'abc',
    mergeState: null,
    failingChecks: [],
    checkCount: null,
    checksRead: 0,
    stack: null,
    ...overrides,
  }
}

const memoryOf = (...items: SearchItem[]): Record<string, ItemMemory> =>
  Object.fromEntries(items.map((entry) => [entry.id, { seen: signatureOf(entry), seenAt: 0 }]))

describe('what is waiting', () => {
  it('counts only rows that moved since they were seen', () => {
    const memory = memoryOf(item('a'), item('b'))
    const waiting = waitingItems([item('a', { commentCount: 4 }), item('b')], memory)

    assert.deepEqual(
      waiting.map((entry) => [entry.item.id, entry.reason, entry.summary]),
      [['a', 'change', '3 new comments']],
    )
  })

  it('says nothing about a row nobody has seen yet', () => {
    assert.deepEqual(waitingItems([item('a', { commentCount: 9 })], {}), [])
  })

  it('leaves a hidden row out, however much it has moved', () => {
    const memory = memoryOf(item('a'))
    memory.a.hiddenAt = 10

    assert.deepEqual(waitingItems([item('a', { commentCount: 9 })], memory), [])
    // Unless hiding has since been switched off, in which case the reader can
    // plainly see the row and the count has to agree with them.
    assert.equal(
      waitingItems([item('a', { commentCount: 9 })], memory, { hiding: false }).length,
      1,
    )
  })

  it('says nothing about reminders once they are switched off', () => {
    const memory = memoryOf(item('a'))
    memory.a.reminder = { dueAt: 500, signature: signatureOf(item('a')), setAt: 0 }

    assert.equal(waitingItems([item('a')], memory, { now: 600 }).length, 1)
    assert.deepEqual(
      waitingItems([item('a')], memory, { now: 600, reminders: false }),
      [],
    )
  })

  it('counts a reminder that has come round, even on a hidden row', () => {
    const memory = memoryOf(item('a'))
    memory.a.hiddenAt = 10
    memory.a.reminder = { dueAt: 500, signature: signatureOf(item('a')), setAt: 0 }

    const waiting = waitingItems([item('a')], memory, { now: 600 })
    assert.deepEqual(
      waiting.map((entry) => [entry.reason, entry.summary]),
      [['reminder', 'Reminder']],
    )
  })

  it('leads a due reminder with what also changed', () => {
    const memory = memoryOf(item('a'))
    memory.a.reminder = { dueAt: null, signature: signatureOf(item('a')), setAt: 0 }

    const waiting = waitingItems([item('a', { commentCount: 4 })], memory, { now: 600 })
    assert.deepEqual(waiting[0].summary, 'Reminder · 3 new comments')
  })

  it('says nothing about a reminder that has not come round', () => {
    const memory = memoryOf(item('a'))
    memory.a.reminder = { dueAt: 5000, signature: signatureOf(item('a')), setAt: 0 }

    assert.deepEqual(waitingItems([item('a')], memory, { now: 600 }), [])
  })

  it('treats a row on two cached pages as one row', () => {
    const items = [item('a'), item('b'), item('a', { commentCount: 7 })]
    const unique = uniqueItems(items)

    assert.equal(unique.length, 2)
    // The later copy wins, so a page refreshed after another is not undone.
    assert.equal(unique.find((entry) => entry.id === 'a')?.commentCount, 7)
  })

  it('fits the count on a badge four characters wide', () => {
    assert.equal(badgeText(0), '')
    assert.equal(badgeText(-1), '')
    assert.equal(badgeText(7), '7')
    assert.equal(badgeText(120), '99+')
  })
})

describe('waking for the next reminder', () => {
  it('waits for the soonest one that has not come round', () => {
    const memory = memoryOf(item('a'), item('b'), item('c'))
    memory.a.reminder = { dueAt: 9000, signature: signatureOf(item('a')), setAt: 0 }
    memory.b.reminder = { dueAt: 4000, signature: signatureOf(item('b')), setAt: 0 }
    // Already due, and one that waits on the row rather than the clock: an
    // alarm can do nothing for either.
    memory.c.reminder = { dueAt: null, signature: signatureOf(item('c')), setAt: 0 }

    assert.equal(nextReminderAt(memory, 1000), 4000)
    assert.equal(nextReminderAt(memory, 5000), 9000)
    assert.equal(nextReminderAt(memory, 9000), null)
  })

  it('has nothing to wait for when no reminder is set', () => {
    assert.equal(nextReminderAt(memoryOf(item('a'))), null)
  })
})

describe('announcing a change once', () => {
  const changed: WaitingItem[] = [
    {
      item: item('a', { commentCount: 4 }),
      reason: 'change',
      changes: ['comments'],
      summary: '3 new comments',
    },
  ]

  it('announces something that has not been announced', () => {
    const { send, announced } = pendingNotifications(changed, {})

    assert.deepEqual(send.map((entry) => entry.item.id), ['a'])
    assert.deepEqual(announced, { a: waitingStamp(changed[0]) })
  })

  it('stays quiet while the same change is merely still true', () => {
    const { announced } = pendingNotifications(changed, {})
    const second = pendingNotifications(changed, announced)

    assert.deepEqual(second.send, [])
    assert.deepEqual(second.announced, announced)
  })

  it('speaks again when the row moves again', () => {
    const { announced } = pendingNotifications(changed, {})
    const later: WaitingItem[] = [
      {
        item: item('a', { commentCount: 5, checkState: 'FAILURE' }),
        reason: 'change',
        changes: ['checks', 'comments'],
        summary: 'Checks failed · 4 new comments',
      },
    ]

    assert.deepEqual(
      pendingNotifications(later, announced).send.map((entry) => entry.item.id),
      ['a'],
    )
  })

  it('forgets rows that are no longer changed', () => {
    const { announced } = pendingNotifications(changed, {})
    assert.deepEqual(pendingNotifications([], announced).announced, {})
  })

  it('speaks again when a reminder comes round on a row it already announced', () => {
    const { announced } = pendingNotifications(changed, {})
    const reminded: WaitingItem[] = [
      { ...changed[0], reason: 'reminder', summary: 'Reminder · 3 new comments' },
    ]

    assert.deepEqual(
      pendingNotifications(reminded, announced).send.map((entry) => entry.reason),
      ['reminder'],
    )
  })
})
