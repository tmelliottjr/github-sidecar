import { memo, useCallback, useState } from 'react'
import {
  ChevronDownIcon,
  CopyIcon,
  MarkdownIcon,
  PersonIcon,
  StackIcon,
} from '@primer/octicons-react'

import { Author, SURFACES } from '@/components/item-row'
import {
  CHECK_META,
  MERGE_META,
  REVIEW_META,
  StackDisc,
  StatusPill,
} from '@/components/status-icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { ClampedTitle } from '@/components/ui/clamped-title'
import { Hint } from '@/components/ui/tooltip'
import { copyText } from '@/lib/clipboard'
import type { CheckState, ReviewDecision, SearchItem, Stack } from '@/lib/github/types'
import { stackMarkdown, stackUrls } from '@/lib/links'
import { authorsOf, type FoldedStack, type Nesting } from '@/lib/list-view'
import { cn, relativeTime } from '@/lib/utils'

/** Draws the lift shadow on all sides of a stack card except where the next part of it joins. */
const CARD_TOP = 'rounded-t-xl rounded-b-none bg-background shadow-lift [clip-path:inset(-24px_-24px_0_-24px)]'
const CARD_MIDDLE = 'bg-background shadow-lift [clip-path:inset(0_-24px)]'
const CARD_BOTTOM = 'rounded-b-xl bg-background shadow-lift [clip-path:inset(0_-24px_-24px_-24px)]'

const REVIEW_ORDER: readonly ReviewDecision[] = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']

interface Marks {
  checks: CheckState | null
  failingChecks: number
  reviews: Array<[ReviewDecision, number]>
  merge: 'conflicting' | 'behind' | null
}

/** Checks, reviews, and merge state summed over the loaded layers. */
function sumMarks(layers: readonly SearchItem[], showMergeState: boolean): Marks {
  const ready = layers.filter((layer) => layer.enrichment !== 'pending')
  const failing = ready.filter((layer) => layer.checkState === 'FAILURE' || layer.checkState === 'ERROR')
  const checks: CheckState | null =
    failing.length > 0
      ? 'FAILURE'
      : ready.some((layer) => layer.checkState === 'PENDING' || layer.checkState === 'EXPECTED')
        ? 'PENDING'
        : ready.some((layer) => layer.checkState === 'SUCCESS')
          ? 'SUCCESS'
          : null

  const reviews = REVIEW_ORDER.map((decision): [ReviewDecision, number] => [
    decision,
    ready.filter((layer) => layer.reviewDecision === decision).length,
  ]).filter(([, count]) => count > 0)

  // `mergeable` arrives with the search, so a conflict can show before the rest.
  const merge = !showMergeState
    ? null
    : layers.some((layer) => layer.mergeState === 'conflicting')
      ? 'conflicting'
      : layers.some((layer) => layer.mergeState === 'behind')
        ? 'behind'
        : null

  return {
    checks,
    failingChecks: failing.reduce((total, layer) => total + (layer.failingChecks?.length ?? 0), 0),
    reviews,
    merge,
  }
}

function CombinedMarks({ marks, showFailingChecks }: { marks: Marks; showFailingChecks: boolean }) {
  if (!marks.checks && marks.reviews.length === 0 && !marks.merge) return null
  const check = marks.checks ? CHECK_META[marks.checks] : null
  const failingCount = showFailingChecks && marks.checks === 'FAILURE' ? marks.failingChecks : 0
  const checkLabel =
    failingCount > 0
      ? `${failingCount} failing ${failingCount === 1 ? 'check' : 'checks'} across the loaded layers`
      : check?.label
  const reviewLabel = marks.reviews
    .map(([decision, count]) => `${count} ${REVIEW_META[decision].label.toLowerCase()}`)
    .join(', ')
  const merge = marks.merge ? MERGE_META[marks.merge] : null

  return (
    <StatusPill>
      {check && (
        <Hint label={checkLabel}>
          <span className={cn('flex h-full items-center gap-1 px-1.5 text-[11px] font-semibold', check.className)}>
            <check.Icon className="size-3.5" />
            {failingCount > 0 && <span className="tabular-nums">{failingCount}</span>}
            <span className="sr-only">{checkLabel}</span>
          </span>
        </Hint>
      )}
      {marks.reviews.length > 0 && (
        <Hint label={reviewLabel}>
          <span className="flex h-full items-center gap-1.5 px-1.5 text-[11px] font-semibold tabular-nums">
            {marks.reviews.map(([decision, count]) => {
              const { className, Icon } = REVIEW_META[decision]
              return (
                <span key={decision} className={cn('flex items-center gap-0.5', className)}>
                  <Icon className="size-3.5" />
                  {count}
                </span>
              )
            })}
            <span className="sr-only">{reviewLabel}</span>
          </span>
        </Hint>
      )}
      {merge && (
        <Hint label={`${merge.label}, in a loaded layer`}>
          <span className={cn('flex h-full items-center px-1.5', merge.className)}>
            <merge.Icon className="size-3.5" />
            <span className="sr-only">{merge.label}</span>
          </span>
        </Hint>
      )}
    </StatusPill>
  )
}

