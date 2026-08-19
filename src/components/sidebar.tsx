import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertIcon,
  FilterIcon,
  InboxIcon,
  KeyIcon,
  MarkGithubIcon,
  SlidersIcon,
  SyncIcon,
  XIcon,
} from '@primer/octicons-react'

import {
  DOCK_RAIL_WIDTH,
  DockRail,
  DockedPanel,
  clampDockWidth,
} from '@/components/docked-panel'
import { FloatingWindow } from '@/components/floating-window'
import { ItemList } from '@/components/item-list'
import { QueryEditor } from '@/components/query-editor'
import { SidebarHeader } from '@/components/sidebar-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Hint } from '@/components/ui/tooltip'
import { FilterBar, type SortOrder } from '@/components/filter-bar'
import { useDockLayout } from '@/hooks/use-dock-layout'
import { useCurrentPageItem } from '@/hooks/use-current-page-item'
import { useDocumentVisible } from '@/hooks/use-document-visible'
import { useItemMemory } from '@/hooks/use-item-memory'
import { useIssueSearch } from '@/hooks/use-issue-search'
import { useRefreshActivity } from '@/hooks/use-refresh-activity'
import { useSearchUpdates } from '@/hooks/use-search-updates'
import { useStorageValue } from '@/hooks/use-storage-value'
import { useTabOpen } from '@/hooks/use-tab-open'
import { changesSince, isHidden, nextReminderAt } from '@/lib/attention'
import type { SearchItem } from '@/lib/github/types'
import { filterItems, sortItems } from '@/lib/list-view'
import { sendMessage, RequestError } from '@/lib/messages'
import { DEFAULT_FEATURES, type SavedQuery, type Settings, type WindowState } from '@/lib/storage'
import { cn, relativeTime } from '@/lib/utils'

