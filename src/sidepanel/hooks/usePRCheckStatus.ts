import { useQuery } from '@tanstack/react-query';
import type { PRCheckSummary, GitHubCheckRun } from '../../types';

interface CheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

interface PRDetail {
  head: { sha: string };
  mergeable: boolean | null;
  mergeable_state: string;
}

async function fetchPRDetail(token: string, owner: string, repo: string, number: number, signal?: AbortSignal): Promise<PRDetail> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch PR: ${res.status}`);
  return res.json();
}

async function fetchCheckRuns(token: string, owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<CheckRunsResponse> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
    signal,
  });
  if (!res.ok) throw new Error(`Failed to fetch check runs: ${res.status}`);
  return res.json();
}

function summarizeChecks(checkRuns: GitHubCheckRun[], mergeable: boolean | null): PRCheckSummary {
  if (checkRuns.length === 0) {
    return { total: 0, success: 0, failure: 0, pending: 0, status: 'neutral', mergeable };
  }

  let success = 0;
  let failure = 0;
  let pending = 0;

  for (const run of checkRuns) {
    if (run.status !== 'completed') {
      pending++;
    } else if (run.conclusion === 'success' || run.conclusion === 'skipped' || run.conclusion === 'neutral') {
      success++;
    } else {
      failure++;
    }
  }

  let status: PRCheckSummary['status'];
  if (failure > 0) status = 'failure';
  else if (pending > 0) status = 'pending';
  else status = 'success';

  return { total: checkRuns.length, success, failure, pending, status, mergeable };
}

export function usePRCheckStatus(token: string, owner: string, repo: string, pullNumber: number, enabled: boolean) {
  return useQuery<PRCheckSummary>({
    queryKey: ['pr-checks', owner, repo, pullNumber],
    queryFn: async ({ signal }) => {
      const pr = await fetchPRDetail(token, owner, repo, pullNumber, signal);
      const data = await fetchCheckRuns(token, owner, repo, pr.head.sha, signal);
      return summarizeChecks(data.check_runs, pr.mergeable);
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 90_000 : false,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