const MAX_AUTHOR_FACES = 3

function Face({
  avatarUrl,
  className,
  style,
}: {
  avatarUrl: string | null
  className?: string
  style?: React.CSSProperties
}) {
  const [broken, setBroken] = useState(false)
  // The ring is the row surface, so overlapping faces read as separate discs.
  // The outline keeps a face visible on a hovered row, where bg-muted matches the surface.
  const disc = cn(
    'relative size-3.5 shrink-0 rounded-full bg-muted ring-2 ring-[color:var(--row-surface)] outline-1 -outline-offset-1 outline-border/60',
    className,
  )

  return avatarUrl && !broken ? (
    <img
      src={avatarUrl}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={disc}
      style={style}
    />
  ) : (
    <span aria-hidden className={cn(disc, 'flex items-center justify-center text-muted-foreground')} style={style}>
      <PersonIcon className="size-2.5" />
    </span>
  )
}

/** Several authors as overlapping faces, named on hover. */
function AuthorFaces({ authors }: { authors: Array<{ login: string; avatarUrl: string | null }> }) {
  const shown = authors.slice(0, MAX_AUTHOR_FACES)
  const hidden = authors.length - shown.length
  const label = authors.map((author) => author.login).join(', ')

  return (
    <Hint label={label}>
      <span data-stack-authors="" className="flex shrink-0 items-center gap-1">
        <span className="isolate flex items-center">
          {shown.map((author, index) => (
            // The first face sits in front, as in Primer's AvatarStack.
            <Face
              key={author.login}
              avatarUrl={author.avatarUrl}
              className={cn(index > 0 && '-ml-1')}
              style={{ zIndex: shown.length - index }}
            />
          ))}
        </span>
        {hidden > 0 && <span className="text-[11px] font-semibold tabular-nums">+{hidden}</span>}
        <span className="sr-only">{label}</span>
      </span>
    </Hint>
  )
}

interface Props {
  stack: FoldedStack
  isExpanded: boolean
  /** Whether a collapsed stack holds the page the tab is showing. */
  isCurrent: boolean
  /** Whether any loaded layer changed since the reader last looked. */
  hasChanges: boolean
  showFailingChecks: boolean
  showMergeState: boolean
  onToggle: (id: string) => void
  /** Loads the whole stack by id, from the worker cache when it can. */
  onLoadStack: (id: string) => Promise<Stack>
  onOpen: (item: SearchItem, event: React.MouseEvent) => void
}

/**
 * One row for a stack with two or more layers in the list. Shows the lead
 * layer title and the marks of every loaded layer, and toggles the layers
 * open beneath it.
 */
