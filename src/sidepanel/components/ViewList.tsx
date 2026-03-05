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

  // Infinite scroll: load more when near the end
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
    <div className="list-container">
      <div className="view-meta">
        <span className="result-count">{view.name} — {totalCount.toLocaleString()} {resultLabel}</span>
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="item-list" ref={parentRef}>
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
          <div className="loading-indicator">
            <div className="spinner" />
          </div>
        )}
        {!loading && items.length === 0 && !error && (
          <div className="empty-state">
            <p>No results</p>
            <button onClick={() => refresh()} className="btn btn-secondary">Refresh</button>
          </div>
        )}
      </div>
    </div>
  );
}
