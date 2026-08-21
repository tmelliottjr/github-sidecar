import { useEffect, useRef } from 'react'
import { FoldIcon, RowsIcon, SortDescIcon, UnfoldIcon, XIcon } from '@primer/octicons-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { GROUP_LABELS, SORT_LABELS, type GroupBy, type SortOrder } from '@/lib/list-view'
import { cn } from '@/lib/utils'

export type { GroupBy, SortOrder }

interface Props {
  text: string
  sort: SortOrder
  group: GroupBy
  /**
   * Whether every group is folded, or null when the list is flat and there is
   * nothing to fold — which is how the bar knows to leave the control off.
   */
  allGroupsCollapsed: boolean | null
  /** How many rows are left, so the bar can say when it has hidden them all. */
  matches: number
  onTextChange: (text: string) => void
  onSortChange: (sort: SortOrder) => void
  onGroupChange: (group: GroupBy) => void
  onToggleAllGroups: () => void
  onClose: () => void
}

/**
 * Narrowing and reordering what is already loaded. It is a reading aid rather
 * than a query: nothing here is sent to GitHub, so it answers as fast as it
 * can be typed and a mistake costs nothing to undo.
 *
 * It appears only when asked for. A permanently mounted search box would take
 * a row's worth of height from a panel that is mostly rows.
 */
export function FilterBar({
  text,
  sort,
  group,
  allGroupsCollapsed,
  matches,
  onTextChange,
  onSortChange,
  onGroupChange,
  onToggleAllGroups,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
      <div className="relative min-w-0 flex-1">
        <Input
          ref={inputRef}
          value={text}
          spellCheck={false}
          placeholder="Filter these rows"
          aria-label="Filter the rows already loaded"
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            }
          }}
          className="h-7 pr-12 text-[12px]"
        />
        {text.length > 0 && (
          <span
            className={cn(
              'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2',
              'text-[11px] tabular-nums',
              matches === 0 ? 'text-closed' : 'text-muted-foreground',
            )}
          >
            {matches}
          </span>
        )}
      </div>

      <DropdownMenu>
        <Hint label={`Group: ${GROUP_LABELS[group]}`}>
          <DropdownMenuTrigger
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              group !== 'none' && 'text-foreground',
            )}
            aria-label="Group the rows"
          >
            <RowsIcon className="size-3.5" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          {(Object.keys(GROUP_LABELS) as GroupBy[]).map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => onGroupChange(option)}
              data-selected={option === group || undefined}
            >
              {GROUP_LABELS[option]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {allGroupsCollapsed !== null && (
        <Hint label={allGroupsCollapsed ? 'Expand all groups' : 'Collapse all groups'}>
          <button
            type="button"
            onClick={onToggleAllGroups}
            aria-label={allGroupsCollapsed ? 'Expand all groups' : 'Collapse all groups'}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {allGroupsCollapsed ? (
              <UnfoldIcon className="size-3.5" />
            ) : (
              <FoldIcon className="size-3.5" />
            )}
          </button>
        </Hint>
      )}

      <DropdownMenu>
        <Hint label={`Order: ${SORT_LABELS[sort]}`}>
          <DropdownMenuTrigger
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              sort !== 'default' && 'text-foreground',
            )}
            aria-label="Change the order"
          >
            <SortDescIcon className="size-3.5" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end">
          {(Object.keys(SORT_LABELS) as SortOrder[]).map((order) => (
            <DropdownMenuItem
              key={order}
              onSelect={() => onSortChange(order)}
              data-selected={order === sort || undefined}
            >
              {SORT_LABELS[order]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Hint label="Close the filter">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the filter"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <XIcon className="size-3.5" />
        </button>
      </Hint>
    </div>
  )
}
