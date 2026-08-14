import type {
  CheckState,
  ItemState,
  Label,
  ReviewDecision,
  SearchItem,
  SearchPage,
  StackEntry,
  StackInfo,
} from './types'

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

/**
 * How many layers of a stack are read per pull request. Stacks deeper than
 * this are rare, and `totalCount` still reports the real size, so the row can
 * say the list is partial rather than quietly lying about it.
 */
const STACK_ENTRIES = 20

/**
 * Avatars are drawn at 14px, so this is a 2× copy for the sharpest screens.
 * Asking GitHub to resize costs the row a fraction of the full-size image.
 */
const AVATAR_SIZE = 28

/**
 * Labels are drawn as a row of dots, so only as many as are drawn are read.
 * `totalCount` still reports the real number, which is what the `+N` counts.
 */
const LABEL_DOTS = 5

/**
 * `stack` and `stackEntry` are a public preview. A host that has not been
 * given the fields answers the whole query with a validation error rather than
 * a null, which would take the list down with it, so the first such failure
 * drops them and everything after it asks the smaller question.
 */
let stackFieldsSupported = true

const STACK_FIELDS = /* GraphQL */ `
  stackEntry {
    position
  }
  stack {
    number
    size
    baseRefName
    entries(first: ${STACK_ENTRIES}) {
      totalCount
      nodes {
        position
        pullRequest {
          id
          number
          title
          url
          state
          isDraft
          isInMergeQueue
          reviewDecision
          repository {
            nameWithOwner
          }
        }
      }
    }
  }
`

/**
 * Both queries select exactly the same fields, so they are shared: a row
 * refreshed on its own has to be indistinguishable from the same row arriving
 * through a search, or refreshing one would quietly drop a badge.
 */
const itemFields = (withStack: boolean) => /* GraphQL */ `
  fragment IssueFields on Issue {
    id
    number
    title
    url
    state
    stateReason
    createdAt
    updatedAt
    repository {
      nameWithOwner
    }
    author {
      login
      avatarUrl(size: ${AVATAR_SIZE})
    }
    comments {
      totalCount
    }
    labels(first: ${LABEL_DOTS}) {
      totalCount
      nodes {
        name
        color
      }
    }
  }

  fragment PullRequestFields on PullRequest {
    id
    number
    title
    url
    state
    isDraft
    isInMergeQueue
    createdAt
    updatedAt
    additions
    deletions
    reviewDecision
    repository {
      nameWithOwner
    }
    author {
      login
      avatarUrl(size: ${AVATAR_SIZE})
    }
    comments {
      totalCount
    }
    labels(first: ${LABEL_DOTS}) {
      totalCount
      nodes {
        name
        color
      }
    }
    commits(last: 1) {
      nodes {
        commit {
          statusCheckRollup {
            state
          }
        }
      }
    }
    ${withStack ? STACK_FIELDS : ''}
  }
`


/**
 * A single search query covers both issues and pull requests and returns every
 * status signal the sidebar renders (merge state, CI rollup, review decision),
 * which keeps polling to one request per refresh.
 *
 * `ISSUE_ADVANCED` rather than `ISSUE`: the latter is still the legacy parser,
 * which does not understand the advanced syntax github.com's own search now
 * uses. It does not report an error on a query it cannot parse — it silently
 * matches nothing, so `(label:a OR label:b)` comes back empty rather than
 * failing. The two agree on every query the legacy parser did understand,
 * except that a space between `repo:`, `org:`, or `user:` qualifiers now means
 * AND where it used to mean OR.
 */
export const searchQuery = (withStack = true) => /* GraphQL */ `
  ${itemFields(withStack)}

  query SidebarSearch($q: String!, $first: Int!, $after: String) {
    search(query: $q, type: ISSUE_ADVANCED, first: $first, after: $after) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        __typename
        ...IssueFields
        ...PullRequestFields
      }
    }
  }
`

export const SEARCH_QUERY = searchQuery()

/**
 * Re-reads one row on demand. `issueOrPullRequest` resolves either kind from a
 * number, so the caller does not have to know which it is holding.
 */
export const itemQuery = (withStack = true) => /* GraphQL */ `
  ${itemFields(withStack)}

  query SidebarItem($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issueOrPullRequest(number: $number) {
        __typename
        ...IssueFields
        ...PullRequestFields
      }
    }
  }
`

