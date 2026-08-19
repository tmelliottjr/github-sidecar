import type {
  ApiErrorKind,
  CheckState,
  FailingCheck,
  ItemState,
  Label,
  MergeState,
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
 * How many of a commit's checks are read. Only the failing ones are kept, and
 * a rollup with more checks than this still reports the right overall state —
 * the row simply cannot name the ones it never read. Set high enough to cover
 * all but the largest repositories, since a red mark that can name nothing is
 * the confusing case; the response only ever carries the checks that exist.
 */
const CHECK_CONTEXTS = 50

/**
 * `stack`, `stackEntry` and `mergeStateStatus` are all schema previews. A host
 * that has not been given them answers the whole query with a validation error
 * rather than a null, which would take the list down with it, so the first
 * such failure drops them and everything after it asks the smaller question.
 */
let previewFieldsSupported = true

/** Opts into every preview the query asks for; ordinary JSON either way. */
const PREVIEW_ACCEPT = 'application/vnd.github.merge-info-preview+json'

const PREVIEW_FIELDS = /* GraphQL */ `
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
  mergeStateStatus
`

/**
 * Both queries select exactly the same fields, so they are shared: a row
 * refreshed on its own has to be indistinguishable from the same row arriving
 * through a search, or refreshing one would quietly drop a badge.
 */
const itemFields = (withPreview: boolean) => /* GraphQL */ `
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
    headRefName
    headRefOid
    mergeable
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
            contexts(first: ${CHECK_CONTEXTS}) {
              totalCount
              nodes {
                __typename
                ... on CheckRun {
                  name
                  conclusion
                  detailsUrl
                }
                ... on StatusContext {
                  context
                  state
                  targetUrl
                }
              }
            }
          }
        }
      }
    }
    ${withPreview ? PREVIEW_FIELDS : ''}
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
export const searchQuery = (withPreview = true) => /* GraphQL */ `
  ${itemFields(withPreview)}

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
export const itemQuery = (withPreview = true) => /* GraphQL */ `
  ${itemFields(withPreview)}

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

/**
 * One entry in a commit's check rollup: either a check run from the Checks
 * API or a commit status from the older one. They name themselves and their
 * outcome differently, which is the only reason this has to know about both.
 */
type CheckContextNode =
  | {
      __typename: 'CheckRun'
      name: string
      conclusion: string | null
      detailsUrl: string | null
    }
  | {
      __typename: 'StatusContext'
      context: string
      state: string
      targetUrl: string | null
    }

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
  headRefName?: string | null
  headRefOid?: string | null
  mergeable?: string | null
  mergeStateStatus?: string | null
  reviewDecision?: ReviewDecision | null
  repository: { nameWithOwner: string }
  author: { login: string; avatarUrl: string } | null
  comments: { totalCount: number }
  labels: { totalCount: number; nodes: Label[] | null } | null
  commits?: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          state: CheckState
          contexts?: {
            totalCount?: number
            nodes: Array<CheckContextNode | null> | null
          } | null
        } | null
      }
    }> | null
  } | null
  stackEntry?: { position: number } | null
  stack?: {
    number: number
    size: number
    baseRefName: string
    entries: { totalCount: number; nodes: Array<StackEntryNode | null> | null } | null
  } | null
}

export interface GraphQLError {
  message: string
  type?: string
  path?: Array<string | number>
}

interface ItemResponse {
  data?: {
    repository: { issueOrPullRequest: GraphQLNode | null } | null
  } | null
  errors?: GraphQLError[]
}

interface GraphQLResponse {
  data?: {
    search: {
      issueCount: number
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: Array<GraphQLNode | Record<string, never>> | null
    } | null
  } | null
  errors?: GraphQLError[]
}

/** Kinds where asking the same question again cannot produce a better answer. */
const TERMINAL_KINDS: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  'auth',
  'rate-limit',
  'not-found',
])

export class GitHubApiError extends Error {
  readonly status: number | undefined
  /**
   * What the caller can do about it, rather than what went wrong. Survives the
   * trip through `chrome.runtime.sendMessage`, which flattens an Error to its
   * message, so the panel can still offer the right next step.
   */
  readonly kind: ApiErrorKind
  /** False where trying again unchanged cannot possibly succeed. */
  readonly retryable: boolean
  /** The raw GraphQL errors, kept for matching that must not read prose. */
  readonly errors: readonly GraphQLError[]

  constructor(
    message: string,
    options: {
      status?: number
      kind?: ApiErrorKind
      retryable?: boolean
      errors?: readonly GraphQLError[]
    } = {},
  ) {
    super(message)
    this.name = 'GitHubApiError'
    this.status = options.status
    this.kind = options.kind ?? 'unknown'
    this.retryable = options.retryable ?? !TERMINAL_KINDS.has(this.kind)
    this.errors = options.errors ?? []
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

/**
 * Flattens GitHub's two answers about merging into one. `mergeable` is the
 * older, always-available field and only knows about conflicts;
 * `mergeStateStatus` knows why a mergeable branch still cannot go in. A
 * conflict is reported from whichever field saw it first, since the older one
 * is the only one some hosts answer at all.
 */
function toMergeState(node: GraphQLNode): MergeState | null {
  if (node.__typename !== 'PullRequest') return null
  if (node.mergeable === 'CONFLICTING') return 'conflicting'

  switch (node.mergeStateStatus) {
    case 'DIRTY':
      return 'conflicting'
    case 'BEHIND':
      return 'behind'
    case 'BLOCKED':
      return 'blocked'
    case 'UNSTABLE':
      return 'unstable'
    case 'CLEAN':
    case 'HAS_HOOKS':
      return 'clean'
    // DRAFT says nothing the row's own icon does not, and UNKNOWN is GitHub
    // saying it has not worked the answer out yet.
    default:
      return node.mergeable === 'MERGEABLE' ? 'clean' : null
  }
}

/**
 * Check conclusions that mean a human has to go and look.
 *
 * Cancelled and stale are in here because GitHub's own rollup counts them as
 * failing — neither is a check that passed — and leaving them out was what
 * made some red rows unable to name a single red check. Neutral and skipped
 * are left out for the same reason in reverse: the rollup does not fail for
 * them, so naming them would be inventing a problem.
 */
const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'STARTUP_FAILURE',
  'ACTION_REQUIRED',
  'CANCELLED',
  'STALE',
])

const FAILING_STATES = new Set(['FAILURE', 'ERROR'])

function toFailingChecks(node: GraphQLNode): FailingCheck[] {
  const contexts = node.commits?.nodes?.[0]?.commit.statusCheckRollup?.contexts?.nodes ?? []
  const failing: FailingCheck[] = []

  for (const context of contexts) {
    if (!context) continue
    if (context.__typename === 'CheckRun') {
      if (context.conclusion && FAILING_CONCLUSIONS.has(context.conclusion)) {
        failing.push({ name: context.name, url: context.detailsUrl ?? null })
      }
      continue
    }
    if (FAILING_STATES.has(context.state)) {
      failing.push({ name: context.context, url: context.targetUrl ?? null })
    }
  }

  return failing
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
    headRefName: node.headRefName ?? null,
    headRefOid: node.headRefOid ?? null,
    mergeState: toMergeState(node),
    failingChecks: toFailingChecks(node),
    checkCount:
      node.commits?.nodes?.[0]?.commit.statusCheckRollup?.contexts?.totalCount ?? null,
    // What was read, not what failed: the query keeps only the red ones, so
    // the failing list alone cannot say how much of the rollup was seen.
    checksRead:
      node.commits?.nodes?.[0]?.commit.statusCheckRollup?.contexts?.nodes?.length ?? 0,
    stack: toStack(node),
  }
}

export interface SearchParams {
  q: string
  first: number
  after?: string | null
}

/**
 * GitHub's own wording for a refused token is written for an API client, not
 * for a reader: the single sign-on one is three sentences of OAuth vocabulary,
 * and it arrives once per inaccessible repository, so the raw text is both
 * unreadable and enormous in a 300px panel.
 *
 * These patterns key off *what the token cannot do*, never off the identity
 * provider enforcing it, so one deployment's sign-on setup is not baked into
 * the panel. Anything unrecognised keeps GitHub's own message.
 */
const AUTH_PATTERNS: Array<{ test: RegExp; message: string }> = [
  {
    test: /\b(saml|sso|single[- ]sign[- ]?on)\b|must grant your .*token/i,
    message:
      'Your token is not authorised for every organisation this query covers. Authorise it for those organisations, then try again.',
  },
  {
    test: /\bip allow ?list\b/i,
    message:
      "Your token was refused by an organisation's IP allow list. Connect from an allowed address, or add this token to the list.",
  },
  {
    test: /\b(scopes?|oauth app access)\b/i,
    message:
      'Your token is missing a permission this query needs. Re-create it with repository and organisation read access.',
  },
]

const ERROR_TYPE_KINDS: Record<string, ApiErrorKind> = {
  FORBIDDEN: 'auth',
  INSUFFICIENT_SCOPES: 'auth',
  UNAUTHORIZED: 'auth',
  RATE_LIMITED: 'rate-limit',
  NOT_FOUND: 'not-found',
  SERVICE_UNAVAILABLE: 'server',
  INTERNAL: 'server',
}

/** Trims runaway prose so one error cannot fill the panel. */
const MAX_MESSAGE_LENGTH = 200

function truncate(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) return message
  return `${message.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
}

/** What the reader can do about a set of GraphQL errors. */
export function classifyGraphQLErrors(errors: readonly GraphQLError[]): ApiErrorKind {
  const kinds = new Set(
    errors.map((error) => ERROR_TYPE_KINDS[error.type ?? ''] ?? 'unknown'),
  )
  if (kinds.has('auth')) return 'auth'
  if (kinds.has('rate-limit')) return 'rate-limit'
  // Older hosts send these refusals without a machine-readable type at all.
  if (errors.some((error) => AUTH_PATTERNS.some(({ test }) => test.test(error.message)))) {
    return 'auth'
  }
  if (kinds.has('server')) return 'server'
  if (kinds.has('not-found')) return 'not-found'
  return 'unknown'
}

/**
 * Collapses GraphQL errors into one short line. GitHub repeats the same
 * refusal once per resource it applies to, so identical causes are deduped
 * rather than listed out.
 */
export function describeGraphQLErrors(errors: readonly GraphQLError[]): string {
  const described = new Set<string>()

  for (const error of errors) {
    const known = AUTH_PATTERNS.find(({ test }) => test.test(error.message))
    if (known) {
      described.add(known.message)
      continue
    }
    if (error.type === 'RATE_LIMITED') {
      described.add('GitHub is rate limiting this token. Results will refresh shortly.')
      continue
    }
    described.add(truncate(error.message.trim()))
  }

  const lines = [...described]
  if (lines.length === 0) return 'GitHub rejected this request.'
  // Anything past the first cause is noise in a panel this narrow.
  return lines.length === 1 ? lines[0] : `${lines[0]} (+${lines.length - 1} more)`
}

/**
 * True when GitHub answered with something worth rendering. A response can
 * carry both data and errors — a token that cannot see one organisation still
 * gets results from the others — and discarding that would take the whole list
 * down over a repository the reader may not even care about.
 */
function hasUsableData(payload: { data?: unknown }): boolean {
  const { data } = payload
  if (!data || typeof data !== 'object') return false
  return Object.values(data as Record<string, unknown>).some((value) => value !== null)
}

/** GitHub reports a spent budget on the response itself, not only as a 429. */
function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    response.headers.get('x-ratelimit-remaining') === '0' ||
    response.headers.has('retry-after')
  )
}