export function Sidebar() {
  const [settings, setSettings] = useStorageValue('settings')
  const [savedQueries, setSavedQueries] = useStorageValue('savedQueries')
  const [windowState, setWindowState] = useStorageValue('windowState')
  const [pinnedIds, setPinnedIds] = useStorageValue('pinnedIds')
  const [isOpen, setOpen] = useTabOpen()
  const [editing, setEditing] = useState(false)
  const isTabVisible = useDocumentVisible()
  const pageItem = useCurrentPageItem()
  const developer = settings?.developer
  // Only in developer mode: reminders that come round in seconds, so the thing
  // being worked on can be watched rather than waited for.
  const reminderOverrides = developer?.enabled ? developer.reminderSeconds : null
  const { memory, markSeen, remind, clearReminder, hide, unhide } =
    useItemMemory(reminderOverrides)
  const [filtering, setFiltering] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('default')
  const [showHidden, setShowHidden] = useState(false)

  const features = settings?.features ?? DEFAULT_FEATURES
  /**
   * Three features are built on the same record of what has been seen: the
   * marks on the rows, the count on the toolbar, and the notifications. Any
   * one of them switched on is a reason to keep that record, or a reader who
   * wanted only the count would have nothing for it to count against.
   */
  const tracksChanges =
    features.changes || features.badge || (settings?.notifications.enabled ?? false)

  useSearchUpdates()

  const patchWindow = useCallback(
    (patch: Partial<WindowState>) => {
      setWindowState((current) => ({ ...current, ...patch }))
    },
    [setWindowState],
  )

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => ({ ...current, ...patch }))
    },
    [setSettings],
  )

  // The toolbar button shows and hides the panel in the tab it was clicked on.
  useEffect(() => {
    const listener = (message: { type?: string }) => {
      if (message?.type === 'toggle-sidebar') setOpen(!(isOpen ?? false))
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [isOpen, setOpen])

  const activeQuery = useMemo<SavedQuery | null>(() => {
    if (!savedQueries?.length) return null
    return (
      savedQueries.find((query) => query.id === settings?.activeQueryId) ?? savedQueries[0]
    )
  }, [savedQueries, settings?.activeQueryId])

  const hasToken = Boolean(settings?.token)
  const isVisible = isOpen ?? false
  const isDocked = windowState?.docked ?? false
  const isCollapsed = windowState?.collapsed ?? false
  // Collapsing means two different things. Floating, it hides the list behind
  // the header. Docked, it swaps the panel for a rail that keeps reporting the
  // count, so results have to go on loading.
  //
  // The rail also stands in for a docked panel that was never opened in this
  // tab. A dock that is simply absent has to be recovered from the browser's
  // own extensions menu, which is a long way to go for a panel that is meant
  // to be part of the page; leaving the rail keeps it one click away.
  const isRail = isDocked && (isCollapsed || !isVisible)
  const dockWidth = windowState?.dockWidth ?? 0

  // Measuring the host page is only worth doing while the dock is on screen,
  // and the rail asks the page for far less room than the panel does.
  const dockTop = useDockLayout({
    enabled: isDocked,
    width: isRail ? DOCK_RAIL_WIDTH : dockWidth,
  })

  const toggleDock = useCallback(() => {
    setWindowState((current) => ({ ...current, docked: !current.docked }))
  }, [setWindowState])

  const setDockWidth = useCallback(
    (width: number) => {
      setWindowState((current) => ({ ...current, dockWidth: width }))
    },
    [setWindowState],
  )

  const search = useIssueSearch({
    query: activeQuery?.query ?? null,
    pollIntervalMs: settings?.pollIntervalMs ?? 0,
    // A hidden tab asks for nothing at all; it hydrates from the worker's
    // cache the moment the user switches to it.
    enabled: hasToken && isVisible && !(isCollapsed && !isDocked) && !editing && isTabVisible,
  })

  // The worker answers from its cache straight away and only then goes to the
  // network, so this tab's request has already resolved while the refresh it
  // set off is still running. `isFetching` is false for that whole window,
  // which is exactly the window worth reporting; the pages themselves say so
  // instead, and stop saying so when the result is broadcast back.
  const isRevalidating = search.data?.pages.some((page) => page.revalidating) ?? false
  const isRefreshing = useRefreshActivity(search.isFetching || isRevalidating)

  // Every page of a query is refused for the same reason, so the first page to
  // report one speaks for all of them.
  const warning = search.data?.pages.find((page) => page.warning)?.warning ?? null

  // Pinned rows are lifted to the top in the order they were pinned. Only the
  // pages already loaded can be reordered, so a pin on a row that has not been
  // fetched yet surfaces once its page arrives. The two groups are kept apart
  // rather than merged here: filtering and sorting are applied within each, so
  // reordering the list never drags a pinned row down into it.
  const groups = useMemo(() => {
    const loaded = search.data?.pages.flatMap((page) => page.items) ?? []
    const pinnedSet = new Set(pinnedIds ?? [])
    const byId = new Map(loaded.map((item) => [item.id, item]))
    const pinned = (pinnedIds ?? [])
      .map((id) => byId.get(id))
      .filter((item): item is SearchItem => item !== undefined)

    return {
      pinned,
      rest: pinned.length === 0 ? loaded : loaded.filter((item) => !pinnedSet.has(item.id)),
    }
  }, [pinnedIds, search.data])

  const items = useMemo(() => [...groups.pinned, ...groups.rest], [groups])

  /**
   * What the list actually shows, and which of the rows it would have shown
   * are hidden.
   *
   * The two are worked out together, and after the filter rather than before
   * it, because the footer's count is an offer to reveal *these* rows. A count
   * of hidden rows the current view would not show either way is an offer of
   * nothing — the reader clicks it and the list does not change.
   *
   * A reminder deliberately hides nothing. The reader asked to be told about
   * the row again, not to stop seeing it in the meantime.
   */
  const view = useMemo(() => {
    const shape = (group: SearchItem[]) =>
      sortItems(filterItems(group, filterText), sortOrder)
    const matched = [...shape(groups.pinned), ...shape(groups.rest)]

    const hiddenIds = new Set(
      features.hide
        ? matched.filter((item) => isHidden(memory[item.id])).map((item) => item.id)
        : [],
    )

    return {
      hiddenIds,
      items: showHidden ? matched : matched.filter((item) => !hiddenIds.has(item.id)),
    }
  }, [features.hide, filterText, groups, memory, showHidden, sortOrder])

  const { hiddenIds } = view
  const visibleItems = view.items

  /*
   * Revealing hidden rows is a look, not a setting. Left switched on after the
   * last hidden row came back, the next row the reader hid would stay on
   * screen — and a Hide that does not hide is worse than no Hide at all.
   */
  useEffect(() => {
    if (showHidden && hiddenIds.size === 0) setShowHidden(false)
  }, [hiddenIds.size, showHidden])

  // Which row, if any, is the page this tab is on. Matched on repository and
  // number rather than on the URL, because a pull request is still the same
  // pull request on its files or its checks.
  const currentId = useMemo(() => {
    if (!pageItem) return null
    const repository = pageItem.repository.toLowerCase()
    return (
      items.find(
        (item) =>
          item.number === pageItem.number &&
          item.repository.toLowerCase() === repository,
      )?.id ?? null
    )
  }, [items, pageItem])

  /**
   * Rows are seeded as seen the first time they are laid eyes on, so "changed"
   * means changed since the reader saw the row — not since the extension was
   * installed, which would mark everything at once and mean nothing.
   */
  useEffect(() => {
    if (!tracksChanges || items.length === 0) return
    const unseen = items.filter((item) => !memory[item.id])
    if (unseen.length > 0) markSeen(unseen)
  }, [items, markSeen, memory, tracksChanges])

  const currentItem = useMemo(
    () => items.find((item) => item.id === currentId) ?? null,
    [currentId, items],
  )

  // Reading the page is reading the row, so its marks clear themselves.
  useEffect(() => {
    if (!currentItem) return
    if (changesSince(memory[currentItem.id]?.seen, currentItem).length === 0) return
    markSeen([currentItem])
  }, [currentItem, markSeen, memory])

  /*
   * A reminder set for a time comes round while nothing else is happening, and
   * a panel that only redraws when GitHub answers would go on saying "waiting"
   * until the next poll. One timer, set for the soonest of them, is enough for
   * the mark to change itself the moment it should.
   */
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!features.reminders) return
    const due = nextReminderAt(memory)
    if (due === null) return

    const timer = setTimeout(
      () => setTick((count) => count + 1),
      Math.max(250, due - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [features.reminders, memory])

  const markAllSeen = useCallback(() => markSeen(items), [items, markSeen])
  const markItemSeen = useCallback((item: SearchItem) => markSeen([item]), [markSeen])

  const togglePin = useCallback(
    (item: SearchItem) => {
      setPinnedIds((current) =>
        current.includes(item.id)
          ? current.filter((id) => id !== item.id)
          : [...current, item.id],
      )
    },
    [setPinnedIds],
  )

  const openUrl = useCallback(
    (url: string, event: React.MouseEvent) => {
      // Modifier-click opens a tab whatever the setting says, matching normal
      // link behaviour.
      const target = event.metaKey || event.ctrlKey ? 'tab' : (settings?.openIn ?? 'tab')
      void sendMessage({ type: 'open-item', url, target })
    },
    [settings?.openIn],
  )

  const openItem = useCallback(
    (item: SearchItem, event: React.MouseEvent) => {
      // Opening a row is looking at it, whichever window it opens in.
      markSeen([item])
      openUrl(item.url, event)
    },
    [markSeen, openUrl],
  )

  // The worker broadcasts the refreshed row back to every tab, so there is
  // nothing to apply here; awaiting it only keeps the row's spinner honest.
  const refreshItem = useCallback(async (item: SearchItem) => {
    await sendMessage({
      type: 'refresh-item',
      repository: item.repository,
      number: item.number,
    })
  }, [])

  /**
   * Deliberately built from `fetchNextPage` rather than from the query object:
   * the query is a new object on every render, and a loader that changed
   * identity that often would re-run the list's prefetch effect on every
   * render — which, on a list short enough to be near its own end, is a
   * request for the next page on every render.
   */
  const fetchNextPage = search.fetchNextPage
  const loadMore = useCallback(() => {
    void fetchNextPage()
  }, [fetchNextPage])

  // An explicit refresh must bypass the cache, so drop the stored pages for
  // this query before refetching.
  const refetch = useCallback(() => {
    const query = activeQuery?.query
    void (async () => {
      if (query) await sendMessage({ type: 'invalidate', q: query })
      await search.refetch()
    })()
  }, [activeQuery?.query, search])

  const selectQuery = useCallback(
    (id: string) => {
      patchSettings({ activeQueryId: id })
      setEditing(false)
    },
    [patchSettings],
  )

  if (!settings || !savedQueries || !windowState || !pinnedIds || isOpen === null)
    return null

  // A floating window that is not showing leaves a launcher in the corner.
  // A docked one leaves its rail instead, which is where the panel itself
  // would have been.
  if (!isVisible && !isDocked) {
    return (
      <Hint label="Open GitHub Sidecar" side="left">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            'fixed bottom-5 right-5 z-[2147483646] flex size-10 items-center justify-center',
            'rounded-full border border-border bg-background text-foreground shadow-window',
            'transition-transform hover:scale-105 active:scale-95',
          )}
          aria-label="Open GitHub Sidecar"
        >
          <MarkGithubIcon className="size-4" />
        </button>
      </Hint>
    )
  }

  const lastFetchedAt = search.data?.pages[0]?.fetchedAt
  const totalCount = search.data?.pages[0]?.totalCount ?? 0

  // Collapsed, or never opened here, the dock is a rail. Rendered before
  // anything else so the list is not built just to sit behind it.
  if (isRail) {
    return (
      <DockRail
        top={dockTop}
        label={activeQuery?.name ?? 'GitHub Sidecar'}
        count={search.data ? totalCount : null}
        onExpand={() => {
          // One rail, two reasons to be showing it, and the click has to clear
          // both — otherwise expanding a hidden panel that was also left
          // collapsed just draws the same rail again.
          setOpen(true)
          if (isCollapsed) patchWindow({ collapsed: false })
        }}
      />
    )
  }

  // What the panel is showing right now, used as the key that replays the
  // pane's entrance. Deliberately blind to the contents of a list, so a poll
  // that only changes rows does not throw away the reader's scroll position.
  const viewKey = editing
    ? 'editor'
    : !hasToken
      ? 'token'
      : search.isError
        ? 'error'
        : search.isPending
          ? 'loading'
          : `${items.length === 0 ? 'empty' : 'list'}:${activeQuery?.id ?? ''}`

  const renderHeader = (onPointerDown: (event: React.PointerEvent) => void) => (
    <SidebarHeader
      onPointerDown={onPointerDown}
      windowState={windowState}
      queries={savedQueries}
      activeQuery={activeQuery}
      isFetching={search.isFetching}
      isRefreshing={isRefreshing}
      canRefresh={hasToken}
      onSelectQuery={selectQuery}
      onManageQueries={() => setEditing(true)}
      canFilter={features.filter}
      isFiltering={filtering}
      onToggleFilter={() => setFiltering((current) => !current)}
      canMarkAllSeen={tracksChanges && items.length > 0}
      onMarkAllSeen={markAllSeen}
      onRefresh={refetch}
      onPatchWindow={patchWindow}
      onToggleDock={toggleDock}
      onHide={() => setOpen(false)}
    />
  )

  /**
   * One key is handled for the whole panel rather than in the list: the filter
   * has to be reachable from wherever the reader's focus happens to be, which
   * on a freshly opened panel is nowhere in particular.
   */
  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (!features.filter || event.key !== '/' || filtering) return
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    event.preventDefault()
    setFiltering(true)
  }

  const body = (
    <div className="flex h-full flex-col" onKeyDown={onPanelKeyDown}>
      {/*
       * Sits outside the keyed pane below: an unreachable organisation is a
       * property of the answer, not of which screen is showing, so it must not
       * be replayed every time the query changes.
       */}
      {!editing && hasToken && !search.isError && warning && (
        <WarningBanner message={warning} />
      )}
      {/*
       * Also outside the keyed pane: what the reader has narrowed the list to
       * must survive a poll that changes the rows underneath it.
       */}
      {filtering && !editing && hasToken && !search.isError && (
        <FilterBar
          text={filterText}
          sort={sortOrder}
          matches={visibleItems.length}
          onTextChange={setFilterText}
          onSortChange={setSortOrder}
          onClose={() => {
            setFiltering(false)
            setFilterText('')
          }}
        />
      )}
      {/*
       * Keyed on what the panel is showing, so switching query or state
       * remounts the pane and replays its entrance rather than swapping one
       * screen of content for another between frames.
       */}
      <div key={viewKey} className="min-h-0 flex-1 animate-view-in">
        {editing ? (
          <QueryEditor
            queries={savedQueries}
            activeQueryId={activeQuery?.id ?? null}
            onChange={setSavedQueries}
            onSelect={(id) => patchSettings({ activeQueryId: id })}
            onDone={() => setEditing(false)}
          />
        ) : !hasToken ? (
          <TokenPrompt />
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={refetch} />
        ) : search.isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState onEdit={() => setEditing(true)} />
        ) : visibleItems.length === 0 ? (
          <FilteredOutState
            onClear={() => {
              setFilterText('')
              setShowHidden(true)
            }}
          />
        ) : (
          <ItemList
            items={visibleItems}
            pinnedIds={pinnedIds ?? []}
            currentId={currentId}
            memory={memory}
            hiddenIds={hiddenIds}
            features={features}
            reminderOverrides={reminderOverrides}
            /*
             * A filter narrows the rows already loaded, so it stops the list
             * pulling in more. Otherwise a filter that matches little enough
             * would page through the whole result set looking for matches
             * nobody asked it to fetch.
             */
            hasNextPage={search.hasNextPage && filterText.trim().length === 0}
            isFetchingNextPage={search.isFetchingNextPage}
            onLoadMore={loadMore}
            onOpen={openItem}
            onOpenUrl={openUrl}
            onRefreshItem={refreshItem}
            onTogglePin={togglePin}
            onMarkSeen={markItemSeen}
            onRemind={remind}
            onClearReminder={clearReminder}
            onHide={hide}
            onUnhide={unhide}
          />
        )}
      </div>

      {!editing && hasToken && (
        <footer className="flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border px-2.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-2">
            <span className="tabular-nums">
              {items.length > 0 ? `${visibleItems.length} of ${totalCount.toLocaleString()}` : '—'}
            </span>
            {/*
             * Hidden rows are still results, so the count says where they went
             * rather than quietly leaving them out of it — and is the way back
             * to them, since a row nobody can find again is a row lost.
             */}
            {features.hide && hiddenIds.size > 0 && (
              <button
                type="button"
                onClick={() => setShowHidden((current) => !current)}
                aria-pressed={showHidden}
                className="rounded px-1 tabular-nums underline-offset-2 hover:text-foreground hover:underline"
              >
                {showHidden ? 'hide' : 'show'} {hiddenIds.size} hidden
              </button>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            {settings.pollIntervalMs > 0 && (
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  isRefreshing ? 'animate-pulse bg-open' : 'bg-border',
                )}
                aria-hidden
              />
            )}
            {isRefreshing
              ? 'updating…'
              : lastFetchedAt
                ? `updated ${relativeTime(new Date(lastFetchedAt).toISOString())}`
                : 'idle'}
          </span>
        </footer>
      )}
    </div>
  )

  if (isDocked) {
    return (
      <DockedPanel
        width={clampDockWidth(windowState.dockWidth)}
        top={dockTop}
        onWidthChange={setDockWidth}
        header={renderHeader(noop)}
      >
        {body}
      </DockedPanel>
    )
  }

  return (
    <FloatingWindow
      state={windowState}
      onStateChange={patchWindow}
      header={({ onPointerDown }) => renderHeader(onPointerDown)}
    >
      {body}
    </FloatingWindow>
  )
}

