import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  GitHubApiError,
  SEARCH_QUERY,
  fetchItem,
  resetStackSupport,
  searchIssues,
} from '../src/lib/github/api.ts'

const originalFetch = globalThis.fetch

function stubFetch(body: unknown, init: { status?: number } = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
}

function searchPayload(nodes: unknown[]) {
  return {
    data: {
      search: {
        issueCount: nodes.length,
        pageInfo: { hasNextPage: true, endCursor: 'CURSOR' },
        nodes,
      },
    },
  }
}

const issueNode = {
  __typename: 'Issue',
  id: 'I_1',
  number: 12,
  title: 'Something is broken',
  url: 'https://github.com/acme/app/issues/12',
  state: 'CLOSED',
  stateReason: 'NOT_PLANNED',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  repository: { nameWithOwner: 'acme/app' },
  author: { login: 'octocat', avatarUrl: 'https://avatars/1' },
  comments: { totalCount: 3 },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
}

const pullRequestNode = {
  __typename: 'PullRequest',
  id: 'PR_1',
  number: 34,
  title: 'Fix the thing',
  url: 'https://github.com/acme/app/pull/34',
  state: 'OPEN',
  isDraft: true,
  createdAt: '2026-01-03T00:00:00Z',
  updatedAt: '2026-01-04T00:00:00Z',
  additions: 10,
  deletions: 2,
  reviewDecision: 'CHANGES_REQUESTED',
  repository: { nameWithOwner: 'acme/app' },
  author: null,
  comments: { totalCount: 0 },
  labels: { nodes: null },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('searchIssues', () => {
  it('flattens issue state and closure reason', async () => {
    stubFetch(searchPayload([issueNode]))

    const page = await searchIssues('token', { q: 'is:issue', first: 30 })
    const [item] = page.items

    assert.equal(item.kind, 'issue')
    assert.equal(item.state, 'closed')
    assert.equal(item.stateReason, 'NOT_PLANNED')
    assert.equal(item.repository, 'acme/app')
    assert.equal(item.authorLogin, 'octocat')
    assert.deepEqual(item.labels, [{ name: 'bug', color: 'd73a4a' }])
    assert.equal(item.checkState, null)
  })

  it('reports draft pull requests and their check rollup', async () => {
    stubFetch(searchPayload([pullRequestNode]))

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })
    const [item] = page.items

    assert.equal(item.kind, 'pull-request')
    // An open pull request marked isDraft must surface as draft, not open.
    assert.equal(item.state, 'draft')
    assert.equal(item.checkState, 'FAILURE')
    assert.equal(item.reviewDecision, 'CHANGES_REQUESTED')
    assert.equal(item.authorLogin, null)
    assert.deepEqual(item.labels, [])
  })

  it('prefers MERGED over the draft flag', async () => {
    stubFetch(searchPayload([{ ...pullRequestNode, state: 'MERGED' }]))

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })
    assert.equal(page.items[0].state, 'merged')
  })

  it('exposes pagination metadata', async () => {
    stubFetch(searchPayload([issueNode]))

    const page = await searchIssues('token', { q: 'is:issue', first: 30 })
    assert.equal(page.hasNextPage, true)
    assert.equal(page.endCursor, 'CURSOR')
    assert.equal(page.totalCount, 1)
  })

  it('skips nodes of unexpected types', async () => {
    stubFetch(searchPayload([{}, issueNode]))

    const page = await searchIssues('token', { q: 'is:issue', first: 30 })
    assert.equal(page.items.length, 1)
  })

  it('surfaces an actionable message for a rejected token', async () => {
    stubFetch({}, { status: 401 })

    await assert.rejects(
      () => searchIssues('bad', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.status, 401)
        assert.match(error.message, /token/i)
        return true
      },
    )
  })

  it('surfaces GraphQL errors', async () => {
    stubFetch({ errors: [{ message: 'Field does not exist' }] })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:issue', first: 30 }),
      /Field does not exist/,
    )
  })
})

