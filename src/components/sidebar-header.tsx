import {
  BeakerIcon,
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
  /** Total matches for the active query, or `null` while nothing has loaded. */
  count: number | null
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
  /** Developer mode only: opens the part of settings that holds the log. */
  canInspect: boolean
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
  count,
  isRefreshing,
  canRefresh,
  canFilter,
  isFiltering,
  canMarkAllSeen,
  canInspect,
  onSelectQuery,
  onManageQueries,
  onToggleFilter,
  onMarkAllSeen,
  onRefresh,
  onPatchWindow,
  onToggleDock,
  onHide,
}: Props) {
  const { docked, locked } = windowState

  // Controls sit inside the drag handle, so their pointer events must not
  // bubble up and start a drag.
  const stopDrag = (event: React.PointerEvent) => event.stopPropagation()

  const secondaryControls = (fade: boolean) => (
    <>
      {canInspect && (
        <HeaderButton
          secondary={fade}
          label="Open developer tools"
          hint="What the panel has asked GitHub"
          onClick={() => void sendMessage({ type: 'open-options', section: 'developer' })}
        >
          <BeakerIcon />
        </HeaderButton>
      )}

      <HeaderButton
        secondary={fade}
        label={docked ? 'Float the window' : 'Dock to the page'}
        onClick={onToggleDock}
        aria-pressed={docked}
      >
        {docked ? <ScreenNormalIcon /> : <SidebarExpandIcon />}
      </HeaderButton>

      {/* Docked, the panel has no free position to lock. A lock in force stays in view. */}
      {!docked && (
        <HeaderButton
          secondary={fade && !locked}
          label={locked ? 'Unlock position' : 'Lock position'}
          onClick={() => onPatchWindow({ locked: !locked })}
          aria-pressed={locked}
        >
          {locked ? <LockIcon className="text-attention" /> : <UnlockIcon />}
        </HeaderButton>
      )}

      {/*
       * Collapsing folds a floating window up into its header and swaps a
       * docked one for the launcher in the left corner, so the mark points
       * left. Octicon's sidebar marks are named for a sidebar on the right,
       * so the leftward arrow is the one called `sidebar-expand`.
       */}
      <HeaderButton
        secondary={fade}
        label={windowState.collapsed ? 'Expand' : 'Collapse'}
        onClick={() => onPatchWindow({ collapsed: !windowState.collapsed })}
      >
        {docked ? (
          <SidebarExpandIcon />
        ) : windowState.collapsed ? (
          <FoldDownIcon />
        ) : (
          <FoldUpIcon />
        )}
      </HeaderButton>
    </>
  )

  return (
    <header
      onPointerDown={docked ? undefined : onPointerDown}
      aria-busy={isRefreshing}
      className={cn(
        'group/header @container relative flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-2',
        docked || locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 min-w-0 shrink justify-start gap-2 rounded-full py-1 pl-1 pr-2 data-[state=open]:bg-accent"
            onPointerDown={stopDrag}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <MarkGithubIcon className="size-4" />
            </span>
            <span className="truncate text-[13px] font-semibold">
              {activeQuery?.name ?? 'No query'}
            </span>
            {/* The footer still has the count when the panel is too narrow for both. */}
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

      <div data-drag-region className="h-full flex-1 self-stretch" aria-hidden />

      <div className="flex shrink-0 items-center gap-0.5" onPointerDown={stopDrag}>
        {/*
         * Floating, hidden controls keep their space so the drag region never
         * shrinks under the pointer. Docked, there is nothing to drag, so they
         * fold away like the launcher's own and leave the query name more room.
         */}
        {docked ? (
          <span className={FOLD}>
            <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
              {secondaryControls(false)}
            </span>
          </span>
        ) : (
          secondaryControls(true)
        )}

        {canFilter && (
          <HeaderButton
            label="Filter these rows"
            onClick={onToggleFilter}
            aria-pressed={isFiltering}
            className="aria-pressed:bg-accent aria-pressed:text-foreground"
          >
            <FilterIcon />
          </HeaderButton>
        )}

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

/** Hidden until the header is hovered or holds focus, matching the launcher's own controls. */
const REVEAL = cn(
  'opacity-0 transition-opacity duration-200 ease-stack motion-reduce:transition-none',
  'group-hover/header:opacity-100 group-focus-within/header:opacity-100',
)

/**
 * The same reveal, but folding the controls' width too. Grid tracks animate
 * between 0fr and 1fr, which a width transition cannot do without a fixed width.
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
  secondary = false,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  /** Tooltip text, when it differs from the accessible name. */
  hint?: string
  /** Whether the control fades in only while the header is hovered or focused. */
  secondary?: boolean
}) {
  return (
    <Hint label={hint}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={cn(
          'rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-inset',
          secondary && REVEAL,
          className,
        )}
        {...props}
      />
    </Hint>
  )
}
