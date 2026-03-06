import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GitHubUserSearchResult } from '../../types';

interface UserSearchResponse {
  total_count: number;
  items: GitHubUserSearchResult[];
}

const EMPTY_USERS: GitHubUserSearchResult[] = [];

async function searchUsers(
  token: string,
  query: string,
  signal?: AbortSignal,
): Promise<GitHubUserSearchResult[]> {
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=8`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data: UserSearchResponse = await res.json();
  return data.items;
}

export function useUserSearch(token: string | null, query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const delay = query.trim() ? 300 : 0;
    timerRef.current = setTimeout(() => setDebouncedQuery(query.trim()), delay);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['user-search', debouncedQuery],
    queryFn: ({ signal }) => searchUsers(token!, debouncedQuery, signal),
    enabled: !!token && debouncedQuery.length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  return {
    results: data ?? EMPTY_USERS,
    isLoading: isLoading && debouncedQuery.length >= 2,
    error: error?.message ?? null,
    isDebouncing: query.trim() !== debouncedQuery && query.trim().length >= 2,
  };
}
