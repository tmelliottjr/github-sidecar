import { useQuery } from '@tanstack/react-query';
import type { GitHubComment } from '../../types';

async function fetchComments(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
  signal?: AbortSignal,
): Promise<GitHubComment[]> {
  // Fetch last page to get most recent comments
  // First get with sort desc to get latest
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=5&sort=created&direction=desc`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch comments: ${res.status}`);
  const comments: GitHubComment[] = await res.json();
  // API returns in desc order, reverse to show oldest-first in the hovercard
  return comments.reverse();
}

export function useIssueComments(token: string, owner: string, repo: string, issueNumber: number, enabled: boolean) {
  return useQuery<GitHubComment[]>({
    queryKey: ['issue-comments', owner, repo, issueNumber],
    queryFn: ({ signal }) => fetchComments(token, owner, repo, issueNumber, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
