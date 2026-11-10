import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  UNASSIGNED,
  applyQuickFilter,
  authorsOf,
  buildRows,
  collapseRows,
  expandStacks,
  filterItems,
  foldStacks,
  groupItems,
  groupKeysOf,
  quickFilterOptions,
  sortItems,
  toggleQuickFilter,
} from '../src/lib/list-view.ts'
import type { SearchItem, Stack } from '../src/lib/github/types.ts'
import type { ListRow } from '../src/lib/list-view.ts'

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

  it('matches needs review only on open pull requests that are ready for review', () => {
    const waiting = [
      item({ id: 'open', state: 'open', reviewDecision: 'REVIEW_REQUIRED' }),
      item({ id: 'draft', state: 'draft', reviewDecision: 'REVIEW_REQUIRED' }),
      item({ id: 'queued', state: 'queued', reviewDecision: 'REVIEW_REQUIRED' }),
      item({ id: 'closed', state: 'closed', reviewDecision: 'REVIEW_REQUIRED' }),
      item({ id: 'draft-approved', state: 'draft', reviewDecision: 'APPROVED' }),
    ]
    assert.deepEqual(ids(applyQuickFilter(waiting, { review: ['REVIEW_REQUIRED'] })), ['open'])
    assert.deepEqual(ids(applyQuickFilter(waiting, { review: ['APPROVED'] })), ['draft-approved'])
  })

  it('tells open pull requests from open issues, drafts, and queued pull requests', () => {
    const states = [
      item({ id: 'pr', kind: 'pull-request', state: 'open' }),
      item({ id: 'issue', kind: 'issue', state: 'open' }),
      item({ id: 'draft', kind: 'pull-request', state: 'draft' }),
      item({ id: 'queued', kind: 'pull-request', state: 'queued' }),
      item({ id: 'merged', kind: 'pull-request', state: 'merged' }),
    ]
    assert.deepEqual(ids(applyQuickFilter(states, { state: ['open-pull-request'] })), ['pr'])
    assert.deepEqual(ids(applyQuickFilter(states, { state: ['open-issue'] })), ['issue'])
    assert.deepEqual(ids(applyQuickFilter(states, { state: ['queued'] })), ['queued'])
    assert.deepEqual(
      ids(applyQuickFilter(states, { state: ['open-pull-request', 'draft'] })),
      ['pr', 'draft'],
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

  it('leaves drafts out of the needs review count', () => {
    const waiting = [
      item({ id: 'open', state: 'open', reviewDecision: 'REVIEW_REQUIRED' }),
      item({ id: 'draft', state: 'draft', reviewDecision: 'REVIEW_REQUIRED' }),
    ]
    assert.deepEqual(counts(quickFilterOptions(waiting, waiting, {}).review), { REVIEW_REQUIRED: 1 })
    // A list where only drafts need review does not offer it at all.
    assert.deepEqual(quickFilterOptions(waiting.slice(1), waiting.slice(1), {}).review, [])
  })

  it('offers each state the rows have, in menu order', () => {
    const states = [
      item({ id: 'queued', state: 'queued' }),
      item({ id: 'issue', kind: 'issue', state: 'open' }),
      item({ id: 'draft', state: 'draft' }),
      item({ id: 'pr', state: 'open' }),
      item({ id: 'pr2', state: 'open' }),
    ]
    assert.deepEqual(
      quickFilterOptions(states, states, {}).state.map((option) => [option.value, option.count]),
      [['open-pull-request', 2], ['open-issue', 1], ['draft', 1], ['queued', 1]],
    )
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

  it('gathers rows by author, with rows that have no author last', () => {
    const mixed = [
      item({ id: 'unknown', authorLogin: null, authorAvatarUrl: null }),
      item({ id: 'hubot', authorLogin: 'hubot', authorAvatarUrl: 'https://avatars/hubot' }),
      item({ id: 'alice', authorLogin: 'Alice', authorAvatarUrl: null }),
      item({ id: 'hubot2', authorLogin: 'hubot', authorAvatarUrl: 'https://avatars/hubot' }),
    ]
    const grouped = groupItems(mixed, 'author')
    assert.deepEqual(shape(grouped), [
      { key: 'author:Alice', label: 'Alice', ids: ['alice'] },
      { key: 'author:hubot', label: 'hubot', ids: ['hubot', 'hubot2'] },
      { key: 'author:__none__', label: 'Unknown author', ids: ['unknown'] },
    ])
    assert.equal(grouped[1].avatarUrl, 'https://avatars/hubot')
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
        nesting: null,
      })),
    )
  })

  it('opens with a Pinned section, then a header per group', () => {
    const built = buildRows(pinned, rest, 'repository')
    assert.deepEqual(
      built.map((row) => (row.type === 'header' ? `#${row.label}(${row.count})` : row.key)),
      ['#Pinned(1)', 'pinned:p', '#acme/app(1)', 'repository:acme/app:a', '#acme/tools(1)', 'repository:acme/tools:b'],
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
    list.map((row) => (row.type === 'header' ? `#${row.label}` : row.type === 'item' ? row.item.id : row.key))

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

/** A loaded row that is layer `position` of stack S. */
function layer(id: string, position: number, overrides: Partial<SearchItem> = {}): SearchItem {
  return item({
    id,
    title: `Layer ${position}`,
    stack: { id: 'S', number: 9, size: 4, baseRefName: 'main', position },
    ...overrides,
  })
}

/** What each entry or row is, in order: an id, or `[layer ids]` for a stack. */
function shapeOf(listed: Array<{ type: string; item?: SearchItem; stack?: { layers: SearchItem[] } }>) {
  return listed.map((row) =>
    row.type === 'stack' ? `[${row.stack!.layers.map((entry) => entry.id).join(' ')}]` : row.item!.id,
  )
}

describe('foldStacks', () => {
  it('folds layers from anywhere in the list into one stack, in the slot of the first', () => {
    const folded = foldStacks([], [item({ id: 'a' }), layer('l3', 3), item({ id: 'b' }), layer('l1', 1)])

    assert.deepEqual(shapeOf(folded.rest), ['a', '[l1 l3]', 'b'])
    const stack = folded.rest[1]
    assert.equal(stack.type === 'stack' && stack.stack.lead.id, 'l1')
  })

  it('leaves a stack with one loaded layer as a plain row', () => {
    assert.deepEqual(shapeOf(foldStacks([], [item({ id: 'a' }), layer('l2', 2)]).rest), ['a', 'l2'])
  })

  it('pins a stack when any loaded layer is pinned, at its earliest pin', () => {
    const folded = foldStacks([item({ id: 'p' }), layer('l2', 2)], [item({ id: 'a' }), layer('l1', 1)])

    assert.deepEqual(shapeOf(folded.pinned), ['p', '[l1 l2]'])
    assert.deepEqual(shapeOf(folded.rest), ['a'])
  })

  it('puts a pull request in a stack once, however often it is listed', () => {
    const folded = foldStacks([], [layer('l1', 1), layer('l1', 1), layer('l2', 2)])

    assert.deepEqual(shapeOf(folded.rest), ['[l1 l2]'])
  })

  it('folds only the rows the filter leaves', () => {
    const layers = [layer('l1', 1, { title: 'Cache the search' }), layer('l2', 2, { title: 'Draw rows' })]

    assert.deepEqual(shapeOf(foldStacks([], filterItems(layers, 'cache')).rest), ['l1'])
  })
})

describe('authorsOf', () => {
  it('lists each author once, in row order, with the first avatar any of their rows gives', () => {
    const authors = authorsOf([
      item({ id: 'a', authorLogin: 'octocat', authorAvatarUrl: null }),
      item({ id: 'b', authorLogin: 'hubot', authorAvatarUrl: 'https://avatars/hubot' }),
      item({ id: 'c', authorLogin: 'octocat', authorAvatarUrl: 'https://avatars/octocat' }),
      item({ id: 'd', authorLogin: null }),
    ])

    assert.deepEqual(authors, [
      { login: 'octocat', avatarUrl: 'https://avatars/octocat' },
      { login: 'hubot', avatarUrl: 'https://avatars/hubot' },
    ])
  })
})

describe('buildRows with stacks', () => {
  it('keys a stack row by its stack when ungrouped', () => {
    const built = buildRows([], [layer('l1', 1), layer('l2', 2)], 'none')

    assert.deepEqual(built.map((row) => row.key), ['stack:S'])
  })

  it('puts a stack under the group of its lead layer, counting every pull request in it', () => {
    const built = buildRows(
      [],
      [layer('l2', 2, { state: 'draft' }), layer('l1', 1), item({ id: 'a', state: 'draft' })],
      'status',
    )

    assert.deepEqual(
      built.map((row) => (row.type === 'header' ? `#${row.label}(${row.count})` : row.key)),
      ['#Open(2)', 'status:open:stack:S', '#Draft(1)', 'status:draft:a'],
    )
  })
})

describe('expandStacks', () => {
  const whole: Stack = {
    id: 'S',
    number: 9,
    size: 4,
    baseRefName: 'main',
    fetchedAt: 1,
    layers: [1, 2, 3, 4].map((position) => ({
      id: `l${position}`,
      number: 100 + position,
      title: `Layer ${position}`,
      url: `https://github.com/acme/app/pull/${100 + position}`,
      repository: 'acme/app',
      state: 'open' as const,
      position,
    })),
  }
  const stackRow = (groupKey: string | null): ListRow => ({
    type: 'stack',
    key: groupKey ? `${groupKey}:stack:S` : 'stack:S',
    groupKey,
    stack: { id: 'S', lead: layer('l1', 1), layers: [layer('l1', 1), layer('l3', 3)] },
  })
  const built = [stackRow(null)]
  const expanded = new Set(['S'])
  const labelled = (expandedRows: ReturnType<typeof expandStacks>) =>
    expandedRows.map((row) => {
      const last = 'nesting' in row && row.nesting?.isLast ? '.' : ''
      if (row.type === 'item') return `item ${row.item.id}${last}`
      if (row.type === 'layer') return `layer ${row.layer.id}${last}`
      if (row.type === 'stack-status') return `${row.status}${last}`
      return row.type
    })

  it('lists the layers top first, with full rows for loaded layers and compact rows for the rest', () => {
    const opened = expandStacks(built, expanded, new Map([['S', { stack: whole, isLoading: false, isFailed: false }]]))

    assert.deepEqual(labelled(opened), ['stack', 'layer l4', 'item l3', 'layer l2', 'item l1.'])
  })

  it('shows the loaded layers and a loading row until the stack arrives', () => {
    assert.deepEqual(labelled(expandStacks(built, expanded, new Map())), [
      'stack',
      'item l3',
      'item l1',
      'loading.',
    ])
  })

  it('keeps the loaded layers and adds a failure row when the stack fails to load', () => {
    const views = new Map([['S', { stack: undefined, isLoading: false, isFailed: true }]])

    assert.deepEqual(labelled(expandStacks(built, expanded, views)), [
      'stack',
      'item l3',
      'item l1',
      'failed.',
    ])
  })

  it('still lists a loaded layer an older copy of the stack is missing', () => {
    const stale = { ...whole, layers: whole.layers.filter((entry) => entry.id !== 'l3') }
    const views = new Map([['S', { stack: stale, isLoading: false, isFailed: false }]])

    assert.deepEqual(labelled(expandStacks(built, expanded, views)), [
      'stack',
      'layer l4',
      'item l3',
      'layer l2',
      'item l1.',
    ])
  })

  it('drops a layer an older copy puts where a loaded row now sits', () => {
    const moved = {
      ...whole,
      layers: whole.layers.map((entry) => (entry.id === 'l3' ? { ...entry, id: 'l9' } : entry)),
    }
    const views = new Map([['S', { stack: moved, isLoading: false, isFailed: false }]])

    assert.deepEqual(labelled(expandStacks(built, expanded, views)), [
      'stack',
      'layer l4',
      'item l3',
      'layer l2',
      'item l1.',
    ])
  })

  it('leaves out a layer that shows in another row', () => {
    const views = new Map([['S', { stack: whole, isLoading: false, isFailed: false }]])
    const elsewhere: ListRow = { type: 'item', key: 'l4', groupKey: null, item: item({ id: 'l4' }), nesting: null }

    assert.deepEqual(labelled(expandStacks([...built, elsewhere], expanded, views)), [
      'stack',
      'item l3',
      'layer l2',
      'item l1.',
      'item l4',
    ])
  })

  it('leaves the rows alone when no stack is expanded', () => {
    assert.equal(expandStacks(built, new Set(), new Map()), built)
  })

  it('folds an expanded stack away with its group', () => {
    const opened = expandStacks([stackRow('repository:acme/app')], expanded, new Map())

    assert.deepEqual(labelled(collapseRows(opened, new Set(['repository:acme/app']))), [])
  })
})