export interface GraphQLPayload {
  data?: unknown
  errors?: GraphQLError[]
}

/**
 * Runs in the background service worker: github.com's CSP would block these
 * requests if they were issued from the content script.
 *
 * Resolves with the payload whenever there is data to render, errors and all;
 * the caller decides what to say about a partial answer.
 */
async function post<T extends GraphQLPayload>(
  token: string,
  body: { query: string; variables: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Opts into the schema previews the query asks for. The response is
      // ordinary JSON either way; without it `mergeStateStatus` is refused.
      Accept: PREVIEW_ACCEPT,
    },
    body: JSON.stringify(body),
  })

  if (response.status === 401) {
    throw new GitHubApiError('Invalid or expired token. Update it in settings.', {
      status: 401,
      kind: 'auth',
    })
  }
  if (isRateLimited(response)) {
    throw new GitHubApiError('Rate limited by GitHub. Try again shortly.', {
      status: response.status,
      kind: 'rate-limit',
    })
  }
  // A 403 that is not a rate limit is a refusal: the token cannot reach what
  // it asked for, and asking again unchanged will be refused again.
  if (response.status === 403) {
    throw new GitHubApiError(
      'GitHub refused this request. Your token may not be authorised for the organisation that owns these results.',
      { status: 403, kind: 'auth' },
    )
  }
  if (!response.ok) {
    throw new GitHubApiError(`GitHub responded with ${response.status}.`, {
      status: response.status,
      kind: response.status >= 500 ? 'server' : 'unknown',
    })
  }

  const payload = (await response.json()) as T
  const errors = payload.errors ?? []
  if (errors.length > 0 && !hasUsableData(payload)) {
    throw new GitHubApiError(describeGraphQLErrors(errors), {
      kind: classifyGraphQLErrors(errors),
      errors,
    })
  }
  return payload
}

