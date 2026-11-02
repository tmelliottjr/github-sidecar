import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  UNASSIGNED,
  applyQuickFilter,
  buildRows,
  collapseRows,
  filterItems,
  groupItems,
  groupKeysOf,
  quickFilterOptions,
  sortItems,
  toggleQuickFilter,
} from '../src/lib/list-view.ts'
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
    assignees: [],
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
    enrichment: 'ready',
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

  it('matches on an assignee’s login', () => {
    const assigned = [
      item({ id: 'x', assignees: [{ login: 'monalisa', avatarUrl: null }] }),
      item({ id: 'y', assignees: [] }),
    ]
    assert.deepEqual(filterItems(assigned, 'monalisa').map((row) => row.id), ['x'])
  })
})

describe('applyQuickFilter', () => {
  const reviewed = [
    item({ id: 'a', reviewDecision: 'APPROVED', authorLogin: 'octocat' }),
    item({ id: 'b', reviewDecision: 'CHANGES_REQUESTED', authorLogin: 'octocat' }),
    item({ id: 'c', reviewDecision: 'APPROVED', authorLogin: 'hubot' }),
    item({ id: 'd', reviewDecision: 'REVIEW_REQUIRED', authorLogin: 'octocat' }),
  ]
  const ids = (list: SearchItem[]) => list.map((row) => row.id)

  it('widens within a facet and narrows across facets', () => {
    const review = { review: ['APPROVED', 'CHANGES_REQUESTED'] }
    assert.deepEqual(ids(applyQuickFilter(reviewed, review)), ['a', 'b', 'c'])
    assert.deepEqual(ids(applyQuickFilter(reviewed, { ...review, author: ['octocat'] })), ['a', 'b'])
  })

  it('leaves the list alone when nothing is chosen', () => {
    assert.equal(applyQuickFilter(reviewed, {}), reviewed)
    assert.equal(applyQuickFilter(reviewed, { review: [] }), reviewed)
  })

  it('counts errored checks as failing', () => {
    const checked = [
      item({ id: 'failed', checkState: 'FAILURE' }),
      item({ id: 'errored', checkState: 'ERROR' }),
      item({ id: 'pending', checkState: 'PENDING' }),
    ]
    assert.deepEqual(ids(applyQuickFilter(checked, { checks: ['failing'] })), ['failed', 'errored'])
  })

  it('matches rows with no assignee as unassigned', () => {
    const assigned = [
      item({ id: 'alice', assignees: [{ login: 'alice', avatarUrl: null }] }),
      item({ id: 'nobody', assignees: [] }),
    ]
    assert.deepEqual(ids(applyQuickFilter(assigned, { assignee: [UNASSIGNED] })), ['nobody'])
    assert.deepEqual(
      ids(applyQuickFilter(assigned, { assignee: [UNASSIGNED, 'alice'] })),
      ['alice', 'nobody'],
    )
  })
})

