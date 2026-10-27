import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

import { DockedPanel, clampDockWidth } from '@/components/docked-panel'
import { ItemList } from '@/components/item-list'
import { Launcher } from '@/components/launcher'
import { Morph, captureOrigin, type MorphOrigin } from '@/components/morph'
import { QueryEditor } from '@/components/query-editor'
import { SidebarHeader } from '@/components/sidebar-header'
import { Button } from '@/components/ui/button'
import { usePortalContainer } from '@/components/ui/portal-container'
import { Skeleton } from '@/components/ui/skeleton'
import { FilterBar, type GroupBy, type SortOrder } from '@/components/filter-bar'
import { useDockLayout } from '@/hooks/use-dock-layout'
import { useCurrentPageItem } from '@/hooks/use-current-page-item'
import { useDocumentVisible } from '@/hooks/use-document-visible'
import { useItemMemory } from '@/hooks/use-item-memory'
import { useIssueSearch } from '@/hooks/use-issue-search'
import { useRefreshActivity } from '@/hooks/use-refresh-activity'
import { useSearchUpdates } from '@/hooks/use-search-updates'
import { useStorageValue } from '@/hooks/use-storage-value'
import { useTabOpen } from '@/hooks/use-tab-open'
import { changesSince, isHidden, isWhole, nextReminderAt } from '@/lib/attention'
import { browser } from '@/lib/browser'
import type { SearchItem } from '@/lib/github/types'
import {
  FACETS,
  applyQuickFilter,
  buildRows,
  filterItems,
  groupKeysOf,
  isQuickFiltered,
  sortItems,
  type QuickFilter,
} from '@/lib/list-view'
import { sendMessage, RequestError } from '@/lib/messages'
import { DEFAULT_FEATURES, type SavedQuery, type Settings, type WindowState } from '@/lib/storage'
import { cn, relativeTime } from '@/lib/utils'

