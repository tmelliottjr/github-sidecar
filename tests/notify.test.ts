import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildGroupNotification,
  buildNotification,
  searchUrl,
  MAX_INDIVIDUAL,
} from '../src/lib/notify.ts'
import type { WaitingItem } from '../src/lib/attention.ts'
import type { SearchItem } from '../src/lib/github/types.ts'

const ICON = 'chrome-extension://abc/icon-128.png'

function item(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    id: 'PR_1',
    kind: 'pull-request',
    number: 34,
    title: 'Cache the search results',
    url: 'https://github.com/acme/app/pull/34',
    repository: 'acme/app',
    authorLogin: 'octocat',
    authorAvatarUrl: 'https://avatars.example/u/1',
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: 'open',
    stateReason: null,
    commentCount: 4,
    labels: [],
    labelCount: 0,
    reviewDecision: null,
    checkState: 'FAILURE',
    additions: null,
    deletions: null,
    headRefName: null,
    headRefOid: null,
    mergeState: null,
    failingChecks: [],
    checkCount: null,
    checksRead: 0,
    stack: null,
    enrichment: 'ready',
    ...overrides,
  }
}

const change: WaitingItem = {
  item: item(),
  reason: 'change',
  changes: ['checks', 'comments'],
  summary: 'Checks failed · 3 new comments',
}

const reminder: WaitingItem = {
  ...change,
  reason: 'reminder',
  summary: 'Reminder · Checks failed',
}

describe('one notification', () => {
  it('leads with the row, then what happened, then where it lives', () => {
    const { options } = buildNotification(change, ICON)

    assert.equal(options.title, 'Cache the search results')
    assert.equal(options.message, 'Checks failed · 3 new comments')
    assert.equal(options.contextMessage, 'acme/app #34 · by octocat')
  })

  it('wears the author’s face, and the extension’s where there is none', () => {
    assert.equal(buildNotification(change, ICON).options.iconUrl, 'https://avatars.example/u/1')
    assert.equal(
      buildNotification({ ...change, item: item({ authorAvatarUrl: null }) }, ICON).options
        .iconUrl,
      ICON,
    )
  })

  it('lets a reminder interrupt, and leaves a change to be noticed', () => {
    const asked = buildNotification(reminder, ICON).options
    const unasked = buildNotification(change, ICON).options

    // Asked for by name: allowed to be loud and to stay until it is dealt with.
    assert.equal(asked.priority, 2)
    assert.equal(asked.requireInteraction, true)
    assert.equal(asked.silent, false)

    assert.equal(unasked.priority, 0)
    assert.equal(unasked.requireInteraction, false)
    assert.equal(unasked.silent, true)
  })

  it('offers the answer the reader would otherwise give by hand', () => {
    assert.deepEqual(buildNotification(change, ICON).options.buttons, [
      { title: 'Mark as seen' },
    ])
    assert.deepEqual(buildNotification(reminder, ICON).options.buttons, [
      { title: 'Remind me in an hour' },
    ])

    assert.deepEqual(buildNotification(change, ICON).target, {
      itemIds: ['PR_1'],
      url: 'https://github.com/acme/app/pull/34',
      action: 'seen',
    })
    assert.equal(buildNotification(reminder, ICON).target.action, 'later')
  })
})

describe('several at once', () => {
  const many = Array.from({ length: 7 }, (_, index) => ({
    ...change,
    item: item({ id: `PR_${index}`, number: index, title: `Row ${index}` }),
    summary: `${index} new comments`,
  }))

  it('is one thing that happened, not seven', () => {
    assert.ok(many.length > MAX_INDIVIDUAL)
    const { options, target } = buildGroupNotification(many, ICON, {
      queryName: 'Needs my review',
      url: searchUrl('is:open is:pr review-requested:@me'),
    })

    assert.equal(options.type, 'list')
    assert.equal(options.title, '7 rows need you')
    assert.equal(options.contextMessage, 'Needs my review')
    assert.deepEqual(target.itemIds.length, 7)
    assert.equal(target.action, 'seen')
  })

  it('names what it can and counts the rest', () => {
    const { options } = buildGroupNotification(many, ICON, { queryName: null, url: null })
    const items = options.items ?? []

    assert.equal(items.length, 6)
    assert.deepEqual(items[0], { title: 'acme/app #0', message: '0 new comments' })
    assert.deepEqual(items.at(-1), { title: 'and 2 more', message: '' })
    // Chrome shows the list only where it has room, so the message alone still
    // says something.
    assert.match(options.message ?? '', /acme\/app #0/)
  })

  it('is as loud as the loudest reason in it', () => {
    const quiet = buildGroupNotification(many, ICON, { queryName: null, url: null }).options
    assert.equal(quiet.silent, true)
    assert.equal(quiet.priority, 0)

    const asked = buildGroupNotification([...many, reminder], ICON, {
      queryName: null,
      url: null,
    }).options
    assert.equal(asked.silent, false)
    assert.equal(asked.priority, 2)
  })
})

describe('searchUrl', () => {
  it('points at the search that produced the rows', () => {
    assert.equal(
      searchUrl('is:open is:pr review-requested:@me'),
      'https://github.com/search?q=is%3Aopen%20is%3Apr%20review-requested%3A%40me&type=issues',
    )
  })
})
