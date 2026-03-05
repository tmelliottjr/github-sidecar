import { useRef, useEffect, useState, useCallback } from 'react';
import { useGitHubSearch } from '../hooks/useGitHubSearch';
import { Filters } from './Filters';
import { ItemCard } from './ItemCard';
import type { FilterState } from '../../types';

interface IssueListProps {
  token: string;
  username: string;
}

export function IssueList({ token, username }: IssueListProps) {
  const [filters, setFilters] = useState<FilterState>({
    state: 'open',
    repo: '',
    sort: 'updated',
    order: 'desc',
  });

  const { items, totalCount, loading, error, hasMore, loadMore, refresh } = useGitHubSearch(token, username, 'issues', filters);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        loadMore();
      }
    },
    [hasMore, loading, loadMore],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handleObserver]);

  return (
    <div className="list-container">
      <Filters filters={filters} onChange={setFilters} tab="issues" totalCount={totalCount} />
      {error && <div className="error-message">{error}</div>}
      <div className="item-list">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
        {loading && (
          <div className="loading-indicator">
            <div className="spinner" />
          </div>
        )}
        {!loading && items.length === 0 && !error && (
          <div className="empty-state">
            <p>No issues found</p>
            <button onClick={() => refresh()} className="btn btn-secondary">Refresh</button>
          </div>
        )}
        <div ref={sentinelRef} className="scroll-sentinel" />
      </div>
    </div>
  );
}