const PANEL_SELECTOR = '[role="complementary"]'
const NO_QUICK_FILTER: QuickFilter = {}
const LAUNCHER_SELECTOR = '[data-launcher-capsule]'

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
  const filterInputRef = useRef<HTMLInputElement>(null)
  const [filterText, setFilterText] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>({})
  const [sortOrder, setSortOrder] = useState<SortOrder>('default')
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
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

  const container = usePortalContainer()
  const [morph, setMorph] = useState<{ id: number; origin: MorphOrigin; target: string } | null>(
    null,
  )

  /**
   * Starts the launcher morphing into the panel, or the panel back into the
   * launcher. Call it before the state change that swaps them, while the one
   * on screen can still be measured.
   */
  const beginMorph = useCallback(
    (to: 'panel' | 'launcher') => {
      if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const from = container.querySelector(to === 'panel' ? LAUNCHER_SELECTOR : PANEL_SELECTOR)
      if (!(from instanceof HTMLElement)) return
      setMorph({
        id: Date.now(),
        origin: captureOrigin(from, to === 'panel'),
        target: to === 'panel' ? PANEL_SELECTOR : LAUNCHER_SELECTOR,
      })
    },
    [container],
  )

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

  const isVisible = isOpen ?? false
  const isCollapsed = windowState?.collapsed ?? false
  const showsLauncher = !isVisible || isCollapsed

  // The toolbar button shows and hides the panel in the tab it was clicked on.
  useEffect(() => {
    const listener = (message: { type?: string }) => {
      if (message?.type !== 'toggle-sidebar') return
      const next = !(isOpen ?? false)
      beginMorph(next ? 'panel' : 'launcher')
      setOpen(next)
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [beginMorph, isOpen, setOpen])

  const activeQuery = useMemo<SavedQuery | null>(() => {
    if (!savedQueries?.length) return null
    return (
      savedQueries.find((query) => query.id === settings?.activeQueryId) ?? savedQueries[0]
    )
  }, [savedQueries, settings?.activeQueryId])

  // Grouping belongs to the query it was chosen on, so each list keeps its own.
  const groupBy = activeQuery?.groupBy ?? 'none'
  const setGroupBy = useCallback(
    (next: GroupBy) => {
      const id = activeQuery?.id
      if (!id) return
      setSavedQueries((queries) =>
        queries.map((query) => (query.id === id ? { ...query, groupBy: next } : query)),
      )
    },
    [activeQuery?.id, setSavedQueries],
  )

  const hasToken = Boolean(settings?.token)
  const dockWidth = windowState?.dockWidth ?? 0

  // Measuring the host page is only worth doing while the panel is on screen.
  // The launcher sits over the page and takes no room from it.
  const dockTop = useDockLayout({
    enabled: !showsLauncher,
    width: dockWidth,
  })

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
    // cache the moment the user switches to it. A collapsed panel goes on
    // loading, since the launcher standing in for it shows the count.
    enabled: hasToken && isVisible && !editing && isTabVisible,
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

  /**
   * Rows whose second request never answered. Counted rather than named: the
   * reader cannot act on which rows they are, only on the fact that some marks
   * on screen are missing rather than absent.
   */
  const unreadable = useMemo(
    () =>
      (search.data?.pages ?? []).reduce(
        (total, page) =>
          total + page.items.filter((item) => item.enrichment === 'failed').length,
        0,
      ),
    [search.data],
  )

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

  // The merge-state switch hides merge marks on the rows, so it hides merge choices too.
  const facets = useMemo(
    () => (features.mergeState ? FACETS : FACETS.filter((facet) => facet !== 'merge')),
    [features.mergeState],
  )
  // With the filter switched off its bar is gone, so nothing it holds may narrow the list.
  const activeText = features.filter ? filterText : ''
  const activeFilter = useMemo<QuickFilter>(
    () =>
      !features.filter
        ? NO_QUICK_FILTER
        : features.mergeState
          ? quickFilter
          : { ...quickFilter, merge: [] },
    [features.filter, features.mergeState, quickFilter],
  )
  const isNarrowed = activeText.trim().length > 0 || isQuickFiltered(activeFilter)

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
      sortItems(applyQuickFilter(filterItems(group, activeText), activeFilter), sortOrder)
    const shapedPinned = shape(groups.pinned)
    const shapedRest = shape(groups.rest)
    const matched = [...shapedPinned, ...shapedRest]

    const hiddenIds = new Set(
      features.hide
        ? matched.filter((item) => isHidden(memory[item.id])).map((item) => item.id)
        : [],
    )

    const keep = (item: SearchItem) => showHidden || !hiddenIds.has(item.id)
    const visiblePinned = shapedPinned.filter(keep)
    const visibleRest = shapedRest.filter(keep)

    return {
      hiddenIds,
      // The unique rows on screen, for the footer's count and the empty check.
      // Grouping by assignee can draw a row more than once, so this is counted
      // apart from the flattened rows the list actually renders.
      items: [...visiblePinned, ...visibleRest],
      rows: buildRows(visiblePinned, visibleRest, groupBy),
    }
  }, [activeFilter, activeText, features.hide, groupBy, groups, memory, showHidden, sortOrder])

  /**
   * What the quick filter menu offers and counts: the rows the list can show
   * before anything narrows them, and those the typed text matches. Null while
   * the filter is switched off.
   */
  const quickFilterRows = useMemo(() => {
    if (!features.filter) return null
    const shown =
      features.hide && !showHidden ? items.filter((item) => !isHidden(memory[item.id])) : items
    return { shown, textMatches: filterItems(shown, filterText) }
  }, [features.filter, features.hide, filterText, items, memory, showHidden])

  const { hiddenIds } = view
  const visibleItems = view.items

  // Every group on screen, in header order, so folding "all" of them knows the
  // full set and can tell when there is nothing left unfolded.
  const groupKeys = useMemo(() => groupKeysOf(view.rows), [view.rows])

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (!next.delete(groupKey)) next.add(groupKey)
      return next
    })
  }, [])

  // Null when the list is flat: with no groups there is nothing to fold, and
  // the control has nothing to show. Otherwise, are they every one folded?
  const allGroupsCollapsed =
    groupKeys.length === 0 ? null : groupKeys.every((key) => collapsedGroups.has(key))

  const toggleAllGroups = useCallback(() => {
    setCollapsedGroups((current) => {
      const everyCollapsed = groupKeys.length > 0 && groupKeys.every((key) => current.has(key))
      return everyCollapsed ? new Set() : new Set(groupKeys)
    })
  }, [groupKeys])

  /*
   * A fold is a way of reading one list, not a lasting choice. Switching polls
   * swaps the groups underneath, so a key folded away in the old list would
   * silently fold a same-named group in the new one — start each poll open.
   */
  useEffect(() => {
    setCollapsedGroups(new Set())
  }, [activeQuery?.id, groupBy])

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
    // Only rows that are whole. Half a row seeded now is a row that reports
    // its own review and checks as news the moment they arrive, seconds later.
    const unseen = items.filter((item) => !memory[item.id] && isWhole(item))
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

  const lastFetchedAt = search.data?.pages[0]?.fetchedAt
  const freshness = isRefreshing
    ? 'updating…'
    : lastFetchedAt
      ? `updated ${relativeTime(new Date(lastFetchedAt).toISOString())}`
      : null
  const totalCount = search.data?.pages[0]?.totalCount ?? 0

  // Rendered before the panel, so the panel paints over it as it fades in.
  const shell = morph && (
    <Morph
      key={morph.id}
      origin={morph.origin}
      target={morph.target}
      onDone={() => setMorph(null)}
    />
  )

  // Rendered before anything else so the list is not built just to sit
  // behind the launcher.
  if (showsLauncher) {
    return (
      <>
        {shell}
        <Launcher
          side="left"
          title={activeQuery?.name ?? 'GitHub Sidecar'}
          count={search.data ? totalCount : null}
          compact={windowState.launcherCompact}
          onCompactChange={(launcherCompact) => patchWindow({ launcherCompact })}
          onOpen={() => {
            beginMorph('panel')
            // The launcher can stand for a hidden panel, a collapsed one, or
            // both, and one click has to clear both or it just redraws itself.
            setOpen(true)
            if (isCollapsed) patchWindow({ collapsed: false })
          }}
        />
      </>
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

  const header = (
    <SidebarHeader
      queries={savedQueries}
      activeQuery={activeQuery}
      isFetching={search.isFetching}
      count={search.data ? totalCount : null}
      isRefreshing={isRefreshing}
      canRefresh={hasToken}
      onSelectQuery={selectQuery}
      onManageQueries={() => setEditing(true)}
      canMarkAllSeen={tracksChanges && items.length > 0}
      canInspect={developer?.enabled ?? false}
      onMarkAllSeen={markAllSeen}
      onRefresh={refetch}
      onCollapse={() => {
        beginMorph('launcher')
        patchWindow({ collapsed: true })
      }}
      onHide={() => {
        beginMorph('launcher')
        setOpen(false)
      }}
    />
  )

  /**
   * One key is handled for the whole panel rather than in the list: the filter
   * has to be reachable from wherever the reader's focus happens to be, which
   * on a freshly opened panel is nowhere in particular.
   */
  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    // A `/` typed into a portaled menu bubbles here in React, but is not the panel's.
    if (!event.currentTarget.contains(event.target as Node)) return
    if (!features.filter || event.key !== '/') return
    const target = event.target
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return
    }
    event.preventDefault()
    filterInputRef.current?.focus()
    filterInputRef.current?.select()
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
       * The second request failing is a different thing from the search
       * failing, and says so: the rows are right, some of their marks are
       * simply not known. It clears itself on the next refresh that works.
       */}
      {!editing && hasToken && !search.isError && unreadable > 0 && (
        <WarningBanner
          message={`Review, checks and merge state could not be read for ${unreadable} ${
            unreadable === 1 ? 'row' : 'rows'
          }.`}
          action={
            developer?.enabled
              ? {
                  label: 'View log',
                  onClick: () =>
                    void sendMessage({ type: 'open-options', section: 'developer' }),
                }
              : undefined
          }
        />
      )}
      {/*
       * Also outside the keyed pane: what the reader has narrowed the list to
       * must survive a poll that changes the rows underneath it.
       */}
      {quickFilterRows && !editing && hasToken && !search.isError && (
        <FilterBar
          inputRef={filterInputRef}
          text={filterText}
          sort={sortOrder}
          group={groupBy}
          allGroupsCollapsed={allGroupsCollapsed}
          matches={visibleItems.length}
          quickFilter={activeFilter}
          facets={facets}
          rows={quickFilterRows.shown}
          textMatches={quickFilterRows.textMatches}
          onTextChange={setFilterText}
          onSortChange={setSortOrder}
          onGroupChange={setGroupBy}
          onToggleAllGroups={toggleAllGroups}
          onQuickFilterChange={setQuickFilter}
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
              setQuickFilter({})
              setShowHidden(true)
            }}
          />
        ) : (
          <ItemList
            rows={view.rows}
            pinnedIds={pinnedIds ?? []}
            currentId={currentId}
            memory={memory}
            hiddenIds={hiddenIds}
            features={features}
            reminderOverrides={reminderOverrides}
            collapsed={collapsedGroups}
            /*
             * A filter narrows the rows already loaded, so it stops the list
             * pulling in more. Otherwise a filter that matches little enough
             * would page through the whole result set looking for matches
             * nobody asked it to fetch.
             */
            hasNextPage={search.hasNextPage && !isNarrowed}
            isFetchingNextPage={search.isFetchingNextPage}
            onLoadMore={loadMore}
            onToggleGroup={toggleGroup}
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
        <footer className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-border/70 px-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {items.length > 0 && (
              <span className="tabular-nums">
                {visibleItems.length} of {totalCount.toLocaleString()}
              </span>
            )}
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
                className={cn(
                  'rounded-full bg-muted px-2 leading-5 tabular-nums transition-colors hover:text-foreground',
                  'aria-pressed:bg-accent aria-pressed:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                {showHidden ? 'hide' : 'show'} {hiddenIds.size} hidden
              </button>
            )}
          </span>
          {/* Says nothing rather than a placeholder until there is a result to date. */}
          {freshness && (
            <span className="flex items-center gap-1.5">
              {settings.pollIntervalMs > 0 && (
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    isRefreshing ? 'animate-pulse bg-open' : 'bg-muted-foreground/40',
                  )}
                  aria-hidden
                />
              )}
              {freshness}
            </span>
          )}
        </footer>
      )}
    </div>
  )

  return (
    <>
      {shell}
      <DockedPanel
        width={clampDockWidth(windowState.dockWidth)}
        top={dockTop}
        onWidthChange={setDockWidth}
        header={header}
      >
        {body}
      </DockedPanel>
    </>
  )
}