function noop() {}

function TokenPrompt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <MarkGithubIcon className="size-7 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-[13px] font-semibold">Connect your GitHub account</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Add a personal access token to start tracking the issues and pull requests you
          care about.
        </p>
      </div>
      <Button size="sm" onClick={() => void sendMessage({ type: 'open-options' })}>
        Open settings
      </Button>
    </div>
  )
}

function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const message = error instanceof Error ? error.message : String(error)
  // A refused token is the one failure the reader cannot fix from here, so it
  // gets the settings page rather than a retry that will fail identically.
  const isAuth = error instanceof RequestError && error.kind === 'auth'

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {isAuth ? (
        <KeyIcon className="size-6 text-attention" />
      ) : (
        <AlertIcon className="size-6 text-attention" />
      )}
      <p className="text-[12px] leading-relaxed text-muted-foreground">{message}</p>
      <div className="flex items-center gap-2">
        {isAuth && (
          <Button size="sm" onClick={() => void sendMessage({ type: 'open-options' })}>
            Open settings
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onRetry}>
          <SyncIcon />
          Try again
        </Button>
      </div>
    </div>
  )
}

/**
 * A partial answer: GitHub returned rows *and* told us it was holding some
 * back. Sits above the list rather than replacing it, and is dismissible,
 * because a permanently unreachable organisation should not permanently cost
 * the reader a strip of the panel.
 */
