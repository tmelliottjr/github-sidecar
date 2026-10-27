import {
  CheckIcon,
  FilterIcon,
  FoldIcon,
  RowsIcon,
  SearchIcon,
  SortDescIcon,
  UnfoldIcon,
} from '@primer/octicons-react'

import { QuickFilterMenuContent, QuickFilterTokens } from '@/components/quick-filter'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import type { SearchItem } from '@/lib/github/types'
import {
  GROUP_LABELS,
  SORT_LABELS,
  FACETS,
  isQuickFiltered,
  type Facet,
  type GroupBy,
  type QuickFilter,
  type SortOrder,
} from '@/lib/list-view'
import { cn } from '@/lib/utils'

export type { GroupBy, SortOrder }

interface Props {
  /** The search box, so the panel can move focus to it. */
  inputRef: React.RefObject<HTMLInputElement | null>
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
  quickFilter: QuickFilter
  /** The facets the quick filter offers. */
  facets: readonly Facet[]
  /** Every row the list can show before anything narrows it. */
  rows: SearchItem[]
  /** The rows in `rows` that `text` matches. */
  textMatches: SearchItem[]
  onTextChange: (text: string) => void
  onSortChange: (sort: SortOrder) => void
  onGroupChange: (group: GroupBy) => void
  onToggleAllGroups: () => void
  onQuickFilterChange: (filter: QuickFilter) => void
}

/**
 * Narrowing and reordering what is already loaded. It is a reading aid rather
 * than a query: nothing here is sent to GitHub, so it answers as fast as it
 * can be typed and a mistake costs nothing to undo.
 *
 * It never takes focus on its own: it mounts with the panel on every page,
 * and focusing it then would take the keyboard away from github.com.
 */
export function FilterBar({
  inputRef,
  text,
  sort,
  group,
  allGroupsCollapsed,
  matches,
  quickFilter,
  facets,
  rows,
  textMatches,
  onTextChange,
  onSortChange,
  onGroupChange,
  onToggleAllGroups,
  onQuickFilterChange,
}: Props) {
  const isQuickFiltering = isQuickFiltered(quickFilter)
  const chosen = FACETS.reduce((total, facet) => total + (quickFilter[facet]?.length ?? 0), 0)

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border/70 p-2">
      <div className="flex items-center gap-0.5">
        <div className="relative mr-1 min-w-0 flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={inputRef}
            value={text}
            spellCheck={false}
            placeholder="Search these rows"
            aria-label="Filter the rows already loaded"
            onChange={(event) => onTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              if (text.length > 0) onTextChange('')
              else event.currentTarget.blur()
            }}
            className="h-8 rounded-full pl-8 pr-12 text-[12px]"
          />
          {(text.length > 0 || isQuickFiltering) && (
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
          <Hint label="Filter by status or person">
            <DropdownMenuTrigger
              className={cn(CONTROL, 'relative', isQuickFiltering && SET)}
              aria-label="Filter by status or person"
              disabled={rows.length === 0}
            >
              <FilterIcon className="size-3.5" />
              {chosen > 0 && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-link px-0.5 text-[9px] font-bold tabular-nums text-background ring-2 ring-background"
                >
                  {chosen}
                </span>
              )}
            </DropdownMenuTrigger>
          </Hint>
          <QuickFilterMenuContent
            filter={quickFilter}
            facets={facets}
            rows={rows}
            matching={textMatches}
            onChange={onQuickFilterChange}
          />
        </DropdownMenu>

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
      </div>

      {isQuickFiltering && (
        <QuickFilterTokens
          filter={quickFilter}
          rows={rows}
          onChange={onQuickFilterChange}
          onEmpty={() => inputRef.current?.focus()}
        />
      )}
    </div>
  )
}

const CONTROL = cn(
  'flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors',
  // `aria-expanded`, since the tooltip around each trigger overrides its `data-state`.
  'hover:bg-accent hover:text-foreground aria-expanded:bg-accent',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
  'disabled:pointer-events-none disabled:opacity-50',
)

/** A grouping, order, or quick filter other than the default, so the bar says it is in force. */
const SET = 'bg-accent text-foreground'