/** The icon, heading, text, and actions that stand in for the list when it has nothing to show. */
function StatePanel({
  icon,
  tone,
  title,
  children,
  actions,
}: {
  icon: React.ReactNode
  /** Classes for the disc behind the icon. */
  tone: string
  title: string
  children: React.ReactNode
  actions: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <span className={cn('flex size-10 items-center justify-center rounded-full', tone)}>
        {icon}
      </span>
      <p className="mt-1 text-[13px] font-semibold">{title}</p>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{children}</p>
      <div className="mt-1.5 flex items-center gap-2">{actions}</div>
    </div>
  )
}

function TokenPrompt() {
  return (
    <StatePanel
      icon={<MarkGithubIcon className="size-5" />}
      tone="bg-foreground text-background"
      title="Connect your GitHub account"
      actions={
        <Button
          size="sm"
          className="rounded-full"
          onClick={() => void sendMessage({ type: 'open-options' })}
        >
          Open settings
        </Button>
      }
    >
      Add a personal access token to start tracking the issues and pull requests you care
      about.
    </StatePanel>
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
    <StatePanel
      icon={isAuth ? <KeyIcon className="size-5" /> : <AlertIcon className="size-5" />}
      tone={isAuth ? 'bg-attention/15 text-attention' : 'bg-closed/12 text-closed'}
      title={isAuth ? 'GitHub didn’t accept the token' : 'Couldn’t load results'}
      actions={
        <>
          {isAuth && (
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => void sendMessage({ type: 'open-options' })}
            >
              Open settings
            </Button>
          )}
          <Button
            variant={isAuth ? 'outline' : 'default'}
            size="sm"
            className="rounded-full"
            onClick={onRetry}
          >
            <SyncIcon />
            Try again
          </Button>
        </>
      }
    >
      {message}
    </StatePanel>
  )
}

