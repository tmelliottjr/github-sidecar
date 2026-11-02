import { StackIcon } from '@primer/octicons-react'

import { Drawer } from '@/components/drawer'
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
          'flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isOpen
            ? 'bg-foreground/10 text-foreground ring-1 ring-inset ring-foreground/20'
            : 'bg-[color:var(--row-chip,var(--color-muted))] text-muted-foreground hover:text-foreground',
        )}
      >
        <StackIcon className="size-3.5" aria-hidden />
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
 * The whole stack, listed top layer first so layer 1 sits at the bottom, the
 * way the branches are built. The row it was expanded from stays in the list
 * rather than being filtered out, because a stack is only legible as a whole.
 */
export function StackSection({ stack, currentId, onOpen, onCollapse }: Props) {
  const hidden = stack.size - stack.entries.length
  const layers = stack.entries.toReversed()

  return (
    <Drawer
      icon={<StackIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      caption={`Stack #${stack.number}`}
      meta={
        <>
          {stack.size} {stack.size === 1 ? 'layer' : 'layers'} onto{' '}
          <code className="rounded-md bg-muted px-1 py-px font-mono text-[10.5px] text-foreground">
            {stack.baseRefName}
          </code>
        </>
      }
      closeLabel="Hide the stack"
      onClose={onCollapse}
    >
      <ul className="flex flex-col gap-0.5">
        {layers.map((entry, index) => (
          <li
            key={entry.id}
            className={cn(
              'relative isolate',
              // Joins this step to the next, under the row fills and focus rings:
              // 28px rows, 18px steps, 2px apart.
              index < layers.length - 1 &&
                "after:absolute after:-z-10 after:left-[14px] after:top-[25px] after:h-2 after:w-0.5 after:rounded-full after:bg-border after:content-['']",
            )}
          >
            <StackRow
              entry={entry}
              isCurrent={entry.id === currentId}
              onOpen={onOpen}
            />
          </li>
        ))}

        {hidden > 0 && (
          <li className="py-1 pl-8 text-[11px] text-muted-foreground">
            and {hidden} more {hidden === 1 ? 'layer' : 'layers'}
          </li>
        )}
      </ul>
    </Drawer>
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
        'flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-left transition-colors',
        'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
      )}
    >
      <span
        className={cn(
          'flex size-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
          isCurrent
            ? 'bg-foreground text-background'
            : 'text-muted-foreground ring-1 ring-inset ring-border',
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
        <span className="font-normal text-muted-foreground tabular-nums">#{entry.number}</span>{' '}
        {entry.title}
      </ClampedTitle>
      <span className="ml-auto flex shrink-0 items-center">
        <ReviewIndicator decision={entry.reviewDecision} />
      </span>
    </button>
  )
}
