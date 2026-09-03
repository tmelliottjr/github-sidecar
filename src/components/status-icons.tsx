import type { Icon } from '@primer/octicons-react'
import {
  BellFillIcon,
  BellIcon,
  CheckCircleFillIcon,
  CheckIcon,
  DiffIgnoredIcon,
  DotFillIcon,
  EyeClosedIcon,
  EyeIcon,
  FileDiffIcon,
  GitMergeIcon,
  GitMergeQueueIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  SkipIcon,
  SyncIcon,
  XCircleFillIcon,
} from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { describeChange, describeChanges, type ChangeKind, type ItemSignature } from '@/lib/attention'
import type {
  CheckState,
  FailingCheck,
  Label,
  MergeState,
  ReviewDecision,
  SearchItem,
} from '@/lib/github/types'

const STATE_META: Record<
  SearchItem['state'],
  { label: string; className: string }
> = {
  open: { label: 'Open', className: 'text-open' },
  closed: { label: 'Closed', className: 'text-closed' },
  merged: { label: 'Merged', className: 'text-merged' },
  draft: { label: 'Draft', className: 'text-draft' },
  queued: { label: 'Queued to merge', className: 'text-attention' },
}

/** The leading glyph: encodes item kind and lifecycle state in one mark. */
export function StateIcon({
  item,
}: {
  item: Pick<SearchItem, 'kind' | 'state' | 'stateReason'>
}) {
  const meta = STATE_META[item.state]
  const Icon = pickIcon(item)
  const detail =
    item.state === 'closed' && item.stateReason === 'NOT_PLANNED'
      ? 'Closed as not planned'
      : meta.label

  return (
    <Hint label={`${item.kind === 'issue' ? 'Issue' : 'Pull request'} · ${detail}`}>
      <span className={cn('mt-px flex shrink-0 items-center', meta.className)}>
        <Icon className="size-4" aria-label={detail} />
      </span>
    </Hint>
  )
}

function pickIcon(item: Pick<SearchItem, 'kind' | 'state' | 'stateReason'>) {
  if (item.kind === 'issue') {
    if (item.state === 'closed') {
      return item.stateReason === 'NOT_PLANNED' ? SkipIcon : IssueClosedIcon
    }
    return IssueOpenedIcon
  }
  switch (item.state) {
    case 'merged':
      return GitMergeIcon
    case 'closed':
      return GitPullRequestClosedIcon
    case 'draft':
      return GitPullRequestDraftIcon
    // Octicons carries GitHub's own mark for the merge queue, so a queued
    // pull request is now told apart by its glyph as well as its colour.
    case 'queued':
      return GitMergeQueueIcon
    default:
      return GitPullRequestIcon
  }
}

const NO_CHECKS: readonly FailingCheck[] = []

const CHECK_META: Record<CheckState, { label: string; className: string; Icon: Icon }> = {
  SUCCESS: { label: 'All checks passing', className: 'text-open', Icon: CheckCircleFillIcon },
  FAILURE: { label: 'Checks failing', className: 'text-closed', Icon: XCircleFillIcon },
  ERROR: { label: 'Checks errored', className: 'text-closed', Icon: XCircleFillIcon },
  PENDING: { label: 'Checks running', className: 'text-attention', Icon: DotFillIcon },
  EXPECTED: { label: 'Checks expected', className: 'text-attention', Icon: DotFillIcon },
}

/**
 * The check rollup. Red is the only state with anything more to say, so it is
 * the only one that says it: the mark counts what failed and opens the list of
 * them below the row, where each one links to the run that failed. That is the
 * trip the reader would otherwise make through the pull request and its Checks
 * tab to find out what "failing" meant.
 */