/**
 * A partial answer: GitHub returned rows *and* told us it was holding some
 * back. Sits above the list rather than replacing it, and is dismissible,
 * because a permanently unreachable organisation should not permanently cost
 * the reader a strip of the panel.
 */
function WarningBanner({
  message,
  action,
}: {
  message: string
  /** Offered where there is somewhere useful to go and look. */
  action?: { label: string; onClick: () => void }
}) {
  const [dismissed, setDismissed] = useState(false)
  // A different cause is worth showing again even after the last was dismissed.
  useEffect(() => setDismissed(false), [message])
  if (dismissed) return null

  return (
    <div className="mx-2 mt-2 flex shrink-0 items-start gap-2 rounded-lg bg-attention/12 py-1.5 pl-2.5 pr-1">
      <AlertIcon className="mt-px size-3.5 shrink-0 text-attention" />
      <p className="flex-1 text-[11px] leading-snug text-foreground">
        {message}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-1 font-semibold underline underline-offset-2 hover:text-attention"
          >
            {action.label}
          </button>
        )}
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss warning"
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

function EmptyState({ onEdit }: { onEdit: () => void }) {
  return (
    <StatePanel
      icon={<InboxIcon className="size-5" />}
      tone="bg-muted text-muted-foreground"
      title="All clear"
      actions={
        <Button variant="outline" size="sm" className="rounded-full" onClick={onEdit}>
          <SlidersIcon />
          Edit query
        </Button>
      }
    >
      Nothing matches this query right now.
    </StatePanel>
  )
}

/**
 * The query found rows; the reader's own filter, or a snooze, is what is
 * hiding them. Said apart from the empty state because the fix is different:
 * nothing here needs the query edited.
 */
function FilteredOutState({ onClear }: { onClear: () => void }) {
  return (
    <StatePanel
      icon={<FilterIcon className="size-5" />}
      tone="bg-muted text-muted-foreground"
      title="No rows to show"
      actions={
        <Button variant="outline" size="sm" className="rounded-full" onClick={onClear}>
          Show them all
        </Button>
      }
    >
      Every row is hidden, by the filter or by you.
    </StatePanel>
  )
}

const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

/** Placeholder rows in the shape of the real ones, so nothing jumps when they land. */
function LoadingState() {
  return (
    <div className="flex flex-col gap-0.5 p-1.5" aria-hidden>
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex gap-2.5 px-2.5 py-2">
          <Skeleton className="mt-0.5 size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-3 w-[78%] rounded-full" />
            <Skeleton className="h-2.5 w-[46%] rounded-full" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}