describe('search syntax', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  /**
   * The legacy `ISSUE` type does not report an error on advanced syntax it
   * cannot parse, it just matches nothing, so a regression here would look
   * like an empty inbox rather than a failure.
   */
  it('asks for the advanced search parser', () => {
    assert.match(SEARCH_QUERY, /type: ISSUE_ADVANCED/)
    assert.doesNotMatch(SEARCH_QUERY, /type: ISSUE[,\s]/)
  })

  it('passes a boolean query through untouched', async () => {
    let sent: { variables: { q: string } } | null = null
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify(searchPayload([])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const q = 'is:open is:pr (label:bug OR label:regression) -label:wontfix'
    await searchIssues('token', { q, first: 30 })

    assert.equal(sent!.variables.q, q)
  })
})

describe('merge queue state', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reports a queued pull request as queued rather than open', async () => {
    stubFetch(
      searchPayload([
        { ...pullRequestNode, state: 'OPEN', isDraft: false, isInMergeQueue: true },
      ]),
    )

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })

    assert.equal(page.items[0].state, 'queued')
  })

  it('leaves a merged pull request merged even while the queue flag is set', async () => {
    stubFetch(
      searchPayload([{ ...pullRequestNode, state: 'MERGED', isInMergeQueue: true }]),
    )

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })

    assert.equal(page.items[0].state, 'merged')
  })

  it('asks GitHub for the merge queue flag', () => {
    assert.match(SEARCH_QUERY, /isInMergeQueue/)
  })
})

describe('fetchItem', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  const itemPayload = (node: unknown) => ({
    data: { repository: { issueOrPullRequest: node } },
  })

  it('normalises a single row exactly as a search would', async () => {
    stubFetch(itemPayload({ ...pullRequestNode, isInMergeQueue: true, isDraft: false }))

    const item = await fetchItem('token', { repository: 'acme/app', number: 34 })

    assert.equal(item.id, 'PR_1')
    assert.equal(item.kind, 'pull-request')
    assert.equal(item.state, 'queued')
    assert.equal(item.checkState, 'FAILURE')
    assert.equal(item.reviewDecision, 'CHANGES_REQUESTED')
    assert.equal(item.repository, 'acme/app')
  })

  it('sends the owner and name apart', async () => {
    let sent: { variables: Record<string, unknown> } | null = null
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify(itemPayload(issueNode)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await fetchItem('token', { repository: 'acme/app', number: 12 })

    assert.deepEqual(sent!.variables, { owner: 'acme', name: 'app', number: 12 })
  })

  it('rejects a repository name it cannot split', async () => {
    await assert.rejects(
      () => fetchItem('token', { repository: 'nope', number: 1 }),
      /Cannot parse the repository name/,
    )
  })

  it('reports a row GitHub cannot find', async () => {
    stubFetch(itemPayload(null))

    await assert.rejects(
      () => fetchItem('token', { repository: 'acme/app', number: 999 }),
      /acme\/app#999 could not be found/,
    )
  })
})

const stackedPullRequestNode = {
  ...pullRequestNode,
  id: 'PR_2',
  number: 35,
  stackEntry: { position: 2 },
  stack: {
    number: 7,
    size: 3,
    baseRefName: 'main',
    entries: {
      totalCount: 3,
      nodes: [
        // Deliberately out of order: the reader is told where each layer sits,
        // not which order GitHub happened to answer in.
        {
          position: 2,
          pullRequest: {
            id: 'PR_2',
            number: 35,
            title: 'Fix the thing',
            url: 'https://github.com/acme/app/pull/35',
            state: 'OPEN',
            isDraft: true,
            reviewDecision: 'CHANGES_REQUESTED',
            repository: { nameWithOwner: 'acme/app' },
          },
        },
        {
          position: 1,
          pullRequest: {
            id: 'PR_1',
            number: 34,
            title: 'Groundwork',
            url: 'https://github.com/acme/app/pull/34',
            state: 'OPEN',
            isDraft: false,
            isInMergeQueue: true,
            reviewDecision: 'APPROVED',
            repository: { nameWithOwner: 'acme/app' },
          },
        },
        // A layer the token cannot see comes back without its pull request.
        { position: 3, pullRequest: null },
      ],
    },
  },
}