export function CheckIndicator({
  state,
  failing = NO_CHECKS,
  isOpen = false,
  partial = false,
  onToggle,
}: {
  state: CheckState | null
  failing?: readonly FailingCheck[]
  isOpen?: boolean
  /** True when the rollup had more checks than the query read. */
  partial?: boolean
  onToggle?: () => void
}) {
  if (!state) return null
  const { label, className, Icon } = CHECK_META[state]
  const count = onToggle ? failing.length : 0

  if (count === 0) {
    // A red rollup with nothing to name is otherwise the panel's most
    // arbitrary-looking mark: identical to the one beside it, minus the count
    // and the drawer, for reasons only the query knows.
    const unnamed =
      onToggle && (state === 'FAILURE' || state === 'ERROR')
        ? partial
          ? `${label}, and this query reads only the first checks of a rollup this large`
          : `${label}, though GitHub names none of them as red`
        : label

    return (
      <Hint label={unnamed}>
        <span data-check={state} className={cn('flex items-center', className)}>
          {/*
           * In-progress checks are GitHub's amber dot, which is drawn still:
           * the mark is rotationally symmetric, so the slow spin the pending
           * state used to carry would have been motion nobody could see.
           */}
          <Icon className="size-3.5 shrink-0" />
          {/* Says what the tooltip says: the explanation is the mark's meaning,
              not a decoration on top of it. */}
          <span className="sr-only">{unnamed}</span>
        </span>
      </Hint>
    )
  }

  const said = `${count} failing ${count === 1 ? 'check' : 'checks'}`
  return (
    <Hint label={`${said}. Click to ${isOpen ? 'hide' : 'show'} them.`}>
      <button
        type="button"
        data-check={state}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Hide the failing checks' : 'Show the failing checks'}
        className={cn(
          'flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-semibold leading-[1.5]',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          isOpen
            ? 'border-closed/40 bg-closed/15 text-closed'
            : 'border-border bg-muted text-closed hover:border-closed/40',
        )}
      >
        <Icon className="size-2.5" aria-hidden />
        <span className="tabular-nums">{count}</span>
        <span className="sr-only">{said}</span>
      </button>
    </Hint>
  )
}

const MERGE_META: Partial<
  Record<MergeState, { label: string; className: string; Icon: Icon }>
> = {
  conflicting: {
    label: 'Conflicts with the base branch',
    className: 'text-conflict',
    Icon: DiffIgnoredIcon,
  },
  behind: {
    label: 'Behind the base branch',
    className: 'text-attention',
    Icon: SyncIcon,
  },
}

/**
 * Why a pull request cannot go in, where the rest of the row cannot say it.
 * Only conflicts and a stale branch are drawn: blocked and unstable are
 * GitHub's words for a missing review or a red check, both of which already
 * have their own mark on this line.
 */
export function MergeIndicator({ state }: { state: MergeState | null }) {
  const meta = state ? MERGE_META[state] : undefined
  if (!meta) return null
  const { label, className, Icon } = meta

  return (
    <Hint label={label}>
      <span className={cn('flex items-center', className)}>
        <Icon className="size-3.5" />
        <span className="sr-only">{label}</span>
      </span>
    </Hint>
  )
}

const REMINDER_META = {
  waiting: { className: 'text-muted-foreground', Icon: BellIcon },
  // A reminder that has come round is the one mark on the line that is asking
  // for something, so it is drawn in the colour the rest of the panel uses for
  // exactly that.
  due: { className: 'text-attention', Icon: BellFillIcon },
} as const

/** A reminder the reader set on this row, waiting or come round. */
export function ReminderMark({
  state,
  label,
}: {
  state: 'waiting' | 'due'
  label: string
}) {
  const { className, Icon } = REMINDER_META[state]

  return (
    <Hint label={label}>
      <span data-reminder={state} className={cn('flex items-center', className)}>
        <Icon className="size-3.5" />
        <span className="sr-only">{label}</span>
      </span>
    </Hint>
  )
}

