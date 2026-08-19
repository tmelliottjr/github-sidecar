import {
  CheckIcon,
  ChevronDownIcon,
  FilterIcon,
  FoldDownIcon,
  FoldUpIcon,
  GearIcon,
  LockIcon,
  MarkGithubIcon,
  ScreenNormalIcon,
  SidebarExpandIcon,
  SlidersIcon,
  SyncIcon,
  UnlockIcon,
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
import type { SavedQuery, WindowState } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface Props {
  onPointerDown: (event: React.PointerEvent) => void
  windowState: WindowState
  queries: SavedQuery[]
  activeQuery: SavedQuery | null
  isFetching: boolean
  /**
   * Any refresh at all, including the ones the worker runs on its own after
   * answering from cache. Broader than `isFetching`, which only covers this
   * tab's own request.
   */
  isRefreshing: boolean
  canRefresh: boolean
  /** Whether the filter is offered at all, and whether it is currently open. */
  canFilter: boolean
  isFiltering: boolean
  canMarkAllSeen: boolean
  onSelectQuery: (id: string) => void
  onManageQueries: () => void
  onToggleFilter: () => void
  onMarkAllSeen: () => void
  onRefresh: () => void
  onPatchWindow: (patch: Partial<WindowState>) => void
  onToggleDock: () => void
  onHide: () => void
}

export function SidebarHeader({
  onPointerDown,
  windowState,
  queries,
  activeQuery,
  isFetching,
  isRefreshing,
  canRefresh,
  canFilter,
  isFiltering,
  canMarkAllSeen,
  onSelectQuery,
  onManageQueries,
  onToggleFilter,
  onMarkAllSeen,
  onRefresh,
  onPatchWindow,
  onToggleDock,
  onHide,
}: Props) {
  const { docked } = windowState

  // Controls sit inside the drag handle, so their pointer events must not
  // bubble up and start a drag.
  const stopDrag = (event: React.PointerEvent) => event.stopPropagation()

  return (
    <header
      onPointerDown={docked ? undefined : onPointerDown}
      aria-busy={isRefreshing}
      className={cn(
        'relative flex h-11 shrink-0 items-center gap-1 border-b border-border px-2',
        docked || windowState.locked
          ? 'cursor-default'
          : 'cursor-grab active:cursor-grabbing',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0 max-w-[55%] shrink justify-start gap-1 px-1.5"
            onPointerDown={stopDrag}
          >
            <MarkGithubIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-bold tracking-tight">
              {activeQuery?.name ?? 'No query'}
            </span>
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Saved queries</DropdownMenuLabel>
          {queries.map((query) => (
            <DropdownMenuItem
              key={query.id}
              onSelect={() => onSelectQuery(query.id)}
              className={cn(query.id === activeQuery?.id && 'bg-accent')}
            >
              <span className="truncate font-semibold">{query.name}</span>
            </DropdownMenuItem>
          ))}

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

      <div
        data-drag-region
        className="h-full flex-1 self-stretch"
        aria-hidden
      />

      <div className="flex shrink-0 items-center gap-0.5" onPointerDown={stopDrag}>
        {canFilter && (
          <Hint label="Filter these rows">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleFilter}
              aria-pressed={isFiltering}
              aria-label="Filter these rows"
            >
              <FilterIcon className={cn(isFiltering && 'text-foreground')} />
            </Button>
          </Hint>
        )}

        <Hint label="Refresh">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={!canRefresh}
            aria-label="Refresh results"
          >
            <SyncIcon className={cn(isFetching && 'animate-spin')} />
          </Button>
        </Hint>

        <Hint label={docked ? 'Float the window' : 'Dock to the page'}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleDock}
            aria-pressed={docked}
            aria-label={docked ? 'Float the window' : 'Dock to the page'}
          >
            {docked ? <ScreenNormalIcon /> : <SidebarExpandIcon />}
          </Button>
        </Hint>

        {/* Docked, the panel has no free position to lock. */}
        {!docked && (
          <Hint label={windowState.locked ? 'Unlock position' : 'Lock position'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onPatchWindow({ locked: !windowState.locked })}
              aria-pressed={windowState.locked}
              aria-label={windowState.locked ? 'Unlock position' : 'Lock position'}
            >
              {windowState.locked ? <LockIcon className="text-attention" /> : <UnlockIcon />}
            </Button>
          </Hint>
        )}

        {/*
         * Collapsing folds a floating window up into its header and a docked
         * one sideways into a rail, so the mark points the way it will go.
         * Octicon's sidebar marks are named for a sidebar on the right, so the
         * leftward arrow this needs is the one called `sidebar-expand`.
         */}
        <Hint label={windowState.collapsed ? 'Expand' : 'Collapse'}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onPatchWindow({ collapsed: !windowState.collapsed })}
            aria-label={windowState.collapsed ? 'Expand' : 'Collapse'}
          >
            {docked ? (
              <SidebarExpandIcon />
            ) : windowState.collapsed ? (
              <FoldDownIcon />
            ) : (
              <FoldUpIcon />
            )}
          </Button>
        </Hint>

        <Hint label="Hide sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
            aria-label="Hide sidebar"
          >
            <XIcon />
          </Button>
        </Hint>
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