describe('stacked pull requests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetStackSupport()
  })

  it('asks GitHub for stack membership', () => {
    assert.match(SEARCH_QUERY, /stackEntry\s*\{\s*position/)
    assert.match(SEARCH_QUERY, /stack\s*\{[\s\S]*baseRefName/)
  })

  it('reports where a row sits in its stack', async () => {
    stubFetch(searchPayload([stackedPullRequestNode]))

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })
    const { stack } = page.items[0]

    assert.ok(stack)
    assert.equal(stack.number, 7)
    assert.equal(stack.size, 3)
    assert.equal(stack.position, 2)
    assert.equal(stack.baseRefName, 'main')
  })

  it('lists the stack from the base branch up, skipping layers it cannot read', async () => {
    stubFetch(searchPayload([stackedPullRequestNode]))

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })
    const entries = page.items[0].stack!.entries

    assert.deepEqual(
      entries.map((entry) => entry.number),
      [34, 35],
    )
    // Every layer is flattened exactly as a row of its own would be.
    assert.equal(entries[0].state, 'queued')
    assert.equal(entries[0].reviewDecision, 'APPROVED')
    assert.equal(entries[1].state, 'draft')
    assert.equal(entries[1].repository, 'acme/app')
  })

  it('leaves unstacked pull requests and issues alone', async () => {
    stubFetch(searchPayload([pullRequestNode, issueNode]))

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.items[0].stack, null)
    assert.equal(page.items[1].stack, null)
  })

  it('asks again without the preview fields when a host rejects them', async () => {
    const sent: string[] = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string }
      sent.push(body.query)
      if (body.query.includes('stackEntry')) {
        return new Response(
          JSON.stringify({
            errors: [{ message: "Field 'stackEntry' doesn't exist on type 'PullRequest'" }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify(searchPayload([pullRequestNode])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })

    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].stack, null)
    assert.equal(sent.length, 2)
    assert.ok(!sent[1].includes('stackEntry'))

    // Having been told once, it does not ask for them again.
    await searchIssues('token', { q: 'is:pr', first: 30 })
    assert.equal(sent.length, 3)
    assert.ok(!sent[2].includes('stackEntry'))
  })

  it('still surfaces unrelated GraphQL errors', async () => {
    stubFetch({ errors: [{ message: 'Something else went wrong' }] })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:pr', first: 30 }),
      /Something else went wrong/,
    )
  })
})

describe('author avatars', () => {
  it('asks GitHub to resize the avatar rather than shipping the full image', () => {
    assert.match(SEARCH_QUERY, /avatarUrl\(size: \d+\)/)
  })

  it('carries the author through, and copes with a ghosted one', async () => {
    stubFetch(searchPayload([issueNode, { ...pullRequestNode, author: null }]))

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.items[0].authorLogin, 'octocat')
    assert.equal(page.items[0].authorAvatarUrl, 'https://avatars/1')
    assert.equal(page.items[1].authorLogin, null)
    assert.equal(page.items[1].authorAvatarUrl, null)
  })
})

describe('labels', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('reads only the labels it can draw, and how many there really are', async () => {
    assert.match(SEARCH_QUERY, /labels\(first: 5\) \{\s*totalCount/)

    stubFetch(
      searchPayload([
        {
          ...issueNode,
          labels: {
            totalCount: 9,
            nodes: [
              { name: 'bug', color: 'd73a4a' },
              { name: 'regression', color: '0e8a16' },
            ],
          },
        },
      ]),
    )

    const page = await searchIssues('token', { q: 'is:issue', first: 30 })

    assert.equal(page.items[0].labels.length, 2)
    assert.equal(page.items[0].labelCount, 9)
  })

  it('counts what it was given when GitHub reports no total', async () => {
    stubFetch(searchPayload([pullRequestNode, { ...issueNode, labels: null }]))

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.items[0].labelCount, 0)
    assert.equal(page.items[1].labelCount, 0)
  })
})
