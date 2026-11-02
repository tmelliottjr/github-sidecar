import { LinkExternalIcon, XCircleFillIcon, XIcon } from '@primer/octicons-react'

import { Drawer } from '@/components/drawer'
import type { FailingCheck } from '@/lib/github/types'
import { cn } from '@/lib/utils'

/**
 * How tall the list is allowed to get before it scrolls. Six rows is enough
 * for the usual handful and still leaves the row it belongs to on screen,
 * which is the point of a drawer rather than a page. Half of a seventh row
 * shows below them, so a longer list reads as one that scrolls.
 */
const MAX_VISIBLE = 6.5
/** A 28px row plus the 2px gap after it, as in `StackSection`. */
const ROW_PITCH = 30

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
    <Drawer
      icon={<XCircleFillIcon className="size-3.5 shrink-0 text-closed" aria-hidden />}
      caption={`${checks.length} failing ${checks.length === 1 ? 'check' : 'checks'}`}
      meta={total === null ? undefined : `of ${total}`}
      closeLabel="Hide the failing checks"
      onClose={onCollapse}
    >
      <ul
        className="scrollbar-slim flex flex-col gap-0.5 overflow-y-auto overscroll-contain"
        style={{ maxHeight: MAX_VISIBLE * ROW_PITCH }}
      >
        {checks.map((check) => (
          <li key={`${check.name}:${check.url ?? ''}`}>
            <CheckRow check={check} onOpen={onOpen} />
          </li>
        ))}

        {unread > 0 && (
          <li className="py-1 pl-8 text-[11px] text-muted-foreground">
            and {unread} more {unread === 1 ? 'check' : 'checks'} not read
          </li>
        )}
      </ul>
    </Drawer>
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
      {/* As wide as a stack step, so the marks in both drawers line up. */}
      <span className="flex size-[18px] shrink-0 items-center justify-center">
        <XIcon className="size-3.5 text-closed" aria-hidden />
      </span>
      <span className="truncate text-[12px]">{check.name}</span>
    </>
  )

  // A check GitHub gave no link for is still worth naming; it just cannot be
  // followed, and saying so quietly beats a control that does nothing.
  if (!check.url) {
    return (
      <span className="flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-muted-foreground">
        {name}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => onOpen(check.url as string, event)}
      className={cn(
        'group/check flex h-7 w-full items-center gap-2 rounded-lg px-1.5 text-left text-foreground transition-colors',
        'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
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
