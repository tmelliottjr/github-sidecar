import { useEffect, useRef } from 'react'
import {
  CheckIcon,
  FilterIcon,
  FoldIcon,
  RowsIcon,
  SortDescIcon,
  UnfoldIcon,
  XIcon,
} from '@primer/octicons-react'

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
    <div className="flex shrink-0 items-center gap-0.5 border-b border-border/70 px-2 py-2">
      <div className="relative mr-1 min-w-0 flex-1">
        <FilterIcon
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
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
          className="h-8 rounded-full pl-8 pr-12 text-[12px]"
        />
        {text.length > 0 && (
          <span
            className={cn(
              'pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-muted px-1.5',
              'text-[11px] font-semibold leading-[18px] tabular-nums',
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
            className={cn(CONTROL, group !== 'none' && SET)}
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
              <CheckIcon className={cn(option !== group && 'invisible')} />
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
            className={CONTROL}
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
            className={cn(CONTROL, sort !== 'default' && SET)}
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
              <CheckIcon className={cn(order !== sort && 'invisible')} />
              {SORT_LABELS[order]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Hint label="Close the filter">
        <button type="button" onClick={onClose} aria-label="Close the filter" className={CONTROL}>
          <XIcon className="size-3.5" />
        </button>
      </Hint>
    </div>
  )
}

const CONTROL = cn(
  'flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
  // `aria-expanded`, since the tooltip around each trigger overrides its `data-state`.
  'hover:bg-accent hover:text-foreground aria-expanded:bg-accent',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
)

/** A grouping or order other than the default, so the bar says it is in force. */
const SET = 'bg-accent text-foreground'