/**
 * True for the validation error a host without one of the preview fields
 * answers with. It arrives as an ordinary GraphQL error rather than a null
 * field, so it has to be recognised by hand.
 *
 * Matched against the raw GraphQL text rather than the error's own message,
 * which by this point may have been rewritten into something a reader can act
 * on and no longer names the field at all.
 */
function isUnknownPreviewField(error: unknown): boolean {
  if (!(error instanceof GitHubApiError)) return false
  const messages = error.errors.length
    ? error.errors.map((entry) => entry.message)
    : [error.message]
  return messages.some(
    (message) =>
      /\b(stack(entry)?|mergestatestatus)\b/i.test(message) &&
      /(does ?n[o']t exist|cannot query field|undefined field)/i.test(message),
  )
}

/**
 * Asks for the preview fields, and drops them for the life of the worker the
 * first time a host rejects them. A preview field that has not reached this
 * host must cost the sidebar its stack badges and merge marks, not its list.
 */
async function postWithPreviewFallback<T extends GraphQLPayload>(
  token: string,
  buildQuery: (withPreview: boolean) => string,
  variables: Record<string, unknown>,
): Promise<T> {
  if (!previewFieldsSupported) {
    return post<T>(token, { query: buildQuery(false), variables })
  }
  try {
    return await post<T>(token, { query: buildQuery(true), variables })
  } catch (error) {
    if (!isUnknownPreviewField(error)) throw error
    previewFieldsSupported = false
    return post<T>(token, { query: buildQuery(false), variables })
  }
}

/** Test hook: forgets that a host rejected the preview fields. */
export function resetPreviewSupport(): void {
  previewFieldsSupported = true
}

export async function searchIssues(
  token: string,
  { q, first, after }: SearchParams,
): Promise<SearchPage> {
  const body = await postWithPreviewFallback<GraphQLResponse>(token, searchQuery, {
    q,
    first,
    after: after ?? null,
  })
  if (!body.data) {
    throw new GitHubApiError('GitHub returned an empty response.')
  }

  const { search } = body.data
  if (!search) {
    throw new GitHubApiError('GitHub returned an empty response.')
  }

  const nodes = (search.nodes ?? []).filter(
    (node): node is GraphQLNode => '__typename' in node && node.__typename !== undefined,
  )

  const errors = body.errors ?? []
  return {
    items: nodes.map(normalise),
    totalCount: search.issueCount,
    endCursor: search.pageInfo.endCursor,
    hasNextPage: search.pageInfo.hasNextPage,
    fetchedAt: Date.now(),
    // Results GitHub refused to include are reported alongside the ones it
    // did, rather than instead of them: a single unreachable organisation must
    // not empty a list that is otherwise perfectly usable.
    warning: errors.length > 0 ? describeGraphQLErrors(errors) : null,
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

  const body = await postWithPreviewFallback<ItemResponse>(token, itemQuery, {
    owner,
    name,
    number,
  })

  const node = body.data?.repository?.issueOrPullRequest
  if (!node) {
    // A row can be missing because it does not exist, or because this token
    // cannot see it. Where GitHub said which, say that instead.
    const errors = body.errors ?? []
    if (errors.length > 0) {
      throw new GitHubApiError(describeGraphQLErrors(errors), {
        kind: classifyGraphQLErrors(errors),
        errors,
      })
    }
    throw new GitHubApiError(`${repository}#${number} could not be found.`, {
      kind: 'not-found',
    })
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
      {
        status: response.status,
        kind: response.status === 401 || response.status === 403 ? 'auth' : 'unknown',
      },
    )
  }

  const body = (await response.json()) as {
    data?: { viewer: { login: string } } | null
    errors?: GraphQLError[]
  }
  if (body.errors?.length) {
    throw new GitHubApiError(describeGraphQLErrors(body.errors), {
      kind: classifyGraphQLErrors(body.errors),
      errors: body.errors,
    })
  }
  if (!body.data) throw new GitHubApiError('GitHub returned an empty response.')
  return body.data.viewer.login
}
