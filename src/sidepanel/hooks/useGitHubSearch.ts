import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { GitHubSearchResponse, FilterState, TabType } from '../../types';

const PER_PAGE = 30;

function buildQuery(tab: TabType, filters: FilterState, username: string): string {
  // If raw query is set, use it directly — user controls the full query
  if (filters.rawQuery?.trim()) {
    return filters.rawQuery.trim();
  }

  const parts: string[] = [];

  parts.push(tab === 'issues' ? 'is:issue' : 'is:pr');

  if (filters.state !== 'all') {
    parts.push(`is:${filters.state}`);
  }

  if (tab === 'issues') {
    parts.push(`assignee:${username}`);
  } else if (tab === 'reviews') {
    parts.push(`review-requested:${username}`);
  } else {
    parts.push(`author:${username}`);
  }

  if (filters.repo) {
    parts.push(`repo:${filters.repo}`);
  }

  return parts.join(' ');
}

// Exported so other hooks can derive the same query key
export function getSearchQueryKey(tab: TabType, filters: FilterState, username: string) {
  const q = buildQuery(tab, filters, username);
  return ['github-search', tab, q, filters.sort, filters.order] as const;
}

async function fetchSearchPage(
  token: string,
  query: string,
  sort: string,
  order: string,
  page: number,
  signal?: AbortSignal,
): Promise<GitHubSearchResponse> {
  const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&sort=${sort}&order=${order}&per_page=${PER_PAGE}&page=${page}&advanced_search=true`;

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

export function useGitHubSearch(
  token: string | null,
  username: string,
  tab: TabType,
  filters: FilterState,
  options?: { refetchInterval?: number },
) {
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
    staleTime: 60_000,
    refetchInterval: options?.refetchInterval,
    refetchOnWindowFocus: false,
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

/**
 * Lightweight hook that reads the totalCount from the reviews search cache.
 * Triggers a background fetch if stale, sharing data with the full list query.
 */
export function useReviewCount(token: string | null, username: string) {
  const filters: FilterState = { state: 'open', repo: '', sort: 'updated', order: 'desc' };
  const q = buildQuery('reviews', filters, username);
  const queryClient = useQueryClient();
  const queryKey = ['github-search', 'reviews', q, filters.sort, filters.order];

  // Try to read count from existing cache first
  const cached = queryClient.getQueryData<{ pages: GitHubSearchResponse[] }>(queryKey);
  const cachedCount = cached?.pages[0]?.total_count;

  // Run a lightweight first-page-only query that shares the same cache key structure
  const { data, isLoading } = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      return fetchSearchPage(token!, q, filters.sort, filters.order, pageParam, signal);
    },
    initialPageParam: 1,
    getNextPageParam: () => undefined, // Only fetch page 1 for the count
    enabled: !!token && !!username,
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  });

  const count = data?.pages[0]?.total_count ?? cachedCount ?? 0;

  return { count, isLoading };
}
