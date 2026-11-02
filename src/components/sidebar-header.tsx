import {
  BeakerIcon,
  CheckIcon,
  ChevronDownIcon,
  GearIcon,
  MarkGithubIcon,
  SidebarExpandIcon,
  SlidersIcon,
  SyncIcon,
  XIcon,
} from '@primer/octicons-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Hint } from '@/components/ui/tooltip'
import { IndeterminateBar } from '@/components/ui/progress-bar'
import { sendMessage } from '@/lib/messages'
import type { SavedQuery } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface Props {
  queries: SavedQuery[]
  activeQuery: SavedQuery | null
  isFetching: boolean
  /** Total matches for the active query, or `null` while nothing has loaded. */
  count: number | null
  /**
   * Any refresh at all, including the ones the worker runs on its own after
   * answering from cache. Broader than `isFetching`, which only covers this
   * tab's own request.
   */
  isRefreshing: boolean
  canRefresh: boolean
  canMarkAllSeen: boolean
  /** Developer mode only: opens the part of settings that holds the log. */
  canInspect: boolean
  onSelectQuery: (id: string) => void
  onManageQueries: () => void
  onMarkAllSeen: () => void
  onRefresh: () => void
  onCollapse: () => void
  onHide: () => void
}

export function SidebarHeader({
  queries,
  activeQuery,
  isFetching,
  count,
  isRefreshing,
  canRefresh,
  canMarkAllSeen,
  canInspect,
  onSelectQuery,
  onManageQueries,
  onMarkAllSeen,
  onRefresh,
  onCollapse,
  onHide,
}: Props) {
  return (
    <header
      aria-busy={isRefreshing}
      className="group/header @container relative flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-2"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 min-w-0 shrink justify-start gap-2 rounded-full py-1 pl-1 pr-2 data-[state=open]:bg-accent"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <MarkGithubIcon className="size-4" />
            </span>
            <span className="truncate text-[13px] font-semibold">
              {activeQuery?.name ?? 'No query'}
            </span>
            {/* The footer still has the count when the header is too narrow for it. */}
            {count !== null && (
              <span
                data-header-count=""
                className="hidden shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-muted-foreground @xs:inline"
              >
                {count.toLocaleString()}
              </span>
            )}
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Saved queries</DropdownMenuLabel>
          {queries.map((query) => {
            const isActive = query.id === activeQuery?.id
            return (
              <DropdownMenuItem key={query.id} onSelect={() => onSelectQuery(query.id)}>
                <CheckIcon className={cn(!isActive && 'invisible')} />
                <span className={cn('truncate', isActive && 'font-semibold')}>{query.name}</span>
              </DropdownMenuItem>
            )
          })}

          <DropdownMenuSeparator />
          {canMarkAllSeen && (
            <DropdownMenuItem onSelect={onMarkAllSeen}>
              <CheckIcon />
              Mark all as seen
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onManageQueries}>
            <SlidersIcon />
            Manage queries
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void sendMessage({ type: 'open-options' })}>
            <GearIcon />
            Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {/* Fold away until the header is hovered or focused, leaving the query name more room. */}
        <span className={FOLD}>
          <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
            {canInspect && (
              <HeaderButton
                label="Open developer tools"
                hint="What the panel has asked GitHub"
                onClick={() => void sendMessage({ type: 'open-options', section: 'developer' })}
              >
                <BeakerIcon />
              </HeaderButton>
            )}

            {/*
             * Collapsing swaps the panel for the launcher on the left edge, so
             * the mark points left. Octicon's sidebar marks are named for a
             * sidebar on the right, so the leftward arrow is `sidebar-expand`.
             */}
            <HeaderButton label="Collapse" onClick={onCollapse}>
              <SidebarExpandIcon />
            </HeaderButton>
          </span>
        </span>

        <HeaderButton
          label="Refresh results"
          hint="Refresh"
          onClick={onRefresh}
          disabled={!canRefresh}
        >
          <SyncIcon className={cn(isFetching && 'animate-spin')} />
        </HeaderButton>

        <HeaderButton label="Hide sidebar" onClick={onHide}>
          <XIcon />
        </HeaderButton>
      </div>

      {/*
       * Laid over the header's bottom border rather than added below it, so
       * appearing and disappearing never shifts the list by a pixel. This is
       * the only thing that reports a refresh the worker started on its own,
       * where the request never passes through this tab at all.
       */}
      {isRefreshing && (
        <IndeterminateBar
          label="Refreshing results"
          className="absolute inset-x-0 -bottom-px h-0.5"
        />
      )}
    </header>
  )
}

/**
 * Hidden until the header is hovered or holds focus, matching the launcher's
 * own controls. Grid tracks animate between 0fr and 1fr, which a width
 * transition cannot do without a fixed width.
 */
const FOLD = cn(
  'grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-300 ease-stack',
  'motion-reduce:transition-none',
  'group-hover/header:grid-cols-[1fr] group-hover/header:opacity-100',
  'group-focus-within/header:grid-cols-[1fr] group-focus-within/header:opacity-100',
)

function HeaderButton({
  label,
  hint = label,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  /** Tooltip text, when it differs from the accessible name. */
  hint?: string
}) {
  return (
    <Hint label={hint}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={cn(
          'rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-inset',
          className,
        )}
        {...props}
      />
    </Hint>
  )
}