export const ITEM_QUERY = itemQuery()

interface StackEntryNode {
  position: number
  pullRequest: {
    id: string
    number: number
    title: string
    url: string
    state: string
    isDraft?: boolean
    isInMergeQueue?: boolean
    reviewDecision?: ReviewDecision | null
    repository: { nameWithOwner: string }
  } | null
}

interface GraphQLNode {
  __typename: 'Issue' | 'PullRequest'
  id: string
  number: number
  title: string
  url: string
  state: string
  stateReason?: string | null
  isDraft?: boolean
  isInMergeQueue?: boolean
  createdAt: string
  updatedAt: string
  additions?: number
  deletions?: number
  reviewDecision?: ReviewDecision | null
  repository: { nameWithOwner: string }
  author: { login: string; avatarUrl: string } | null
  comments: { totalCount: number }
  labels: { totalCount: number; nodes: Label[] | null } | null
  commits?: {
    nodes: Array<{ commit: { statusCheckRollup: { state: CheckState } | null } }> | null
  } | null
  stackEntry?: { position: number } | null
  stack?: {
    number: number
    size: number
    baseRefName: string
    entries: { totalCount: number; nodes: Array<StackEntryNode | null> | null } | null
  } | null
}

interface ItemResponse {
  data?: {
    repository: { issueOrPullRequest: GraphQLNode | null } | null
  }
  errors?: Array<{ message: string; type?: string }>
}

interface GraphQLResponse {
  data?: {
    search: {
      issueCount: number
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: Array<GraphQLNode | Record<string, never>> | null
    }
  }
  errors?: Array<{ message: string; type?: string }>
}

export class GitHubApiError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = status
  }
}

/** A pull request's lifecycle, flattened the same way wherever it appears. */
function toPullRequestState(node: {
  state: string
  isDraft?: boolean
  isInMergeQueue?: boolean
}): ItemState {
  if (node.state === 'MERGED') return 'merged'
  if (node.state === 'CLOSED') return 'closed'
  // Checked before draft only for tidiness; a draft cannot be queued.
  if (node.isInMergeQueue) return 'queued'
  return node.isDraft ? 'draft' : 'open'
}

function toState(node: GraphQLNode): ItemState {
  if (node.__typename === 'Issue') {
    return node.state === 'CLOSED' ? 'closed' : 'open'
  }
  return toPullRequestState(node)
}

/**
 * Flattens a pull request's stack membership. Position comes from the node's
 * own `stackEntry` rather than from its place in `entries`, so a truncated or
 * partially readable stack still reports where this row sits.
 */
function toStack(node: GraphQLNode): StackInfo | null {
  const stack = node.stack
  const position = node.stackEntry?.position
  if (!stack || position === undefined) return null

  const byPosition = new Map<number, StackEntry>()
  for (const entry of stack.entries?.nodes ?? []) {
    const pullRequest = entry?.pullRequest
    if (!pullRequest) continue
    byPosition.set(entry.position, {
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      repository: pullRequest.repository.nameWithOwner,
      state: toPullRequestState(pullRequest),
      reviewDecision: pullRequest.reviewDecision ?? null,
      position: entry.position,
    })
  }

  // Walked by position rather than by the order the nodes arrived in, so the
  // list always reads from the base branch up.
  const entries: StackEntry[] = []
  for (let layer = 1; layer <= stack.size; layer += 1) {
    const entry = byPosition.get(layer)
    if (entry) entries.push(entry)
  }

  return {
    number: stack.number,
    size: stack.size,
    baseRefName: stack.baseRefName,
    position,
    entries,
  }
}

function normalise(node: GraphQLNode): SearchItem {
  return {
    id: node.id,
    kind: node.__typename === 'Issue' ? 'issue' : 'pull-request',
    number: node.number,
    title: node.title,
    url: node.url,
    repository: node.repository.nameWithOwner,
    authorLogin: node.author?.login ?? null,
    authorAvatarUrl: node.author?.avatarUrl ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    state: toState(node),
    stateReason: node.stateReason ?? null,
    commentCount: node.comments.totalCount,
    labels: node.labels?.nodes ?? [],
    labelCount: node.labels?.totalCount ?? node.labels?.nodes?.length ?? 0,
    reviewDecision: node.reviewDecision ?? null,
    checkState: node.commits?.nodes?.[0]?.commit.statusCheckRollup?.state ?? null,
    additions: node.additions ?? null,
    deletions: node.deletions ?? null,
    stack: toStack(node),
  }
}

