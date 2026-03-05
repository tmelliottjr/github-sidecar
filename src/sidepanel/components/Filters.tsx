import { useState, useEffect } from 'react';
import type { FilterState, ItemState, SortOption, SortOrder, TabType } from '../../types';

interface FiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  tab: TabType;
  totalCount: number;
}

export function Filters({ filters, onChange, tab, totalCount }: FiltersProps) {
  const [repoInput, setRepoInput] = useState(filters.repo);

  // Debounce repo filter
  useEffect(() => {
    const timer = setTimeout(() => {
      if (repoInput !== filters.repo) {
        onChange({ ...filters, repo: repoInput });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [repoInput]);

  // Sync if filters change externally
  useEffect(() => {
    setRepoInput(filters.repo);
  }, [filters.repo]);

  const update = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className="filters">
      <div className="filters-row">
        <select
          value={filters.state}
          onChange={(e) => update({ state: e.target.value as ItemState })}
          className="filter-select"
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>

        <input
          type="text"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          placeholder="owner/repo"
          className="filter-input"
        />

        <select
          value={filters.sort}
          onChange={(e) => update({ sort: e.target.value as SortOption })}
          className="filter-select"
        >
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="comments">Comments</option>
        </select>

        <button
          className="sort-order-btn"
          onClick={() => update({ order: filters.order === 'desc' ? 'asc' : 'desc' as SortOrder })}
          title={filters.order === 'desc' ? 'Newest first' : 'Oldest first'}
        >
          {filters.order === 'desc' ? '↓' : '↑'}
        </button>
      </div>
      <div className="filters-meta">
        <span className="result-count">{totalCount.toLocaleString()} {tab === 'issues' ? 'issues' : 'pull requests'}</span>
      </div>
    </div>
  );
}
