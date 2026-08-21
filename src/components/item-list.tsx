import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDownIcon, SyncIcon } from '@primer/octicons-react'

import { CurrentRowMarker } from '@/components/current-row-marker'
import { ItemRow } from '@/components/item-row'
import {
  changesSince,
  reminderState,
  type ChangeKind,
  type ItemMemory,
  type ReminderChoice,
  type ReminderOverrides,
} from '@/lib/attention'
import type { SearchItem } from '@/lib/github/types'
import { collapseRows, type ListRow } from '@/lib/list-view'
import type { FeatureFlags } from '@/lib/storage'
import { cn } from '@/lib/utils'

interface Props {
  /** Headers and rows already flattened for the scroller, in draw order. */
  rows: ListRow[]
  pinnedIds: string[]
  /** The row for the page this tab is on, when the list holds it. */
  currentId: string | null
  /** What the reader has already seen, keyed by node id. */
  memory: Record<string, ItemMemory>
  /** Rows the reader has hidden; only present while hidden rows are showing. */
  hiddenIds: ReadonlySet<string>
  features: FeatureFlags
  /** Set in developer mode, where the named reminder times are seconds. */
  reminderOverrides: ReminderOverrides | null
  /** The groups the reader has folded away, keyed by their group key. */
  collapsed: ReadonlySet<string>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onToggleGroup: (groupKey: string) => void
  onOpen: (item: SearchItem, event: React.MouseEvent) => void
  onOpenUrl: (url: string, event: React.MouseEvent) => void
  onRefreshItem: (item: SearchItem) => Promise<void>
  onTogglePin: (item: SearchItem) => void
  onMarkSeen: (item: SearchItem) => void
  onRemind: (item: SearchItem, choice: ReminderChoice) => void
  onClearReminder: (item: SearchItem) => void
  onHide: (item: SearchItem) => void
  onUnhide: (item: SearchItem) => void
}

const ESTIMATED_ROW_HEIGHT = 78
/** Start fetching this many rows before the end so scrolling stays smooth. */
const PREFETCH_THRESHOLD = 6

const NO_IDS: ReadonlySet<string> = new Set()
const NO_CHANGES: ChangeKind[] = []

/**
 * How many frames the list is given to mount a row it has just scrolled to.
 * Only rows on screen exist, so moving to one that was not costs a render
 * before there is anything to put the focus on.
 */
const FOCUS_ATTEMPTS = 5

/** Adds an id to a set, or takes it out again. */
function toggled(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current)
  if (!next.delete(id)) next.add(id)
  return next
}

