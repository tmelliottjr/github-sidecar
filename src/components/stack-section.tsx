import { Layers } from 'lucide-react'

import { ReviewIndicator, StateIcon } from '@/components/status-icons'
import { Hint } from '@/components/ui/tooltip'
import type { StackEntry, StackInfo } from '@/lib/github/types'
import { cn } from '@/lib/utils'

/**
 * Where a row sits in its stack, as `layer / size`. Deliberately not a link:
 * the row itself already opens the pull request, and the chevron beside it
 * opens the rest of the stack.
 */
export function StackBadge({ stack }: { stack: StackInfo }) {
  return (
    <Hint
      label={`Stack #${stack.number} · layer ${stack.position} of ${stack.size}, onto ${stack.baseRefName}`}
    >
      <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-semibold leading-[1.5] text-muted-foreground">
        <Layers className="size-2.5" aria-hidden />
        <span className="tabular-nums">
          {stack.position}/{stack.size}
        </span>
        <span className="sr-only">
          Stacked pull request, layer {stack.position} of {stack.size}
        </span>
      </span>
    </Hint>
  )
}

interface Props {
  stack: StackInfo
  /** Node id of the row this stack was expanded from, so it can be marked. */
  currentId: string
  onOpen: (url: string, event: React.MouseEvent) => void
}

/**
 * The rest of the stack, listed base-first so it reads bottom-up the way the
 * branches are built. The row it was expanded from stays in the list rather
 * than being filtered out, because a stack is only legible as a whole.
 */
export function StackSection({ stack, currentId, onOpen }: Props) {
  const hidden = stack.size - stack.entries.length

  return (
    <ul className="flex flex-col border-t border-border/60 bg-muted/40 py-1 pl-[26px] pr-2">
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
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        isCurrent && 'bg-accent/60',
      )}
    >
      <span className="w-3 shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {entry.position}
      </span>
      <StateIcon item={{ kind: 'pull-request', state: entry.state, stateReason: null }} />
      <span
        className={cn(
          'truncate text-[12px] text-foreground',
          isCurrent && 'font-semibold',
        )}
      >
        <span className="text-muted-foreground tabular-nums">#{entry.number}</span>{' '}
        {entry.title}
      </span>
      <span className="ml-auto flex shrink-0 items-center">
        <ReviewIndicator decision={entry.reviewDecision} />
      </span>
    </button>
  )
}
