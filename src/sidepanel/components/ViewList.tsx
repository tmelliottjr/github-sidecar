import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useGitHubSearch } from '../hooks/useGitHubSearch';
import { ItemCard } from './ItemCard';
import type { SavedView } from '../../types';

interface ViewListProps {
  token: string;
  username: string;
  view: SavedView;
}

const ESTIMATED_ITEM_HEIGHT = 80;

export function ViewList({ token, username, view }: ViewListProps) {
  const isReviews = view.id === '__reviews__';
  const { items, totalCount, loading, error, hasMore, loadMore, refresh } = useGitHubSearch(
    token,
    username,
    view.queryType,
    view.filters,
    { refetchInterval: isReviews ? 120_000 : undefined },
  );
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 5,
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
      <div className="py-1.5 px-3.5 border-b border-border bg-bg-secondary">
        <span className="text-[11px] text-text-secondary">{view.name} — {totalCount.toLocaleString()} {resultLabel}</span>
      </div>
      {error && (
        <div className="bg-danger/10 text-danger border border-danger/30 rounded-md py-2 px-3 text-xs mx-3 my-2">
          {error}
        </div>
      )}
      <div className="flex-1 overflow-y-auto" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];
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
                <ItemCard item={item} token={token} />
              </div>
            );
          })}
        </div>
        {loading && (
          <div className="flex justify-center py-5">
            <div className="w-6 h-6 border-2 border-border border-t-text-link rounded-full animate-spin" />
          </div>
        )}
        {!loading && items.length === 0 && !error && (
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