describe('quickFilterOptions', () => {
  const reviewed = [
    item({ id: 'a', reviewDecision: 'APPROVED', authorLogin: 'octocat' }),
    item({ id: 'b', reviewDecision: 'CHANGES_REQUESTED', authorLogin: 'octocat' }),
    item({ id: 'c', reviewDecision: 'APPROVED', authorLogin: 'hubot' }),
    item({ id: 'd', reviewDecision: 'REVIEW_REQUIRED', authorLogin: 'octocat' }),
  ]
  const counts = (options: Array<{ value: string; count: number }>) =>
    Object.fromEntries(options.map((option) => [option.value, option.count]))

  it('counts each facet with every other facet applied', () => {
    const options = quickFilterOptions(reviewed, reviewed, {
      review: ['APPROVED'],
      author: ['octocat'],
    })
    // Choosing Approved leaves the other review values counted, for octocat.
    assert.deepEqual(counts(options.review), {
      REVIEW_REQUIRED: 1,
      APPROVED: 1,
      CHANGES_REQUESTED: 1,
    })
    // And choosing octocat leaves the other authors counted, for Approved.
    assert.deepEqual(counts(options.author), { octocat: 1, hubot: 1 })
    assert.deepEqual(
      options.review.map((option) => option.selected),
      [false, true, false],
    )
  })

  it('offers only what the rows have, plus anything already chosen', () => {
    const options = quickFilterOptions(reviewed, reviewed, {
      merge: ['conflicting'],
      author: ['ghost'],
    })
    assert.deepEqual(options.checks, [])
    assert.deepEqual(options.merge, [
      { value: 'conflicting', count: 0, selected: true, avatarUrl: null },
    ])
    assert.deepEqual(
      options.author.map((option) => [option.value, option.count]),
      [['octocat', 0], ['hubot', 0], ['ghost', 0]],
    )
  })

  it('offers from every row but counts only the rows the text matches', () => {
    const options = quickFilterOptions(reviewed, reviewed.slice(0, 1), {})
    assert.deepEqual(counts(options.author), { octocat: 1, hubot: 0 })
  })

  it('orders people by row count, with unassigned last, and carries their avatars', () => {
    const assigned = [
      item({ id: 'x', assignees: [] }),
      item({ id: 'y', assignees: [{ login: 'bob', avatarUrl: null }] }),
      item({ id: 'z', assignees: [
        { login: 'alice', avatarUrl: 'https://avatars/alice' },
        { login: 'bob', avatarUrl: 'https://avatars/bob' },
      ] }),
    ]
    const options = quickFilterOptions(assigned, assigned, {})
    assert.deepEqual(
      options.assignee.map((option) => [option.value, option.count, option.avatarUrl]),
      [
        ['bob', 2, 'https://avatars/bob'],
        ['alice', 1, 'https://avatars/alice'],
        [UNASSIGNED, 1, null],
      ],
    )
  })
})

