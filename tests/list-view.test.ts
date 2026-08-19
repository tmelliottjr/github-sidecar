import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { filterItems, sortItems } from '../src/lib/list-view.ts'
import type { SearchItem } from '../src/lib/github/types.ts'

function item(overrides: Partial<SearchItem>): SearchItem {
  return {
    id: 'PR_1',
    kind: 'pull-request',
    number: 1,
    title: 'Fix the thing',
    url: 'https://github.com/acme/app/pull/1',
    repository: 'acme/app',
    authorLogin: 'octocat',
    authorAvatarUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    state: 'open',
    stateReason: null,
    commentCount: 0,
    labels: [],
    labelCount: 0,
    reviewDecision: null,
    checkState: null,
    additions: null,
    deletions: null,
    headRefName: null,
    headRefOid: null,
    mergeState: null,
    failingChecks: [],
    checkCount: null,
    checksRead: 0,
    stack: null,
    ...overrides,
  }
}

const rows = [
  item({ id: 'a', number: 10, title: 'Cache the search results', repository: 'acme/app', updatedAt: '2026-03-03T00:00:00Z' }),
  item({ id: 'b', number: 2, title: 'Fix the flaky test', repository: 'acme/tools', authorLogin: 'hubot', updatedAt: '2026-01-01T00:00:00Z' }),
  item({ id: 'c', number: 3, title: 'Search is slow on large repos', repository: 'acme/app', labels: [{ name: 'perf', color: 'ededed' }], updatedAt: '2026-02-02T00:00:00Z' }),
]

describe('filterItems', () => {
  it('matches across everything the row shows', () => {
    assert.deepEqual(filterItems(rows, 'search').map((row) => row.id), ['a', 'c'])
    assert.deepEqual(filterItems(rows, 'tools').map((row) => row.id), ['b'])
    assert.deepEqual(filterItems(rows, 'hubot').map((row) => row.id), ['b'])
    assert.deepEqual(filterItems(rows, '#10').map((row) => row.id), ['a'])
    assert.deepEqual(filterItems(rows, 'perf').map((row) => row.id), ['c'])
  })

  it('narrows with each word rather than widening', () => {
    assert.deepEqual(filterItems(rows, 'search app').map((row) => row.id), ['a', 'c'])
    assert.deepEqual(filterItems(rows, 'search slow').map((row) => row.id), ['c'])
    assert.deepEqual(filterItems(rows, 'search nothing'), [])
  })

  it('leaves the list alone when nothing was typed', () => {
    assert.equal(filterItems(rows, '   '), rows)
  })
})

describe('sortItems', () => {
  it('leaves GitHub’s own order alone by default', () => {
    assert.equal(sortItems(rows, 'default'), rows)
  })

  it('puts what has waited longest first', () => {
    assert.deepEqual(sortItems(rows, 'stalest').map((row) => row.id), ['b', 'c', 'a'])
  })

  it('groups by repository, then by number', () => {
    assert.deepEqual(sortItems(rows, 'repository').map((row) => row.id), ['c', 'a', 'b'])
  })

  it('never reorders the list it was given', () => {
    const before = rows.map((row) => row.id)
    sortItems(rows, 'stalest')
    assert.deepEqual(rows.map((row) => row.id), before)
  })
})
