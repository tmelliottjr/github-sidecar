import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GitHubRepoSearchResult } from '../../types';

interface RepoSearchResponse {
  total_count: number;
  items: GitHubRepoSearchResult[];
}

const EMPTY_REPOS: GitHubRepoSearchResult[] = [];

async function searchRepos(
  token: string,
  owner: string,
  query: string,
  signal?: AbortSignal,
): Promise<GitHubRepoSearchResult[]> {
  const q = query.trim()
    ? `${query} user:${owner}`
    : `user:${owner}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=10`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data: RepoSearchResponse = await res.json();
  return data.items;
}

export function useRepoSearch(token: string | null, owner: string, query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['repo-search', owner, debouncedQuery],
    queryFn: ({ signal }) => searchRepos(token!, owner, debouncedQuery, signal),
    enabled: !!token && !!owner,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  return {
    results: data ?? EMPTY_REPOS,
    isLoading: isLoading && !!owner,
    error: error?.message ?? null,
    isDebouncing: query.trim() !== debouncedQuery,
  };
}