function StackRowImpl({
  stack,
  isExpanded,
  isCurrent,
  hasChanges,
  showFailingChecks,
  showMergeState,
  onToggle,
  onLoadStack,
  onOpen,
}: Props) {
  const { id, lead, layers } = stack
  const membership = lead.stack
  const size = membership?.size ?? layers.length
  const marks = sumMarks(layers, showMergeState)
  const authors = authorsOf(layers)
  const awaitingMarks = layers.some((layer) => layer.enrichment === 'pending')
  const updatedAt = layers.reduce(
    (latest, layer) => (layer.updatedAt > latest ? layer.updatedAt : latest),
    lead.updatedAt,
  )

  // A failed load shows inside the expanded stack; the log keeps the cause.
  const loadStack = useCallback(() => {
    void onLoadStack(id).catch((error: unknown) =>
      console.warn('[github-sidecar] could not load the stack', error),
    )
  }, [id, onLoadStack])
  const toggle = useCallback(() => onToggle(id), [id, onToggle])

  // Loads first even when a copy is cached, so a read in flight decides what is copied.
  const copyStack = useCallback(
    (format: (loaded: Stack) => string) => {
      void onLoadStack(id)
        .then((loaded) => copyText(format(loaded)))
        .catch((error: unknown) =>
          console.warn('[github-sidecar] could not copy to the clipboard', error),
        )
    },
    [id, onLoadStack],
  )

  const label = `Stack #${membership?.number ?? ''} · ${layers.length} of ${size} layers in this list, onto ${membership?.baseRefName ?? 'the base branch'}`

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-stack-row=""
          data-current={isCurrent || undefined}
          data-lifted={isExpanded || undefined}
          className={cn('group/row rounded-xl', isExpanded && CARD_TOP)}
        >
          <button
            type="button"
            data-item-body=""
            onClick={toggle}
            onPointerEnter={loadStack}
            onFocus={loadStack}
            aria-expanded={isExpanded}
            aria-current={isCurrent || undefined}
            className={cn(
              'group/body flex w-full flex-col rounded-xl bg-[color:var(--row-surface)] text-left transition-colors',
              SURFACES,
              isCurrent &&
                '[--row-surface:color-mix(in_oklab,var(--color-ring)_8%,var(--color-background))]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
            )}
          >
            <span className="flex w-full min-w-0 gap-2.5 px-2.5 pb-1.5 pt-2">
              <span className="relative mt-0.5 shrink-0">
                <StackDisc item={lead} />
                {hasChanges && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-link ring-2 ring-[color:var(--row-surface)]"
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-start gap-2">
                  <ClampedTitle
                    title={lead.title}
                    className="line-clamp-1 flex-1 text-[13px] font-semibold leading-[18px] text-foreground"
                  />
                  <span className="shrink-0 pt-px text-[11px] tabular-nums text-muted-foreground">
                    {relativeTime(updatedAt)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">
                  <span className="truncate">{lead.repository}</span>
                  <span className="shrink-0 tabular-nums">Stack #{membership?.number}</span>
                  {authors.length === 1 ? (
                    <Author login={authors[0].login} avatarUrl={authors[0].avatarUrl} />
                  ) : (
                    authors.length > 1 && <AuthorFaces authors={authors} />
                  )}
                </span>
              </span>
            </span>

            <span
              className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 pb-2 pl-12 pr-2.5',
                awaitingMarks && 'min-h-7',
              )}
            >
              <CombinedMarks marks={marks} showFailingChecks={showFailingChecks} />
              <Hint label={label}>
                <span
                  className={cn(
                    'flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold',
                    isExpanded
                      ? 'bg-foreground/10 text-foreground ring-1 ring-inset ring-foreground/20'
                      : 'bg-[color:var(--row-chip,var(--color-muted))] text-muted-foreground',
                  )}
                >
                  <StackIcon className="size-3.5" aria-hidden />
                  <span className="tabular-nums">
                    {size} {size === 1 ? 'layer' : 'layers'}
                  </span>
                  <ChevronDownIcon
                    className={cn('size-3 transition-transform motion-reduce:transition-none', isExpanded && 'rotate-180')}
                    aria-hidden
                  />
                  <span className="sr-only">{label}</span>
                </span>
              </Hint>
            </span>
          </button>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={toggle}>
          <StackIcon />
          {isExpanded ? 'Hide the stack' : 'Show the stack'}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Open a layer</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {layers.toReversed().map((layer) => (
              <ContextMenuItem
                key={layer.id}
                onSelect={(event) => onOpen(layer, event as unknown as React.MouseEvent)}
              >
                <span className="tabular-nums text-muted-foreground">#{layer.number}</span>
                <span className="max-w-64 truncate">{layer.title}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CopyIcon />
            Copy
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => copyStack(stackUrls)}>
              <StackIcon />
              Stack links
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => copyStack(stackMarkdown)}>
              <MarkdownIcon />
              Stack links as Markdown
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const StackRow = memo(StackRowImpl)

/** Height of a compact layer row, where the step sits centered. */
const COMPACT_STEP_TOP = 5
/** Lines a step up with the title of a full row. */
const FULL_STEP_TOP = 12
const STEP_SIZE = 18

/**
 * Holds one row of an expanded stack inside the stack card, with its numbered
 * step on a rail joining it to the layers above and below.
 */
export function StackRail({
  nesting,
  isLoaded,
  children,
}: {
  nesting: Nesting
  /** Whether the layer is one of the loaded rows, which fills its step. */
  isLoaded: boolean
  children: React.ReactNode
}) {
  const { position, isFirst, isLast } = nesting
  const stepTop = isLoaded ? FULL_STEP_TOP : COMPACT_STEP_TOP

  return (
    <div
      data-lifted=""
      data-stack-layer={position ?? undefined}
      className={cn(
        'relative flex items-start gap-1 px-1.5',
        isLast ? cn(CARD_BOTTOM, 'pb-1.5') : CARD_MIDDLE,
        isFirst && 'border-t border-border/70 pt-1',
      )}
    >
      {position !== null && (
        <>
          {!isFirst && (
            <span
              aria-hidden
              className="absolute left-[19px] top-0 w-0.5 bg-border"
              style={{ height: stepTop }}
            />
          )}
          {!isLast && (
            <span
              aria-hidden
              className="absolute bottom-0 left-[19px] w-0.5 bg-border"
              style={{ top: stepTop + STEP_SIZE + (isFirst ? 4 : 0) }}
            />
          )}
        </>
      )}
      <span className="flex w-7 shrink-0 justify-center" style={{ paddingTop: stepTop }}>
        {position !== null && (
          <span
            className={cn(
              'relative flex size-[18px] items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
              isLoaded
                ? 'bg-foreground text-background'
                : 'bg-background text-muted-foreground ring-1 ring-inset ring-border',
            )}
          >
            {position}
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