export interface SearchParams {
  q: string
  first: number
  after?: string | null
}

/**
 * Runs in the background service worker: github.com's CSP would block these
 * requests if they were issued from the content script.
 */
async function post<T extends { errors?: Array<{ message: string }> }>(
  token: string,
  body: { query: string; variables: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (response.status === 401) {
    throw new GitHubApiError('Invalid or expired token. Update it in settings.', 401)
  }
  if (response.status === 403 || response.status === 429) {
    throw new GitHubApiError('Rate limited by GitHub. Try again shortly.', response.status)
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub responded with ${response.status}.`, response.status)
  }

  const payload = (await response.json()) as T
  if (payload.errors?.length) {
    throw new GitHubApiError(payload.errors.map((error) => error.message).join('; '))
  }
  return payload
}

/**
 * True for the validation error a host without the stacked pull request
 * preview answers with. It arrives as an ordinary GraphQL error rather than a
 * null field, so it has to be recognised by hand.
 */
function isUnknownStackField(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) return false
  return (
    /\bstack(entry)?\b/i.test(error.message) &&
    /(does ?n[o']t exist|cannot query field|undefined field)/i.test(error.message)
  )
}

/**
 * Asks for the stack fields, and drops them for the life of the worker the
 * first time a host rejects them. A preview field that has not reached this
 * host must cost the sidebar its stack badges, not its list.
 */
async function postWithStackFallback<T extends { errors?: Array<{ message: string }> }>(
  token: string,
  buildQuery: (withStack: boolean) => string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!stackFieldsSupported) {
    return post<T>(token, { query: buildQuery(false), variables })
  }
  try {
    return await post<T>(token, { query: buildQuery(true), variables })
  } catch (error) {
    if (!isUnknownStackField(error)) throw error
    stackFieldsSupported = false
    return post<T>(token, { query: buildQuery(false), variables })
  }
}

/** Test hook: forgets that a host rejected the preview fields. */
export function resetStackSupport(): void {
  stackFieldsSupported = true
}

export async function searchIssues(
  token: string,
  { q, first, after }: SearchParams,
): Promise<SearchPage> {
  const body = await postWithStackFallback<GraphQLResponse>(token, searchQuery, {
    q,
    first,
    after: after ?? null,
  })
  if (!body.data) {
    throw new GitHubApiError('GitHub returned an empty response.')
  }

  const { search } = body.data
  const nodes = (search.nodes ?? []).filter(
    (node): node is GraphQLNode => '__typename' in node && node.__typename !== undefined,
  )

  return {
    items: nodes.map(normalise),
    totalCount: search.issueCount,
    endCursor: search.pageInfo.endCursor,
    hasNextPage: search.pageInfo.hasNextPage,
    fetchedAt: Date.now(),
  }
}

export interface ItemRef {
  /** `owner/name`, exactly as it is stored on a row. */
  repository: string
  number: number
}

/**
 * Re-reads a single row. Used by the row's own refresh action, which needs a
 * status newer than the poll interval would give it.
 */
export async function fetchItem(
  token: string,
  { repository, number }: ItemRef,
): Promise<SearchItem> {
  const [owner, name] = repository.split('/')
  if (!owner || !name) {
    throw new GitHubApiError(`Cannot parse the repository name "${repository}".`)
  }

  const body = await postWithStackFallback<ItemResponse>(token, itemQuery, {
    owner,
    name,
    number,
  })

  const node = body.data?.repository?.issueOrPullRequest
  if (!node) {
    throw new GitHubApiError(`${repository}#${number} could not be found.`)
  }
  return normalise(node)
}

/** Validates a token and returns the authenticated login. */
export async function fetchViewer(token: string): Promise<string> {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '{ viewer { login } }' }),
  })

  if (!response.ok) {
    throw new GitHubApiError(
      response.status === 401
        ? 'That token was rejected by GitHub.'
        : `GitHub responded with ${response.status}.`,
      response.status,
    )
  }

  const body = (await response.json()) as {
    data?: { viewer: { login: string } }
    errors?: Array<{ message: string }>
  }
  if (body.errors?.length) throw new GitHubApiError(body.errors[0].message)
  if (!body.data) throw new GitHubApiError('GitHub returned an empty response.')
  return body.data.viewer.login
}
