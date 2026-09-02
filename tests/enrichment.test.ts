import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyEnrichment,
  carryEnrichment,
  mergeEnrichments,
} from '../src/lib/github/enrichment.ts'
import type { ItemEnrichment, SearchItem, SearchPage } from '../src/lib/github/types.ts'

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
    commentCount: 0,
    labels: [],
    labelCount: 0,
    reviewDecision: null,
    checkState: null,
    additions: 10,
    deletions: 2,
    headRefName: 'octocat/fix',
    headRefOid: 'abc',
    mergeState: null,
    failingChecks: [],
    checkCount: null,
    checksRead: 0,
    stack: null,
    enrichment: 'pending',
    ...overrides,
  }
}

function page(items: SearchItem[]): SearchPage {
  return {
    items,
    totalCount: items.length,
    endCursor: null,
    hasNextPage: false,
    fetchedAt: 1000,
    warning: null,
  }
}

function enrichment(overrides: Partial<ItemEnrichment> = {}): ItemEnrichment {
  return {
    id: 'PR_1',
    reviewDecision: 'APPROVED',
    checkState: 'FAILURE',
    failingChecks: [{ name: 'unit tests', url: null }],
    checkCount: 3,
    checksRead: 3,
    mergeState: 'behind',
    stack: null,
    ...overrides,
  }
}

describe('applyEnrichment', () => {
  it('fills in the costly half and leaves the cheap half alone', () => {
    const merged = applyEnrichment(item(), enrichment())

    assert.equal(merged.enrichment, 'ready')
    assert.equal(merged.reviewDecision, 'APPROVED')
    assert.equal(merged.checkState, 'FAILURE')
    assert.equal(merged.mergeState, 'behind')
    assert.equal(merged.checkCount, 3)

    assert.equal(merged.title, 'Fix the thing')
    assert.equal(merged.additions, 10)
    assert.equal(merged.headRefOid, 'abc')
  })

  it('replaces a conflict the search had already found', () => {
    // `mergeable` reaches the row with the search and only knows about
    // conflicts; this is the fuller answer for the same question.
    const merged = applyEnrichment(
      item({ mergeState: 'conflicting' }),
      enrichment({ mergeState: 'clean' }),
    )
    assert.equal(merged.mergeState, 'clean')
  })
})

describe('mergeEnrichments', () => {
  it('merges into whichever copy of the row the page is holding', () => {
    // The row was refreshed while the second request was out, so the copy the
    // request started from is already stale. Merging by field is what keeps
    // the newer title rather than putting the older one back.
    const newer = item({ title: 'Fix the thing, again', commentCount: 4 })
    const merged = mergeEnrichments(page([newer]), {
      enrichments: [enrichment()],
      failedIds: [],
    })

    assert.ok(merged)
    assert.equal(merged.items[0].title, 'Fix the thing, again')
    assert.equal(merged.items[0].commentCount, 4)
    assert.equal(merged.items[0].checkState, 'FAILURE')
  })

  it('marks a row it could not read, so it stops waiting', () => {
    const merged = mergeEnrichments(page([item()]), {
      enrichments: [],
      failedIds: ['PR_1'],
    })

    assert.equal(merged?.items[0].enrichment, 'failed')
  })

  it('keeps the marks of a row it could not re-read, but says it could not', () => {
    // The row holds the last answer anyone got and goes on showing it. What
    // changes is that the panel now says it is no longer being told — without
    // this, a repository the token has lost access to would keep a green check
    // on screen for ever and nothing would ever mention it.
    const ready = applyEnrichment(item(), enrichment())
    const merged = mergeEnrichments(page([ready]), {
      enrichments: [],
      failedIds: ['PR_1'],
    })

    assert.ok(merged)
    assert.equal(merged.items[0].enrichment, 'failed')
    assert.equal(merged.items[0].checkState, 'FAILURE')
    assert.deepEqual(merged.items[0].failingChecks, [{ name: 'unit tests', url: null }])
  })

  it('does not rewrite a row that was already marked unreadable', () => {
    const failed = { ...applyEnrichment(item(), enrichment()), enrichment: 'failed' as const }
    assert.equal(
      mergeEnrichments(page([failed]), { enrichments: [], failedIds: ['PR_1'] }),
      null,
    )
  })

  it('says a page held none of them rather than rewriting it', () => {
    const merged = mergeEnrichments(page([item({ id: 'PR_9' })]), {
      enrichments: [enrichment()],
      failedIds: [],
    })

    assert.equal(merged, null)
  })
})

describe('carryEnrichment', () => {
  const previous = page([applyEnrichment(item(), enrichment()), item({ id: 'PR_2' })])

  it('carries the marks of a row the last refresh answered for', () => {
    const carried = carryEnrichment(page([item(), item({ id: 'PR_3' })]), previous)

    assert.equal(carried.items[0].enrichment, 'ready')
    assert.equal(carried.items[0].checkState, 'FAILURE')
    assert.equal(carried.items[0].reviewDecision, 'APPROVED')

    // A row the previous page never answered for has nothing to carry, and a
    // row it never held at all is left waiting.
    assert.equal(carried.items[1].enrichment, 'pending')
  })

  it('carries a failed row as failed, marks and all', () => {
    // Both halves of it survive the refresh: the marks, which are still the
    // best answer anyone has, and the fact that they could not be re-read,
    // which is what keeps the notice above the list from flickering away.
    const failed = page([
      { ...applyEnrichment(item(), enrichment()), enrichment: 'failed' as const },
    ])
    const carried = carryEnrichment(page([item()]), failed)

    assert.equal(carried.items[0].enrichment, 'failed')
    assert.equal(carried.items[0].checkState, 'FAILURE')
  })

  it('leaves the fresh page as it is when there is nothing to carry from', () => {
    const fresh = page([item()])
    assert.equal(carryEnrichment(fresh, undefined), fresh)
  })
})
