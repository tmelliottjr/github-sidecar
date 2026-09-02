import { ChevronRightIcon, ChevronUpIcon, StackIcon } from '@primer/octicons-react'

import { ReviewIndicator, StateIcon } from '@/components/status-icons'
import { ClampedTitle } from '@/components/ui/clamped-title'
import { Hint } from '@/components/ui/tooltip'
import type { StackEntry, StackInfo } from '@/lib/github/types'
import { cn } from '@/lib/utils'

/**
 * Where a row sits in its stack, as `layer / size`, and the control that opens
 * the rest of the stack beneath the row. The badge doubles as the disclosure
 * because it is the only mark on the row that is about the stack at all.
 */
export function StackBadge({
  stack,
  isOpen,
  onToggle,
}: {
  stack: StackInfo
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <Hint
      label={`Stack #${stack.number} · layer ${stack.position} of ${stack.size}, onto ${stack.baseRefName}. Click to ${isOpen ? 'hide' : 'show'} it.`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Hide the stack' : 'Show the stack'}
        className={cn(
          'flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-semibold leading-[1.5]',
          'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          isOpen
            ? 'border-foreground/25 bg-accent text-foreground'
            : 'border-border bg-muted text-muted-foreground hover:border-foreground/25 hover:text-foreground',
        )}
      >
        <StackIcon className="size-2.5" aria-hidden />
        <span className="tabular-nums">
          {stack.position}/{stack.size}
        </span>
      </button>
    </Hint>
  )
}

interface Props {
  stack: StackInfo
  /** Node id of the row this stack was expanded from, so it can be marked. */
  currentId: string
  onOpen: (url: string, event: React.MouseEvent) => void
  onCollapse: () => void
}

/**
 * The rest of the stack, listed base-first so it reads bottom-up the way the
 * branches are built. The row it was expanded from stays in the list rather
 * than being filtered out, because a stack is only legible as a whole.
 */
export function StackSection({ stack, currentId, onOpen, onCollapse }: Props) {
  const hidden = stack.size - stack.entries.length

  return (
    <div className="border-t border-border/60 bg-muted/40">
      <CollapseHandle onCollapse={onCollapse} />

      <ul className="flex flex-col pb-1 pl-[26px] pr-2">
        {stack.entries.map((entry) => (
          <li key={entry.id}>
            <StackRow
              entry={entry}
              isCurrent={entry.id === currentId}
              onOpen={onOpen}
            />
          </li>
        ))}

        {hidden > 0 && (
          <li className="py-1 pl-6 text-[11px] text-muted-foreground">
            and {hidden} more {hidden === 1 ? 'layer' : 'layers'}
          </li>
        )}

        <li className="flex items-center gap-1.5 py-1 pl-1.5 text-[11px] text-muted-foreground">
          <span className="h-3 w-px bg-border" aria-hidden />
          <span className="truncate">onto {stack.baseRefName}</span>
        </li>
      </ul>
    </div>
  )
}

/**
 * The lid of the slide-out. It reads as the edge the section was pulled from,
 * so shutting it again is where the eye already is — the badge that opened it
 * is now several rows away.
 */
function CollapseHandle({ onCollapse }: { onCollapse: () => void }) {
  return (
    <Hint label="Hide the stack" side="top">
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Hide the stack"
        className="group/lid flex w-full cursor-pointer items-center justify-center py-1 focus-visible:outline-none"
      >
        <ChevronUpIcon
          className={cn(
            'size-3.5 text-muted-foreground transition-[color,transform] duration-200',
            'group-hover/lid:-translate-y-px group-hover/lid:text-foreground',
            'group-focus-visible/lid:-translate-y-px group-focus-visible/lid:text-foreground',
            'motion-reduce:transition-none',
          )}
          aria-hidden
        />
      </button>
    </Hint>
  )
}

function StackRow({
  entry,
  isCurrent,
  onOpen,
}: {
  entry: StackEntry
  isCurrent: boolean
  onOpen: (url: string, event: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={(event) => onOpen(entry.url, event)}
      aria-current={isCurrent || undefined}
      className={cn(
        'relative flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        isCurrent && 'bg-accent/60',
      )}
    >
      {/* Hangs into the section's left gutter so it never shifts the row. */}
      {isCurrent && (
        <ChevronRightIcon
          className="pointer-events-none absolute -left-4 top-1/2 size-4 -translate-y-1/2 text-foreground"
          aria-hidden
        />
      )}
      <span
        className={cn(
          'w-3 shrink-0 text-[10px] font-bold tabular-nums',
          isCurrent ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {entry.position}
      </span>
      <StateIcon item={{ kind: 'pull-request', state: entry.state, stateReason: null }} />
      <ClampedTitle
        title={entry.title}
        className={cn(
          'truncate text-[12px] text-foreground',
          isCurrent && 'font-semibold',
        )}
      >
        <span className="text-muted-foreground tabular-nums">#{entry.number}</span>{' '}
        {entry.title}
      </ClampedTitle>
      <span className="ml-auto flex shrink-0 items-center">
        <ReviewIndicator decision={entry.reviewDecision} />
      </span>
    </button>
  )
}
