export type ItemKind = 'issue' | 'pull-request'

/**
 * What the reader can do about a failure, rather than what went wrong.
 *
 * Deliberately says nothing about *why* a token was refused: single sign-on,
 * an IP allow list and a missing scope all land on `auth` because the next
 * step is the same one — go and fix the token. Naming any single identity
 * provider here would tie the panel to one deployment's setup.
 */
export type ApiErrorKind = 'auth' | 'rate-limit' | 'not-found' | 'server' | 'unknown'

/**
 * Normalised lifecycle state, flattened across issues and pull requests.
 * `queued` is a pull request sitting in a merge queue: still open, but no
 * longer waiting on anything the reader has to do.
 */
export type ItemState = 'open' | 'closed' | 'merged' | 'draft' | 'queued'

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

export type CheckState = 'EXPECTED' | 'ERROR' | 'FAILURE' | 'PENDING' | 'SUCCESS'

/**
 * How a pull request stands against its base branch, flattened from GitHub's
 * `mergeable` and `mergeStateStatus`. Only the two the row cannot otherwise
 * say are drawn — a conflict and a stale branch — but the rest are kept so the
 * distinction is not lost on the way in.
 */
export type MergeState = 'clean' | 'conflicting' | 'behind' | 'blocked' | 'unstable'

/** A check that is red, and where to go and look at it. */
export interface FailingCheck {
  name: string
  url: string | null
}

export interface Label {
  name: string
  color: string
}

/** Someone the issue or pull request is assigned to. */
export interface Assignee {
  login: string
  avatarUrl: string | null
}

/**
 * Where a pull request sits in its stack: a chain of pull requests where each
 * one targets the branch of the pull request below it. Read with the search.
 */
export interface StackMembership {
  /** `PullRequestStack` node id. Keys the stack everywhere. */
  id: string
  /** Identifies the stack within its repository. */
  number: number
  size: number
  /** The branch the whole stack lands on, usually the default branch. */
  baseRefName: string
  /** 1 is the layer closest to the base branch. */
  position: number
}

/** One layer of a whole stack. */
export interface StackLayer {
  /** Pull request node id. */
  id: string
  number: number
  title: string
  url: string
  repository: string
  state: ItemState
  /** 1 is the layer closest to the base branch. */
  position: number
}

/** A whole stack, read by id when the reader goes to open one. */
export interface Stack {
  /** `PullRequestStack` node id. */
  id: string
  number: number
  size: number
  baseRefName: string
  /** Every layer the token can read, from the base branch up. */
  layers: StackLayer[]
  /** When the request that read it started. A newer read replaces an older one. */
  fetchedAt: number
}

/** A loaded row in a stack, which a cached copy of that stack has to agree with. */
export interface StackedRow {
  /** Pull request node id. */
  id: string
  stack: StackMembership
}

/**
 * How far a row has got in the second of the two requests that build it.
 *
 * The costly half of a row — review decision, CI rollup, merge state —
 * is asked for separately, so a row exists on screen before those are known.
 * `failed` is kept apart from `ready` because a row that has no red mark and a
 * row whose checks could not be read look identical otherwise, and only one of
 * them is worth telling the reader about.
 */
export type EnrichmentState = 'pending' | 'ready' | 'failed'

/**
 * The half of a row that the search query cannot afford to ask for.
 *
 * Sent on its own, keyed by node id, rather than as a whole row: the row it
 * belongs to may have been refreshed by something else in the meantime, and
 * merging by field is the only version of this that cannot put a stale title
 * back on screen.
 */
export interface ItemEnrichment {
  id: string
  reviewDecision: ReviewDecision | null
  checkState: CheckState | null
  failingChecks: FailingCheck[]
  checkCount: number | null
  checksRead: number
  mergeState: MergeState | null
}

export interface SearchItem {
  id: string
  kind: ItemKind
  number: number
  title: string
  url: string
  repository: string
  authorLogin: string | null
  authorAvatarUrl: string | null
  /** Everyone the row is assigned to, in GitHub's own order. Empty when none. */
  assignees: Assignee[]
  createdAt: string
  updatedAt: string
  state: ItemState
  /** Why an issue was closed, when GitHub reports it. */
  stateReason: string | null
  commentCount: number
  /** Only the first few are read; `labelCount` is how many there really are. */
  labels: Label[]
  labelCount: number
  reviewDecision: ReviewDecision | null
  checkState: CheckState | null
  additions: number | null
  deletions: number | null
  /** The pull request's own branch. Null for issues. */
  headRefName: string | null
  /** The head commit, which is how a new push is told from an edit. */
  headRefOid: string | null
  /** Null for issues, and where GitHub has not worked it out yet. */
  mergeState: MergeState | null
  /** The red checks, named. Empty where nothing is failing. */
  failingChecks: FailingCheck[]
  /** How many checks the rollup had, read or not, so a partial list says so. */
  checkCount: number | null
  /** How many of them this query actually read; the rest are unknown. */
  checksRead: number
  /** Null for issues, and for pull requests that are not part of a stack. */
  stack: StackMembership | null
  /**
   * Whether the fields above it that come from the second request have
   * arrived. Issues are `ready` on sight: none of those fields apply to them.
   */
  enrichment: EnrichmentState
}

export interface SearchPage {
  items: SearchItem[]
  totalCount: number
  endCursor: string | null
  hasNextPage: boolean
  /** When the page was produced, used to show data freshness. */
  fetchedAt: number
  /**
   * Set when GitHub answered with results *and* errors — typically a token
   * that cannot reach some of the organisations the query covers. The list is
   * usable but incomplete, so this is shown alongside it rather than instead
   * of it.
   */
  warning: string | null
}
