import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { itemMarkdown, markdownLink, stackMarkdown, stackUrls } from '../src/lib/links.ts'
import type { SearchItem, StackInfo } from '../src/lib/github/types.ts'

function stack(overrides: Partial<StackInfo> = {}): StackInfo {
  return {
    number: 4,
    size: 3,
    baseRefName: 'main',
    position: 2,
    entries: [
      {
        id: 'a',
        number: 101,
        title: 'Groundwork',
        url: 'https://github.com/acme/app/pull/101',
        repository: 'acme/app',
        state: 'open',
        reviewDecision: null,
        position: 1,
      },
      {
        id: 'b',
        number: 102,
        title: 'The middle',
        url: 'https://github.com/acme/app/pull/102',
        repository: 'acme/app',
        state: 'open',
        reviewDecision: null,
        position: 2,
      },
      {
        id: 'c',
        number: 103,
        title: 'The last layer',
        url: 'https://github.com/acme/app/pull/103',
        repository: 'acme/app',
        state: 'open',
        reviewDecision: null,
        position: 3,
      },
    ],
    ...overrides,
  }
}

function item(overrides: Partial<SearchItem> = {}): SearchItem {
  return {
    id: 'PR_1',
    kind: 'pull-request',
    number: 102,
    title: 'The middle',
    url: 'https://github.com/acme/app/pull/102',
    repository: 'acme/app',
    authorLogin: null,
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

describe('markdownLink', () => {
  it('writes the ordinary case ordinarily', () => {
    assert.equal(
      markdownLink('Fix the thing', 'https://github.com/acme/app/pull/1'),
      '[Fix the thing](https://github.com/acme/app/pull/1)',
    )
  })

  it('escapes what would end the link early', () => {
    // Brackets close the link text; a backslash escapes whatever follows it.
    assert.equal(
      markdownLink('Fix [the thing] \\ again', 'https://x/1'),
      '[Fix \\[the thing\\] \\\\ again](https://x/1)',
    )
  })

  it('wraps a target that could not survive bare', () => {
    assert.equal(markdownLink('One', 'https://x/a(b)'), '[One](<https://x/a(b)>)')
    // Parentheses in the text are harmless, so they are left alone.
    assert.equal(markdownLink('One (two)', 'https://x/1'), '[One (two)](https://x/1)')
  })
})

describe('one row as Markdown', () => {
  it('is title and link, and nothing else', () => {
    assert.equal(
      itemMarkdown(item()),
      '[The middle](https://github.com/acme/app/pull/102)',
    )
  })

  it('says which layer, where the row is one of several', () => {
    // The difference between "the fix" and "the third part of the fix".
    assert.equal(
      itemMarkdown(item({ stack: stack() })),
      '[The middle <2/3>](https://github.com/acme/app/pull/102)',
    )
  })
})

describe('a whole stack', () => {
  it('lists every link, base first', () => {
    assert.equal(
      stackUrls(stack()),
      [
        'https://github.com/acme/app/pull/101',
        'https://github.com/acme/app/pull/102',
        'https://github.com/acme/app/pull/103',
      ].join('\n'),
    )
  })

  it('numbers each layer against the whole stack as Markdown', () => {
    assert.equal(
      stackMarkdown(stack()),
      [
        '[Groundwork <1/3>](https://github.com/acme/app/pull/101)',
        '[The middle <2/3>](https://github.com/acme/app/pull/102)',
        '[The last layer <3/3>](https://github.com/acme/app/pull/103)',
      ].join('\n'),
    )
  })

  it('counts against the stack’s real size, not the layers it could read', () => {
    // GitHub reports how deep the stack is even when it hands back fewer
    // layers than that, and a list saying 1/2 of a five-deep stack would lie.
    const partial = stack({ size: 5, entries: stack().entries.slice(0, 2) })

    assert.equal(
      stackMarkdown(partial),
      [
        '[Groundwork <1/5>](https://github.com/acme/app/pull/101)',
        '[The middle <2/5>](https://github.com/acme/app/pull/102)',
      ].join('\n'),
    )
  })
})
