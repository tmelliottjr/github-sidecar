import { ChevronUpIcon, LinkExternalIcon, XCircleFillIcon } from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'
import type { FailingCheck } from '@/lib/github/types'
import { cn } from '@/lib/utils'

/**
 * How tall the list is allowed to get before it scrolls. Six rows is enough
 * for the usual handful and still leaves the row it belongs to on screen,
 * which is the point of a drawer rather than a page.
 */
const MAX_VISIBLE = 6
const ROW_HEIGHT = 26

interface Props {
  checks: readonly FailingCheck[]
  /** How many checks the rollup had in total, read or not. */
  total: number | null
  /** How many of them the query read, which is what bounds this list. */
  read: number
  onOpen: (url: string, event: React.MouseEvent) => void
  onCollapse: () => void
}

/**
 * Every red check, listed under the row, each one a link to the run that
 * failed. Drawn as a drawer rather than inline for the same reason a stack is:
 * a row has one line for its marks, and a list of check names is not one line.
 */
export function ChecksSection({ checks, total, read, onOpen, onCollapse }: Props) {
  // Only the first page of a rollup is read, so a repository with more checks
  // than that may be failing ones this list has never seen. Counted against
  // what was read rather than against what failed: the checks that passed were
  // read too, and were simply dropped on the way in.
  const unread = total === null ? 0 : Math.max(0, total - read)

  return (
    <div className="border-t border-border/60 bg-muted/40">
      <CollapseHandle onCollapse={onCollapse} />

      <ul
        className="scrollbar-slim flex flex-col overflow-y-auto overscroll-contain pb-1 pl-[26px] pr-2"
        style={{ maxHeight: MAX_VISIBLE * ROW_HEIGHT }}
      >
        {checks.map((check) => (
          <li key={`${check.name}:${check.url ?? ''}`}>
            <CheckRow check={check} onOpen={onOpen} />
          </li>
        ))}

        {unread > 0 && (
          <li className="py-1 pl-1.5 text-[11px] text-muted-foreground">
            and {unread} more {unread === 1 ? 'check' : 'checks'} not read
          </li>
        )}
      </ul>
    </div>
  )
}

/** The lid, shared in spirit with the stack's: shut it where the eye is. */
function CollapseHandle({ onCollapse }: { onCollapse: () => void }) {
  return (
    <Hint label="Hide the failing checks" side="top">
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Hide the failing checks"
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

function CheckRow({
  check,
  onOpen,
}: {
  check: FailingCheck
  onOpen: (url: string, event: React.MouseEvent) => void
}) {
  const name = (
    <>
      <XCircleFillIcon className="size-3 shrink-0 text-closed" aria-hidden />
      <span className="truncate text-[12px] text-foreground">{check.name}</span>
    </>
  )

  // A check GitHub gave no link for is still worth naming; it just cannot be
  // followed, and saying so quietly beats a control that does nothing.
  if (!check.url) {
    return (
      <span className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 opacity-70">
        {name}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => onOpen(check.url as string, event)}
      className={cn(
        'group/check flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
      )}
    >
      {name}
      <LinkExternalIcon
        className="ml-auto size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/check:opacity-100 group-focus-visible/check:opacity-100"
        aria-hidden
      />
    </button>
  )
}
