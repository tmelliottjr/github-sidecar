import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import {
  ENRICH_QUERY,
  GitHubApiError,
  SEARCH_QUERY,
  enrichItems,
  fetchItem,
  resetPreviewSupport,
  searchIssues,
} from '../src/lib/github/api.ts'
import { applyEnrichment } from '../src/lib/github/enrichment.ts'

const originalFetch = globalThis.fetch

function stubFetch(body: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    })) as typeof fetch
}

/** What `nodes(ids:)` answers with, which is what enrichment reads. */
function nodesPayload(nodes: unknown[]) {
  return { data: { nodes } }
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
  headRefName: 'octocat/fix-the-thing',
  reviewDecision: 'CHANGES_REQUESTED',
  repository: { nameWithOwner: 'acme/app' },
  author: null,
  comments: { totalCount: 0 },
  labels: { nodes: null },
  headRefOid: 'abc123',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BEHIND',
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            state: 'FAILURE',
            contexts: {
              nodes: [
                {
                  __typename: 'CheckRun',
                  name: 'unit tests',
                  conclusion: 'FAILURE',
                  detailsUrl: 'https://github.com/acme/app/runs/1',
                },
                {
                  __typename: 'CheckRun',
                  name: 'lint',
                  conclusion: 'SUCCESS',
                  detailsUrl: 'https://github.com/acme/app/runs/2',
                },
                {
                  __typename: 'CheckRun',
                  name: 'flaky',
                  conclusion: 'CANCELLED',
                  detailsUrl: null,
                },
                {
                  __typename: 'CheckRun',
                  name: 'skipped step',
                  conclusion: 'SKIPPED',
                  detailsUrl: null,
                },
                {
                  __typename: 'StatusContext',
                  context: 'ci/legacy',
                  state: 'ERROR',
                  targetUrl: 'https://ci.example/build/9',
                },
              ],
            },
          },
        },
      },
    ],
  },
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

  it('names the checks that are red, and leaves the green ones out', async () => {
    stubFetch(searchPayload([pullRequestNode]))

    const page = await searchIssues('token', { q: 'is:pr', first: 30 })

    assert.deepEqual(page.items[0].failingChecks, [
      { name: 'unit tests', url: 'https://github.com/acme/app/runs/1' },
      // Cancelled counts: GitHub's own rollup fails for it, and a red mark
      // that can name nothing is worse than naming the check that stopped.
      { name: 'flaky', url: null },
      { name: 'ci/legacy', url: 'https://ci.example/build/9' },
    ])
    // Skipped and neutral do not fail the rollup, so naming them would be
    // inventing a problem.
    assert.equal(
      page.items[0].failingChecks.some((check) => check.name === 'skipped step'),
      false,
    )
    assert.equal(page.items[0].checksRead, 5)
  })

  it('flattens how a pull request stands against its base', async () => {
    const cases: Array<[Record<string, unknown>, string | null]> = [
      [{ mergeStateStatus: 'BEHIND' }, 'behind'],
      [{ mergeStateStatus: 'DIRTY' }, 'conflicting'],
      // The older field is the only one some hosts answer, so a conflict it
      // reports outranks whatever the preview field says.
      [{ mergeable: 'CONFLICTING', mergeStateStatus: 'BLOCKED' }, 'conflicting'],
      [{ mergeStateStatus: 'CLEAN' }, 'clean'],
      [{ mergeStateStatus: 'UNKNOWN' }, 'clean'],
      [{ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, null],
      [{ mergeStateStatus: 'DRAFT', mergeable: 'UNKNOWN' }, null],
    ]

    // Sequential on purpose: each case restubs the one shared fetch.
    const seen: Array<string | null> = []
    for (const [patch] of cases) {
      stubFetch(searchPayload([{ ...pullRequestNode, ...patch }]))
      // eslint-disable-next-line no-await-in-loop
      const page = await searchIssues('token', { q: 'is:pr', first: 30 })
      seen.push(page.items[0].mergeState)
    }
    assert.deepEqual(seen, cases.map(([, expected]) => expected))
  })

  it('says nothing about merging or checks for an issue', async () => {
    stubFetch(searchPayload([issueNode]))

    const [item] = (await searchIssues('token', { q: 'is:issue', first: 30 })).items
    assert.equal(item.mergeState, null)
    assert.deepEqual(item.failingChecks, [])
    assert.equal(item.headRefOid, null)
  })

  it('carries a pull request branch, and none for an issue', async () => {
    stubFetch(searchPayload([pullRequestNode, issueNode]))

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.items[0].headRefName, 'octocat/fix-the-thing')
    assert.equal(page.items[1].headRefName, null)
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
    resetPreviewSupport()
  })

  it('asks GitHub for stack membership, in the second request', () => {
    assert.match(ENRICH_QUERY, /stackEntry\s*\{\s*position/)
    assert.match(ENRICH_QUERY, /stack\s*\{[\s\S]*baseRefName/)
    // The search is what has to stay under GitHub's time limit, and a stack
    // is one of the fields that put it over.
    assert.ok(!SEARCH_QUERY.includes('stackEntry'))
  })

  it('reports where a row sits in its stack', async () => {
    stubFetch(nodesPayload([stackedPullRequestNode]))

    const { enrichments } = await enrichItems('token', ['PR_2'])
    const { stack } = enrichments[0]

    assert.ok(stack)
    assert.equal(stack.number, 7)
    assert.equal(stack.size, 3)
    assert.equal(stack.position, 2)
    assert.equal(stack.baseRefName, 'main')
  })

  it('lists the stack from the base branch up, skipping layers it cannot read', async () => {
    stubFetch(nodesPayload([stackedPullRequestNode]))

    const { enrichments } = await enrichItems('token', ['PR_2'])
    const entries = enrichments[0].stack!.entries

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
      return new Response(JSON.stringify(nodesPayload([pullRequestNode])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const first = await enrichItems('token', ['PR_1'])

    assert.equal(first.enrichments.length, 1)
    assert.equal(first.enrichments[0].stack, null)
    assert.equal(first.failedIds.length, 0)
    assert.equal(sent.length, 2)
    assert.ok(!sent[1].includes('stackEntry'))

    // Having been told once, it does not ask for them again.
    await enrichItems('token', ['PR_1'])
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

describe('the split into two requests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
    resetPreviewSupport()
  })

  it('keeps the costly fields out of the search', () => {
    for (const field of ['reviewDecision', 'mergeStateStatus', 'statusCheckRollup']) {
      assert.ok(!SEARCH_QUERY.includes(field), `${field} is still in the search`)
    }
    // The cheap half of the merge answer stays: it is the one that knows about
    // conflicts, so the mark that matters most arrives with the first request.
    assert.match(SEARCH_QUERY, /\bmergeable\b/)
  })

  it('marks searched pull requests as waiting for the second request', async () => {
    stubFetch(searchPayload([pullRequestNode, issueNode]))

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.items[0].enrichment, 'pending')
    // Nothing costly applies to an issue, so nothing is coming for it.
    assert.equal(page.items[1].enrichment, 'ready')
  })

  it('reads a single row whole, so a refresh needs no second request', async () => {
    stubFetch({ data: { repository: { issueOrPullRequest: pullRequestNode } } })

    const item = await fetchItem('token', { repository: 'acme/app', number: 34 })

    assert.equal(item.enrichment, 'ready')
    assert.equal(item.reviewDecision, 'CHANGES_REQUESTED')
    assert.equal(item.checkState, 'FAILURE')
  })

  it('asks for exactly the rows it was given, in one request', async () => {
    const asked: string[][] = []
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { variables: { ids: string[] } }
      asked.push(body.variables.ids)
      return new Response(JSON.stringify(nodesPayload([])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await enrichItems('token', ['PR_1', 'PR_2', 'PR_3'])

    // Batching is the search service's job: it is what knows how many rows are
    // still waiting and can publish each batch as it lands.
    assert.deepEqual(asked, [['PR_1', 'PR_2', 'PR_3']])
  })

  it('merges the costly half into the row without disturbing the rest', async () => {
    stubFetch(searchPayload([pullRequestNode]))
    const page = await searchIssues('token', { q: 'is:pr', first: 30 })

    stubFetch(nodesPayload([pullRequestNode]))
    const { enrichments } = await enrichItems('token', ['PR_1'])
    const merged = applyEnrichment(page.items[0], enrichments[0])

    assert.equal(merged.enrichment, 'ready')
    assert.equal(merged.reviewDecision, 'CHANGES_REQUESTED')
    assert.equal(merged.checkState, 'FAILURE')
    assert.equal(merged.mergeState, 'behind')
    // Everything the search already knew survives the merge untouched.
    assert.equal(merged.title, 'Fix the thing')
    assert.equal(merged.additions, 10)
    assert.equal(merged.commentCount, 0)
  })

  it('says plainly when GitHub ran out of time on a batch', async () => {
    stubFetch('<html>502 Bad Gateway</html>' as unknown as object, { status: 502 })

    await assert.rejects(() => enrichItems('token', ['PR_1']), /took too long/)
  })

  it('counts a row the second request could not read as failed', async () => {
    // `nodes(ids:)` answers with null for anything the token cannot reach.
    stubFetch(nodesPayload([null, pullRequestNode]))

    const result = await enrichItems('token', ['PR_missing', 'PR_1'])

    assert.deepEqual(result.enrichments.map((entry) => entry.id), ['PR_1'])
    assert.deepEqual(result.failedIds, ['PR_missing'])
  })

  it('asks nothing at all when there is nothing to enrich', async () => {
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const result = await enrichItems('token', [])

    assert.equal(called, false)
    assert.deepEqual(result, { enrichments: [], failedIds: [], error: null })
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

/**
 * GitHub answers a query that spans an organisation the token cannot reach
 * with *both* the results it could read and an error for each one it could
 * not. Treating that as a failure would empty a list that is mostly fine.
 */
describe('partially refused results', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  const ssoError = {
    type: 'FORBIDDEN',
    message:
      'Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.',
  }

  it('keeps the results GitHub did return', async () => {
    stubFetch({ ...searchPayload([issueNode]), errors: [ssoError] })

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].id, 'I_1')
  })

  it('reports the refusal as an actionable warning rather than GitHub prose', async () => {
    stubFetch({ ...searchPayload([issueNode]), errors: [ssoError] })

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.ok(page.warning)
    assert.match(page.warning, /authoris/i)
    // The raw wording is written for an API client, not for a 300px panel.
    assert.doesNotMatch(page.warning, /OAuth token access/)
  })

  it('leaves a clean page unmarked', async () => {
    stubFetch(searchPayload([issueNode]))

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.equal(page.warning, null)
  })

  it('collapses the same refusal repeated once per repository', async () => {
    stubFetch({
      ...searchPayload([issueNode]),
      errors: [ssoError, { ...ssoError }, { ...ssoError }],
    })

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.doesNotMatch(page.warning!, /\+\d+ more/)
  })

  it('counts distinct causes without listing them all', async () => {
    stubFetch({
      ...searchPayload([issueNode]),
      errors: [ssoError, { type: 'NOT_FOUND', message: 'Could not resolve to a User.' }],
    })

    const page = await searchIssues('token', { q: 'is:open', first: 30 })

    assert.match(page.warning!, /\(\+1 more\)$/)
  })

  it('still fails when GitHub returned nothing to show', async () => {
    stubFetch({ data: { search: null }, errors: [ssoError] })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:open', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'auth')
        assert.equal(error.retryable, false)
        return true
      },
    )
  })
})

describe('error classification', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('marks a rejected token as an auth failure not worth retrying', async () => {
    stubFetch({}, { status: 401 })

    await assert.rejects(
      () => searchIssues('bad', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'auth')
        assert.equal(error.retryable, false)
        return true
      },
    )
  })

  /**
   * A 403 is only sometimes a rate limit. Reading every one as "try again
   * shortly" told the reader to wait out a refusal that would never lift.
   */
  it('separates a refusal from a spent rate limit', async () => {
    stubFetch({}, { status: 403 })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'auth')
        assert.match(error.message, /authoris/i)
        return true
      },
    )
  })

  it('reads a spent budget off the response headers', async () => {
    stubFetch({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'rate-limit')
        assert.match(error.message, /rate limited/i)
        return true
      },
    )
  })

  it('lets a server error be retried', async () => {
    stubFetch({}, { status: 502 })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'server')
        assert.equal(error.retryable, true)
        return true
      },
    )
  })

  it('rewrites a missing scope into the step that fixes it', async () => {
    stubFetch({
      errors: [
        {
          type: 'INSUFFICIENT_SCOPES',
          message:
            "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:org'].",
        },
      ],
    })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'auth')
        assert.match(error.message, /permission/i)
        return true
      },
    )
  })

  it('keeps the raw GraphQL errors for matching that must not read prose', async () => {
    stubFetch({ errors: [{ type: 'FORBIDDEN', message: 'SAML enforcement' }] })

    await assert.rejects(
      () => searchIssues('token', { q: 'is:issue', first: 30 }),
      (error: GitHubApiError) => {
        assert.equal(error.errors.length, 1)
        assert.equal(error.errors[0].message, 'SAML enforcement')
        return true
      },
    )
  })

  it('says why a row is unreadable rather than claiming it is missing', async () => {
    stubFetch({
      data: { repository: null },
      errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML.' }],
    })

    await assert.rejects(
      () => fetchItem('token', { repository: 'acme/app', number: 34 }),
      (error: GitHubApiError) => {
        assert.equal(error.kind, 'auth')
        assert.doesNotMatch(error.message, /could not be found/)
        return true
      },
    )
  })
})
