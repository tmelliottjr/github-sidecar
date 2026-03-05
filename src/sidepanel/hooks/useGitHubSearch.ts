import { useState, useCallback, useRef, useEffect } from 'react';
import type { GitHubIssueItem, GitHubSearchResponse, FilterState, TabType } from '../../types';

const PER_PAGE = 30;

function buildQuery(tab: TabType, filters: FilterState, username: string): string {
  const parts: string[] = [];

  parts.push(tab === 'issues' ? 'is:issue' : 'is:pr');

  if (filters.state !== 'all') {
    parts.push(`is:${filters.state}`);
  }

  if (tab === 'issues') {
    parts.push(`assignee:${username}`);
  } else {
    parts.push(`author:${username}`);
  }

  if (filters.repo) {
    parts.push(`repo:${filters.repo}`);
  }

  return parts.join(' ');
}

export function useGitHubSearch(token: string | null, username: string, tab: TabType, filters: FilterState) {
  const [items, setItems] = useState<GitHubIssueItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(async (pageNum: number, append: boolean) => {
    if (!token) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const q = buildQuery(tab, filters, username);
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=${filters.sort}&order=${filters.order}&per_page=${PER_PAGE}&page=${pageNum}`;

    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `GitHub API error: ${res.status}`);
      }

      const data: GitHubSearchResponse = await res.json();
      setTotalCount(data.total_count);
      setItems((prev) => append ? [...prev, ...data.items] : data.items);
      setHasMore(data.items.length === PER_PAGE && (append ? items.length + data.items.length : data.items.length) < data.total_count);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [token, tab, filters, username, items.length]);

  // Reset and fetch first page when filters/tab change
  useEffect(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    fetchPage(1, false);
  }, [token, tab, filters.state, filters.repo, filters.sort, filters.order, username]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchPage(nextPage, true);
  }, [loading, hasMore, page, fetchPage]);

  const refresh = useCallback(() => {
    setItems([]);
    setPage(1);
    setHasMore(true);
    fetchPage(1, false);
  }, [fetchPage]);

  return { items, totalCount, loading, error, hasMore, loadMore, refresh };
}