describe('toggleQuickFilter', () => {
  it('adds a value, then takes it away again, without changing the filter it was given', () => {
    const before = { review: ['APPROVED'] }
    const added = toggleQuickFilter(before, 'review', 'REVIEW_REQUIRED')
    assert.deepEqual(added.review, ['APPROVED', 'REVIEW_REQUIRED'])
    assert.deepEqual(toggleQuickFilter(added, 'review', 'APPROVED').review, ['REVIEW_REQUIRED'])
    assert.deepEqual(before, { review: ['APPROVED'] })
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

/** The shape of each group, small enough to assert against directly. */
function shape(groups: ReturnType<typeof groupItems>) {
  return groups.map((group) => ({
    key: group.key,
    label: group.label,
    ids: group.items.map((row) => row.id),
  }))
}

describe('groupItems', () => {
  it('returns nothing when there is no grouping to do', () => {
    assert.deepEqual(groupItems(rows, 'none'), [])
  })

  it('gathers rows by lifecycle state, in lifecycle order', () => {
    const mixed = [
      item({ id: 'closed', state: 'closed' }),
      item({ id: 'open', state: 'open' }),
      item({ id: 'draft', state: 'draft' }),
      item({ id: 'open2', state: 'open' }),
    ]
    assert.deepEqual(shape(groupItems(mixed, 'status')), [
      { key: 'status:open', label: 'Open', ids: ['open', 'open2'] },
      { key: 'status:draft', label: 'Draft', ids: ['draft'] },
      { key: 'status:closed', label: 'Closed', ids: ['closed'] },
    ])
  })

  it('gathers rows by repository, in alphabetical order', () => {
    const mixed = [
      item({ id: 'z', repository: 'acme/zebra' }),
      item({ id: 'a', repository: 'acme/app' }),
      item({ id: 'a2', repository: 'acme/app' }),
    ]
    assert.deepEqual(shape(groupItems(mixed, 'repository')), [
      { key: 'repository:acme/app', label: 'acme/app', ids: ['a', 'a2'] },
      { key: 'repository:acme/zebra', label: 'acme/zebra', ids: ['z'] },
    ])
  })

  it('lists a row under each of its assignees, and the rest as unassigned', () => {
    const mixed = [
      item({ id: 'shared', assignees: [
        { login: 'bob', avatarUrl: null },
        { login: 'alice', avatarUrl: 'https://avatars/alice' },
      ] }),
      item({ id: 'solo', assignees: [{ login: 'alice', avatarUrl: 'https://avatars/alice' }] }),
      item({ id: 'nobody', assignees: [] }),
    ]
    const grouped = groupItems(mixed, 'assignee')
    assert.deepEqual(shape(grouped), [
      { key: 'assignee:alice', label: 'alice', ids: ['shared', 'solo'] },
      { key: 'assignee:bob', label: 'bob', ids: ['shared'] },
      { key: 'assignee:__none__', label: 'Unassigned', ids: ['nobody'] },
    ])
    // The named sections carry their assignee's avatar; unassigned has none.
    assert.equal(grouped[0].avatarUrl, 'https://avatars/alice')
    assert.equal(grouped[2].avatarUrl, null)
  })

  it('drops the unassigned section when every row has an assignee', () => {
    const mixed = [item({ id: 'x', assignees: [{ login: 'alice', avatarUrl: null }] })]
    assert.deepEqual(shape(groupItems(mixed, 'assignee')).map((group) => group.key), [
      'assignee:alice',
    ])
  })
})

describe('buildRows', () => {
  const pinned = [item({ id: 'p', repository: 'acme/app' })]
  const rest = [
    item({ id: 'a', repository: 'acme/app' }),
    item({ id: 'b', repository: 'acme/tools' }),
  ]

  it('passes rows straight through, pinned first and headerless, when ungrouped', () => {
    assert.deepEqual(
      buildRows(pinned, rest, 'none'),
      [pinned[0], rest[0], rest[1]].map((row) => ({
        type: 'item',
        key: row.id,
        groupKey: null,
        item: row,
      })),
    )
  })

  it('opens with a Pinned section, then a header per group', () => {
    const built = buildRows(pinned, rest, 'repository')
    assert.deepEqual(
      built.map((row) => (row.type === 'header' ? `#${row.label}(${row.count})` : row.item.id)),
      ['#Pinned(1)', 'p', '#acme/app(1)', 'a', '#acme/tools(1)', 'b'],
    )
  })

  it('keys a row uniquely even when it lands in more than one group', () => {
    const shared = item({ id: 'shared', assignees: [
      { login: 'alice', avatarUrl: null },
      { login: 'bob', avatarUrl: null },
    ] })
    const keys = buildRows([], [shared], 'assignee')
      .filter((row) => row.type === 'item')
      .map((row) => row.key)
    assert.deepEqual(keys, ['assignee:alice:shared', 'assignee:bob:shared'])
    assert.equal(new Set(keys).size, keys.length)
  })

  it('omits the Pinned section when nothing is pinned', () => {
    const built = buildRows([], rest, 'repository')
    assert.equal(built.some((row) => row.type === 'header' && row.label === 'Pinned'), false)
  })
})

describe('collapseRows', () => {
  const built = buildRows(
    [item({ id: 'p', repository: 'acme/app' })],
    [item({ id: 'a', repository: 'acme/app' }), item({ id: 'b', repository: 'acme/tools' })],
    'repository',
  )

  const labelled = (list: ReturnType<typeof collapseRows>) =>
    list.map((row) => (row.type === 'header' ? `#${row.label}` : row.item.id))

  it('leaves the rows untouched when nothing is collapsed', () => {
    assert.equal(collapseRows(built, new Set()), built)
  })

  it('drops a collapsed group’s items but keeps its header', () => {
    assert.deepEqual(labelled(collapseRows(built, new Set(['repository:acme/app']))), [
      '#Pinned',
      'p',
      '#acme/app',
      '#acme/tools',
      'b',
    ])
  })

  it('folds the pinned section away like any other group', () => {
    assert.deepEqual(labelled(collapseRows(built, new Set(['pinned']))), [
      '#Pinned',
      '#acme/app',
      'a',
      '#acme/tools',
      'b',
    ])
  })

  it('never folds ungrouped rows, which carry no group key', () => {
    const flat = buildRows([], [item({ id: 'x' }), item({ id: 'y' })], 'none')
    assert.deepEqual(collapseRows(flat, new Set(['anything'])), flat)
  })
})

describe('groupKeysOf', () => {
  it('lists every group key in the order its header appears', () => {
    const built = buildRows(
      [item({ id: 'p', repository: 'acme/app' })],
      [item({ id: 'a', repository: 'acme/app' }), item({ id: 'b', repository: 'acme/tools' })],
      'repository',
    )
    assert.deepEqual(groupKeysOf(built), ['pinned', 'repository:acme/app', 'repository:acme/tools'])
  })

  it('is empty for a flat list, so there is nothing to fold', () => {
    const flat = buildRows([], [item({ id: 'x' }), item({ id: 'y' })], 'none')
    assert.deepEqual(groupKeysOf(flat), [])
  })
})