/** Keys typed into a field are the field's, whatever they would otherwise do. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  )
}

export function ItemList({
  rows,
  pinnedIds,
  currentId,
  memory,
  hiddenIds,
  features,
  reminderOverrides,
  collapsed,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onToggleGroup,
  onOpen,
  onOpenUrl,
  onRefreshItem,
  onTogglePin,
  onMarkSeen,
  onRemind,
  onClearReminder,
  onHide,
  onUnhide,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The element the marker is drawn against, held in state so the marker
  // re-places itself when the virtualiser mounts or drops that row.
  const [currentRow, setCurrentRow] = useState<HTMLElement | null>(null)
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds])
  // An opened stack is a way of reading the list, not a property of the row,
  // so it lives here and is forgotten when the panel closes.
  const [openStacks, setOpenStacks] = useState<ReadonlySet<string>>(() => new Set())

  const toggleStack = useCallback((item: SearchItem) => {
    setOpenStacks((current) => toggled(current, item.id))
  }, [])

  // Which rows have their failing checks open, held here for the same reason
  // an open stack is: it is a way of reading the list, not a property of a row.
  const [openChecks, setOpenChecks] = useState<ReadonlySet<string>>(() => new Set())

  const toggleChecks = useCallback((item: SearchItem) => {
    setOpenChecks((current) => toggled(current, item.id))
  }, [])

  // The rows actually drawn. A collapsed group keeps its header but drops the
  // rows beneath it, so they leave the virtual list rather than merely hiding
  // behind it — nothing under a folded section is measured, focused or paged.
  const visibleRows = useMemo(() => collapseRows(rows, collapsed), [rows, collapsed])

  // The rows that hold an item, by their position in `visibleRows`. Headers
  // sit between them, so keyboard movement steps through these rather than
  // every row, and a section title is never something the reader can land on.
  const itemIndices = useMemo(() => {
    const indices: number[] = []
    visibleRows.forEach((row, index) => {
      if (row.type === 'item') indices.push(index)
    })
    return indices
  }, [visibleRows])

  // A trailing row renders the loading indicator when more pages exist.
  const count = hasNextPage ? visibleRows.length + 1 : visibleRows.length

  // Rows that a refresh has just brought into the list announce themselves.
  // Rows merely scrolled back into view must not: the virtualiser mounts and
  // unmounts those constantly, and animating them would make the list twitch
  // under the scrollbar. The set is read during render so a row carries the
  // animation from its first paint, and only written afterwards.
  const seenIds = useRef<ReadonlySet<string> | null>(null)
  const entering = useMemo(() => {
    const previous = seenIds.current
    // The first list to arrive animates as one view, not as a hail of rows.
    if (!previous) return NO_IDS
    const fresh = new Set<string>()
    for (const row of visibleRows) {
      if (row.type === 'item' && !previous.has(row.item.id)) fresh.add(row.item.id)
    }
    return fresh
  }, [visibleRows])

  useEffect(() => {
    const ids = new Set<string>()
    for (const row of visibleRows) if (row.type === 'item') ids.add(row.item.id)
    seenIds.current = ids
  }, [visibleRows])

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    getItemKey: useCallback(
      (index: number) => visibleRows[index]?.key ?? `loader-${index}`,
      [visibleRows],
    ),
  })

  // Both refs measure; only the current row's also reports where it is.
  const measureCurrent = useCallback(
    (node: HTMLDivElement | null) => {
      virtualizer.measureElement(node)
      setCurrentRow(node)
    },
    [virtualizer],
  )

  /**
   * Keyboard focus is the browser's own, not a highlight of this list's
   * invention: moving to a row focuses that row's button, so Enter opens it
   * without any handler here, and a screen reader is told where it landed.
   */
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  useEffect(() => {
    if (activeIndex === null) return
    let frame = 0
    let attempts = 0

    const focus = () => {
      const row = scrollRef.current?.querySelector(`[data-index="${activeIndex}"] button`)
      if (row instanceof HTMLElement) {
        row.focus()
        return
      }
      if (attempts++ < FOCUS_ATTEMPTS) frame = requestAnimationFrame(focus)
    }

    focus()
    return () => cancelAnimationFrame(frame)
  }, [activeIndex])

  const move = useCallback(
    (delta: number) => {
      if (itemIndices.length === 0) return
      setActiveIndex((current) => {
        // Movement is measured in item rows, then mapped back to the row's
        // real position so the header sitting above it is scrolled into view
        // and the focus lands on the item, never on a section title.
        const ordinal = current === null ? -1 : itemIndices.indexOf(current)
        const nextOrdinal =
          ordinal < 0
            ? delta > 0
              ? 0
              : itemIndices.length - 1
            : Math.min(Math.max(ordinal + delta, 0), itemIndices.length - 1)
        const nextIndex = itemIndices[nextOrdinal]
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
        return nextIndex
      })
    },
    [itemIndices, virtualizer],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!features.keyboard || isTyping(event.target)) return
      const activeRow = activeIndex === null ? null : visibleRows[activeIndex]
      const active = activeRow?.type === 'item' ? activeRow.item : null

      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          return
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          return
        case 'o':
          if (!active) return
          event.preventDefault()
          onOpen(active, event as unknown as React.MouseEvent)
          return
        case 'p':
          if (!active) return
          event.preventDefault()
          onTogglePin(active)
          return
        case 'h': {
          if (!active || !features.hide) return
          event.preventDefault()
          if (hiddenIds.has(active.id)) onUnhide(active)
          else onHide(active)
          return
        }
        case 'r': {
          if (!active || !features.reminders) return
          event.preventDefault()
          // The one reminder worth a single key: the others are a choice, and
          // a choice belongs in the menu that lists them.
          onRemind(active, 'change')
          return
        }
        case 'Escape':
          if (activeIndex === null) return
          event.preventDefault()
          setActiveIndex(null)
          scrollRef.current?.focus()
      }
    },
    [
      activeIndex,
      features.hide,
      features.keyboard,
      features.reminders,
      hiddenIds,
      visibleRows,
      move,
      onHide,
      onOpen,
      onRemind,
      onTogglePin,
      onUnhide,
    ],
  )

  const virtualItems = virtualizer.getVirtualItems()
  const lastIndex = virtualItems.at(-1)?.index ?? 0

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    if (lastIndex >= visibleRows.length - PREFETCH_THRESHOLD) onLoadMore()
  }, [hasNextPage, isFetchingNextPage, visibleRows.length, lastIndex, onLoadMore])

  // `onLoadMore` above must keep its identity between renders, or the effect
  // re-runs on every one of them and a short list asks for the next page
  // without end. See the sidebar, which builds it from the query's own stable
  // `fetchNextPage`.

  return (
    <div
      ref={scrollRef}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      className="scrollbar-slim h-full overflow-y-auto overscroll-contain focus:outline-none"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualRow) => {
          const row = visibleRows[virtualRow.index]
          const item = row?.type === 'item' ? row.item : undefined
          const isCurrent = item?.id === currentId
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={isCurrent ? measureCurrent : virtualizer.measureElement}
              className={cn(
                'absolute left-0 top-0 w-full',
                row?.type !== 'header' && 'border-b border-border/60 last:border-b-0',
              )}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row?.type === 'header' ? (
                <GroupHeader
                  label={row.label}
                  count={row.count}
                  avatarUrl={row.avatarUrl}
                  isCollapsed={collapsed.has(row.groupKey)}
                  onToggle={() => onToggleGroup(row.groupKey)}
                />
              ) : (
                /*
                 * The entrance lives on an inner element: the wrapper's own
                 * transform is what places the row in the virtual list, and an
                 * animation of the same property would fight it.
                 */
                <div className={cn(item && entering.has(item.id) && 'animate-row-in')}>
                  {item ? (
                    <ItemRow
                      item={item}
                      isPinned={pinned.has(item.id)}
                      isCurrent={isCurrent}
                      isStackOpen={openStacks.has(item.id)}
                      // Worked out per rendered row rather than for the whole
                      // list: only the rows on screen are mounted, so this is
                      // the smaller of the two sums by a wide margin.
                      changes={
                        features.changes ? changesSince(memory[item.id]?.seen, item) : NO_CHANGES
                      }
                      seen={memory[item.id]?.seen}
                      reminder={
                        features.reminders ? reminderState(memory[item.id], item) : 'none'
                      }
                      reminderDetail={memory[item.id]?.reminder}
                      isHidden={hiddenIds.has(item.id)}
                      isChecksOpen={openChecks.has(item.id)}
                      canRemind={features.reminders}
                      reminderOverrides={reminderOverrides}
                      canHide={features.hide}
                      showFailingChecks={features.failingChecks}
                      showMergeState={features.mergeState}
                      onOpen={onOpen}
                      onOpenUrl={onOpenUrl}
                      onRefresh={onRefreshItem}
                      onTogglePin={onTogglePin}
                      onToggleStack={toggleStack}
                      onToggleChecks={toggleChecks}
                      onMarkSeen={onMarkSeen}
                      onRemind={onRemind}
                      onClearReminder={onClearReminder}
                      onHide={onHide}
                      onUnhide={onUnhide}
                    />
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-muted-foreground">
                      <SyncIcon className="size-3.5 animate-spin" />
                      Loading more
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <CurrentRowMarker row={currentRow} viewportRef={scrollRef} />
    </div>
  )
}

/**
 * A section title above the rows it groups, and the control that folds them
 * away. It sits in the scroll flow rather than sticking, since each row is
 * absolutely placed by the virtualiser and a sticky header among them would
 * have nothing to stick within. The count is how many rows the section holds,
 * so a folded group still says how much it stands for.
 */
function GroupHeader({
  label,
  count,
  avatarUrl,
  isCollapsed,
  onToggle,
}: {
  label: string
  count: number
  avatarUrl: string | null
  isCollapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
      aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${label}`}
      className={cn(
        'flex w-full items-center gap-1.5 border-b border-border bg-muted/40 px-2.5 py-1 text-left',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
      )}
    >
      <ChevronDownIcon
        className={cn(
          'size-3.5 shrink-0 text-muted-foreground transition-transform',
          isCollapsed && '-rotate-90',
        )}
        aria-hidden
      />
      {avatarUrl && (
        <img src={avatarUrl} alt="" className="size-4 shrink-0 rounded-full" />
      )}
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">{count}</span>
    </button>
  )
}
