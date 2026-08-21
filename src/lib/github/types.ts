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

/** One layer of a stack, as much of it as a row needs to list its neighbours. */
export interface StackEntry {
  id: string
  number: number
  title: string
  url: string
  repository: string
  state: ItemState
  reviewDecision: ReviewDecision | null
  /** 1 is the layer closest to the base branch. */
  position: number
}

/**
 * A pull request's membership of a stack: a chain of pull requests where each
 * one targets the branch of the pull request below it.
 */
export interface StackInfo {
  /** Identifies the stack within its repository. */
  number: number
  size: number
  /** The branch the whole stack lands on, usually the default branch. */
  baseRefName: string
  /** This pull request's own position, counting from the base branch. */
  position: number
  /** Ordered from the base branch up. Can be shorter than `size`. */
  entries: StackEntry[]
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
  stack: StackInfo | null
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