function WarningBanner({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState(false)
  // A different cause is worth showing again even after the last was dismissed.
  useEffect(() => setDismissed(false), [message])
  if (dismissed) return null

  return (
    <div className="flex items-start gap-2 border-b border-attention/30 bg-attention/10 px-2.5 py-1.5">
      <AlertIcon className="mt-px size-3.5 shrink-0 text-attention" />
      <p className="flex-1 text-[11px] leading-snug text-foreground">{message}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss warning"
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

function EmptyState({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <InboxIcon className="size-6 text-muted-foreground" />
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Nothing matches this query right now.
      </p>
      <Button variant="outline" size="sm" onClick={onEdit}>
        <SlidersIcon />
        Edit query
      </Button>
    </div>
  )
}

/**
 * The query found rows; the reader's own filter, or a snooze, is what is
 * hiding them. Said apart from the empty state because the fix is different:
 * nothing here needs the query edited.
 */
function FilteredOutState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FilterIcon className="size-5 text-muted-foreground" />
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Every row is hidden, by the filter or by you.
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        Show them all
      </Button>
    </div>
  )
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

function LoadingState() {
  return (
    <div className="flex flex-col gap-4 p-3">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex gap-2.5">
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-[85%]" />
            <Skeleton className="h-2.5 w-[45%]" />
          </div>
        </div>
      ))}
    </div>
  )
}
