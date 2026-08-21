import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  changesSince,
  describeChanges,
  isHidden,
  reminderChoiceLabel,
  reminderDueAt,
  reminderState,
  signatureOf,
  type ItemSignature,
} from '../src/lib/attention.ts'
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

const seen: ItemSignature = signatureOf(item())

describe('changesSince', () => {
  it('says nothing about a row it has never seen', () => {
    // Rows are seeded silently on first sight, so "no memory" cannot mean
    // "everything changed" — that would mark the whole list on day one.
    assert.deepEqual(changesSince(undefined, item()), [])
  })

  it('says nothing about a row that has not moved', () => {
    assert.deepEqual(changesSince(seen, item()), [])
  })

  it('reads each kind of change off the fields that carry it', () => {
    assert.deepEqual(changesSince(seen, item({ state: 'merged' })), ['state'])
    assert.deepEqual(changesSince(seen, item({ reviewDecision: 'APPROVED' })), ['review'])
    assert.deepEqual(changesSince(seen, item({ checkState: 'FAILURE' })), ['checks'])
    assert.deepEqual(changesSince(seen, item({ commentCount: 5 })), ['comments'])
    assert.deepEqual(changesSince(seen, item({ headRefOid: 'def' })), ['commits'])
  })

  it('ignores an edit that moved nothing worth a second look', () => {
    // A retitled, relabelled row with a newer timestamp is still the same
    // row as far as the reader is concerned.
    const edited = item({
      title: 'Fix the thing, again',
      updatedAt: '2026-06-01T00:00:00Z',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      labelCount: 1,
    })
    assert.deepEqual(changesSince(seen, edited), [])
  })

  it('ignores a deleted comment, which is not news', () => {
    assert.deepEqual(changesSince(seen, item({ commentCount: 1 })), [])
  })

  it('leads with the change that asks the most of the reader', () => {
    const busy = item({
      state: 'merged',
      reviewDecision: 'APPROVED',
      checkState: 'SUCCESS',
      commentCount: 4,
      headRefOid: 'def',
    })
    assert.deepEqual(changesSince(seen, busy), [
      'state',
      'review',
      'checks',
      'comments',
      'commits',
    ])
  })

  it('says what happened rather than which field moved', () => {
    const changed = item({ commentCount: 3, checkState: 'FAILURE' })
    assert.equal(
      describeChanges(changesSince(seen, changed), changed, seen),
      'Checks failed · 1 new comment',
    )
  })
})

describe('reminders', () => {
  const at = (iso: string) => new Date(iso)

  it('rounds a named time to the hour, in the reader’s own clock', () => {
    const now = at('2026-03-05T14:23:45')

    assert.equal(reminderDueAt('hour', now), now.getTime() + 60 * 60_000)
    assert.equal(reminderDueAt('evening', now), at('2026-03-05T18:00:00').getTime())
    assert.equal(reminderDueAt('tomorrow', now), at('2026-03-06T09:00:00').getTime())
    assert.equal(reminderDueAt('week', now), at('2026-03-12T09:00:00').getTime())
    // A reminder that waits for the row itself has no time at all.
    assert.equal(reminderDueAt('change', now), null)
  })

  it('never sets an evening that has already gone', () => {
    const night = at('2026-03-05T23:30:00')
    assert.equal(reminderDueAt('evening', night), at('2026-03-06T18:00:00').getTime())
  })

  it('takes a developer’s word for it over the clock', () => {
    const now = at('2026-03-05T14:23:45')
    const overrides = { hour: 30, evening: 60, tomorrow: 120, week: 300 }

    assert.equal(reminderDueAt('hour', now, overrides), now.getTime() + 30_000)
    assert.equal(reminderDueAt('week', now, overrides), now.getTime() + 300_000)
    // A reminder that waits on the row has no clock to override.
    assert.equal(reminderDueAt('change', now, overrides), null)

    // And the menu says what will happen rather than what it usually means.
    assert.equal(reminderChoiceLabel('tomorrow'), 'Tomorrow morning')
    assert.equal(reminderChoiceLabel('tomorrow', overrides), 'Tomorrow morning · 120s')
    assert.equal(reminderChoiceLabel('change', overrides), 'When it changes')
  })

  it('comes due on the clock', () => {
    const memory = { seen, seenAt: 0, reminder: { dueAt: 1000, signature: seen, setAt: 0 } }

    assert.equal(reminderState(memory, item(), 999), 'waiting')
    assert.equal(reminderState(memory, item(), 1000), 'due')
    assert.equal(reminderState(undefined, item(), 5000), 'none')
  })

  it('comes due when the row moves, for one that waits on the row', () => {
    const memory = { seen, seenAt: 0, reminder: { dueAt: null, signature: seen, setAt: 0 } }

    assert.equal(reminderState(memory, item()), 'waiting')
    assert.equal(reminderState(memory, item({ commentCount: 6 })), 'due')
  })
})

describe('hidden rows', () => {
  it('is hidden only once the reader has hidden it', () => {
    assert.equal(isHidden({ seen, seenAt: 0 }), false)
    assert.equal(isHidden({ seen, seenAt: 0, hiddenAt: 5 }), true)
    assert.equal(isHidden(undefined), false)
  })
})
