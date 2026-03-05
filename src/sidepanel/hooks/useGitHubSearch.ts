import { useInfiniteQuery } from '@tanstack/react-query';
import type { GitHubSearchResponse, FilterState, TabType } from '../../types';

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

async function fetchSearchPage(
  token: string,
  query: string,
  sort: string,
  order: string,
  page: number,
  signal?: AbortSignal,
): Promise<GitHubSearchResponse> {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${PER_PAGE}&page=${page}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API error: ${res.status}`);
  }

  return res.json();
}

export function useGitHubSearch(token: string | null, username: string, tab: TabType, filters: FilterState) {
  const q = buildQuery(tab, filters, username);

  const query = useInfiniteQuery({
    queryKey: ['github-search', tab, q, filters.sort, filters.order],
    queryFn: async ({ pageParam, signal }) => {
      return fetchSearchPage(token!, q, filters.sort, filters.order, pageParam, signal);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const totalFetched = allPages.reduce((sum, p) => sum + p.items.length, 0);
      if (lastPage.items.length < PER_PAGE || totalFetched >= lastPage.total_count) {
        return undefined;
      }
      return allPages.length + 1;
    },
    enabled: !!token,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const totalCount = query.data?.pages[0]?.total_count ?? 0;

  return {
    items,
    totalCount,
    loading: query.isLoading || query.isFetchingNextPage,
    error: query.error?.message ?? null,
    hasMore: query.hasNextPage,
    loadMore: query.fetchNextPage,
    refresh: query.refetch,
  };
}
