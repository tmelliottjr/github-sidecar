import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Loader2 } from 'lucide-react'

import { ItemRow } from '@/components/item-row'
import type { SearchItem } from '@/lib/github/types'
import { cn } from '@/lib/utils'

interface Props {
  items: SearchItem[]
  pinnedIds: string[]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onOpen: (item: SearchItem, event: React.MouseEvent) => void
  onOpenUrl: (url: string, event: React.MouseEvent) => void
  onRefreshItem: (item: SearchItem) => Promise<void>
  onTogglePin: (item: SearchItem) => void
}

const ESTIMATED_ROW_HEIGHT = 78
/** Start fetching this many rows before the end so scrolling stays smooth. */
const PREFETCH_THRESHOLD = 6

const NO_IDS: ReadonlySet<string> = new Set()

export function ItemList({
  items,
  pinnedIds,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onOpen,
  onOpenUrl,
  onRefreshItem,
  onTogglePin,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinned = useMemo(() => new Set(pinnedIds), [pinnedIds])
  // An opened stack is a way of reading the list, not a property of the row,
  // so it lives here and is forgotten when the panel closes.
  const [openStacks, setOpenStacks] = useState<ReadonlySet<string>>(() => new Set())

  const toggleStack = useCallback((item: SearchItem) => {
    setOpenStacks((current) => {
      const next = new Set(current)
      if (!next.delete(item.id)) next.add(item.id)
      return next
    })
  }, [])

  // A trailing row renders the loading indicator when more pages exist.
  const count = hasNextPage ? items.length + 1 : items.length

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
    for (const item of items) if (!previous.has(item.id)) fresh.add(item.id)
    return fresh
  }, [items])

  useEffect(() => {
    seenIds.current = new Set(items.map((item) => item.id))
  }, [items])

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    getItemKey: useCallback(
      (index: number) => items[index]?.id ?? `loader-${index}`,
      [items],
    ),
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastIndex = virtualItems.at(-1)?.index ?? 0

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    if (lastIndex >= items.length - PREFETCH_THRESHOLD) onLoadMore()
  }, [hasNextPage, isFetchingNextPage, items.length, lastIndex, onLoadMore])

  return (
    <div ref={scrollRef} className="scrollbar-slim h-full overflow-y-auto overscroll-contain">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full border-b border-border/60 last:border-b-0"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {/*
               * The entrance lives on an inner element: the wrapper's own
               * transform is what places the row in the virtual list, and an
               * animation of the same property would fight it.
               */}
              <div className={cn(item && entering.has(item.id) && 'animate-row-in')}>
                {item ? (
                  <ItemRow
                    item={item}
                    isPinned={pinned.has(item.id)}
                    isStackOpen={openStacks.has(item.id)}
                    onOpen={onOpen}
                    onOpenUrl={onOpenUrl}
                    onRefresh={onRefreshItem}
                    onTogglePin={onTogglePin}
                    onToggleStack={toggleStack}
                  />
                ) : (
                  <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