/** Says why a row is on screen at all, when the reader had hidden it. */
export function HiddenMark() {
  return (
    <Hint label="Hidden from the list">
      <span data-hidden className="flex items-center text-muted-foreground">
        <EyeClosedIcon className="size-3.5" />
        <span className="sr-only">Hidden from the list</span>
      </span>
    </Hint>
  )
}

/**
 * What has happened to a row since the reader last looked at it. The loudest
 * change leads, because a row has one line to make its case; the rest arrive
 * on hover.
 */
export function ChangeBadge({
  kinds,
  item,
  seen,
}: {
  kinds: readonly ChangeKind[]
  item: SearchItem
  seen: ItemSignature
}) {
  if (kinds.length === 0) return null

  return (
    <Hint label={describeChanges(kinds, item, seen)}>
      <span
        data-change={kinds[0]}
        className="flex items-center gap-1 text-[11px] font-semibold text-foreground"
      >
        <DotFillIcon className="size-2.5 shrink-0 text-ring" />
        <span className="max-w-[140px] truncate">{describeChange(kinds[0], item, seen)}</span>
        {kinds.length > 1 && (
          <span className="text-muted-foreground tabular-nums">+{kinds.length - 1}</span>
        )}
      </span>
    </Hint>
  )
}

const REVIEW_META: Record<ReviewDecision, { label: string; className: string; Icon: Icon }> = {
  APPROVED: { label: 'Approved', className: 'text-open', Icon: CheckIcon },
  CHANGES_REQUESTED: {
    label: 'Changes requested',
    className: 'text-closed',
    Icon: FileDiffIcon,
  },
  // Amber rather than grey: a review that has not happened yet is the one
  // state on this mark that is asking someone for something.
  REVIEW_REQUIRED: { label: 'Review required', className: 'text-attention', Icon: EyeIcon },
}

/**
 * The review decision, drawn as the checks mark is: a bare glyph at the same
 * size, in the same three colours. The two marks sit side by side, so any
 * difference in weight between them would read as a difference in importance.
 */
export function ReviewIndicator({ decision }: { decision: ReviewDecision | null }) {
  if (!decision) return null
  const { label, className, Icon } = REVIEW_META[decision]
  return (
    <Hint label={label}>
      <span className={cn('flex items-center', className)}>
        <Icon className="size-3.5" />
        <span className="sr-only">{label}</span>
      </span>
    </Hint>
  )
}

/** How many dots are drawn before the rest become a `+N`. */
const MAX_LABEL_DOTS = 5

/**
 * Labels as a row of overlapping colour discs. Names are what a label is for,
 * but at three or four to a row they crowd out the title, so the colour does
 * the work at rest and the name arrives on hover.
 *
 * Each disc is the label's own colour twice over: full strength as the ring
 * that draws it, and mixed into the surface behind it as the fill. Tinting
 * against `background` rather than using an alpha keeps the discs opaque, so
 * where they overlap the one in front still reads as the one in front.
 */
export function LabelDots({ labels, total }: { labels: Label[]; total: number }) {
  if (labels.length === 0) return null

  const shown = labels.slice(0, MAX_LABEL_DOTS)
  // `total` comes from GitHub and counts labels that were never read.
  const hidden = Math.max(total, labels.length) - shown.length

  return (
    <span className="flex items-center gap-1">
      <span className="flex items-center">
        {shown.map((label, index) => (
          <Hint key={label.name} label={label.name}>
            <span
              role="img"
              aria-label={label.name}
              // The ring is the row's own background, which is what makes the
              // overlap read as separate discs rather than one smear.
              className={cn(
                'size-3.5 rounded-full border ring-2 ring-background group-hover:ring-accent',
                index > 0 && '-ml-1.5',
              )}
              style={{
                borderColor: `#${label.color}`,
                backgroundColor: `color-mix(in oklab, #${label.color} 28%, var(--color-background))`,
              }}
            />
          </Hint>
        ))}
      </span>

      {hidden > 0 && (
        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
          +{hidden}
        </span>
      )}
    </span>
  )
}
