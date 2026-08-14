export type ItemKind = 'issue' | 'pull-request'

/**
 * Normalised lifecycle state, flattened across issues and pull requests.
 * `queued` is a pull request sitting in a merge queue: still open, but no
 * longer waiting on anything the reader has to do.
 */
export type ItemState = 'open' | 'closed' | 'merged' | 'draft' | 'queued'

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

export type CheckState = 'EXPECTED' | 'ERROR' | 'FAILURE' | 'PENDING' | 'SUCCESS'

export interface Label {
  name: string
  color: string
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
}
