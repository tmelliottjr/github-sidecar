import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import { useGitHubSearch } from '../hooks/useGitHubSearch';
import { useReadState } from '../hooks/useReadState';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { ItemCard } from './ItemCard';
import { RepoQuickNav } from './RepoQuickNav';
import type { SavedView } from '../../types';

interface ViewListProps {
  token: string;
  username: string;
  view: SavedView;
  onAddRepo: () => void;
}

const ESTIMATED_ITEM_HEIGHT = 80;
const SESSION_KEY = 'scroll_state';

interface ScrollSnapshot {
  offset: number;
  measurements: VirtualItem[];
}

// Module-level scroll state cache keyed by view ID
const scrollState = new Map<string, ScrollSnapshot>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

// Hydrate from chrome.storage.session on module load
chrome.storage.session?.get(SESSION_KEY, (result) => {
  const stored = result[SESSION_KEY] as Record<string, ScrollSnapshot> | undefined;
  if (stored) {
    for (const [key, value] of Object.entries(stored)) {
      scrollState.set(key, value);
    }
  }
});

function saveScrollState(viewId: string, snapshot: ScrollSnapshot) {
  scrollState.set(viewId, snapshot);
  // Debounced persist to session storage
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.session?.set({
      [SESSION_KEY]: Object.fromEntries(scrollState),
    });
  }, 300);
}

export function ViewList({ token, username, view, onAddRepo }: ViewListProps) {
  const isReviews = view.id === '__reviews__';
  const { items, totalCount, loading, error, hasMore, loadMore, refresh } = useGitHubSearch(
    token,
    username,
    view.queryType,
    view.filters,
    { refetchInterval: isReviews ? 120_000 : undefined },
  );
  const parentRef = useRef<HTMLDivElement>(null);

  const { isUnread, unreadTooltip, markAsRead, trackItems } = useReadState();
  const { pinned, isPinned, togglePin } = usePinnedItems();

  // Auto-track newly seen items for unread detection
  useEffect(() => {
    if (items.length > 0) trackItems(items);
  }, [items, trackItems]);

  // Reorder: pinned items first
  const sortedItems = useMemo(() => {
    const pinnedSet = new Set(pinned);
    const pinnedItems = items.filter((item) => pinnedSet.has(item.html_url));
    const unpinnedItems = items.filter((item) => !pinnedSet.has(item.html_url));
    return [...pinnedItems, ...unpinnedItems];
  }, [items, pinned]);

  const saved = scrollState.get(view.id);

  const virtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    getItemKey: (index) => sortedItems[index]?.id ?? index,
    overscan: 5,
    initialOffset: saved?.offset ?? 0,
    initialMeasurementsCache: saved?.measurements ?? [],
    onChange: (instance) => {
      saveScrollState(view.id, {
        offset: instance.scrollOffset ?? 0,
        measurements: instance.measurementsCache,
      });
    },
  });

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || loading || !hasMore) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      loadMore();
    }
  }, [loading, hasMore, loadMore]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const resultLabel = totalCount === 1 ? 'result' : 'results';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between py-1.5 px-3.5 border-b border-border bg-bg-secondary">
        <span className="text-[11px] text-text-secondary">{view.name} — {totalCount.toLocaleString()} {resultLabel}</span>
        <RepoQuickNav onAddRepo={onAddRepo} />
      </div>
      {error && (
        <div className="bg-danger/10 text-danger border border-danger/30 rounded-md py-2 px-3 text-xs mx-3 my-2">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = sortedItems[virtualRow.index];
            return (
              <div
                key={item.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ItemCard
                  item={item}
                  token={token}
                  isUnread={isUnread(item)}
                  unreadTooltip={unreadTooltip(item)}
                  isPinned={isPinned(item.html_url)}
                  onRead={markAsRead}
                  onTogglePin={togglePin}
                />
              </div>
            );
          })}
        </div>
        {loading && (
          <div className="flex justify-center py-5">
            <div className="w-6 h-6 border-2 border-border border-t-text-link rounded-full animate-spin" />
          </div>
        )}
        {!loading && sortedItems.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-10 px-5 gap-3 text-text-secondary">
            <p>No results</p>
            <button
              onClick={() => refresh()}
              className="bg-bg-tertiary text-text-primary border border-border rounded-md px-4 py-1.5 text-[13px] font-medium cursor-pointer transition-colors hover:bg-border"
            >
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
