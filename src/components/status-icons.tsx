import type { Icon } from '@primer/octicons-react'
import {
  CheckCircleFillIcon,
  CheckIcon,
  DotFillIcon,
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
  XCircleFillIcon,
} from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CheckState, Label, ReviewDecision, SearchItem } from '@/lib/github/types'

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

const CHECK_META: Record<CheckState, { label: string; className: string; Icon: Icon }> = {
  SUCCESS: { label: 'All checks passing', className: 'text-open', Icon: CheckCircleFillIcon },
  FAILURE: { label: 'Checks failing', className: 'text-closed', Icon: XCircleFillIcon },
  ERROR: { label: 'Checks errored', className: 'text-closed', Icon: XCircleFillIcon },
  PENDING: { label: 'Checks running', className: 'text-attention', Icon: DotFillIcon },
  EXPECTED: { label: 'Checks expected', className: 'text-attention', Icon: DotFillIcon },
}

export function CheckIndicator({ state }: { state: CheckState | null }) {
  if (!state) return null
  const { label, className, Icon } = CHECK_META[state]
  return (
    <Hint label={label}>
      <span className={cn('flex items-center', className)}>
        {/*
         * In-progress checks are GitHub's amber dot, which is drawn still: the
         * mark is rotationally symmetric, so the slow spin the pending state
         * used to carry would have been motion nobody could see.
         */}
        <Icon className="size-3.5" />
        <span className="sr-only">{label}</span>
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
