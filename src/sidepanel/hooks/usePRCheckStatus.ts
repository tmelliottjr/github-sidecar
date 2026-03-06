import { useQuery } from '@tanstack/react-query';
import type { PRCheckSummary, GitHubCheckRun } from '../../types';

interface CheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

interface PRDetail {
  head: { sha: string; ref: string };
  mergeable: boolean | null;
  mergeable_state: string;
  additions: number;
  deletions: number;
  changed_files: number;
}

interface MergeQueueInfo {
  state: 'queued' | 'merging' | null;
  position: number | null;
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

async function fetchMergeQueueStatus(token: string, owner: string, repo: string, number: number, signal?: AbortSignal): Promise<MergeQueueInfo> {
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        mergeQueueEntry {
          state
          position
        }
      }
    }
  }`;

  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { owner, repo, number } }),
      signal,
    });
    if (!res.ok) return { state: null, position: null };
    const json = await res.json();
    const entry = json.data?.repository?.pullRequest?.mergeQueueEntry;
    if (!entry) return { state: null, position: null };
    const state = entry.state === 'MERGEABLE' ? 'merging' as const : 'queued' as const;
    return { state, position: entry.position ?? null };
  } catch {
    return { state: null, position: null };
  }
}

function summarizeChecks(checkRuns: GitHubCheckRun[], pr: PRDetail, mergeQueue: MergeQueueInfo): PRCheckSummary {
  if (checkRuns.length === 0) {
    return { total: 0, success: 0, failure: 0, pending: 0, status: 'neutral', mergeable: pr.mergeable, mergeQueueState: mergeQueue.state, mergeQueuePosition: mergeQueue.position, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, branchName: pr.head.ref };
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

  return { total: checkRuns.length, success, failure, pending, status, mergeable: pr.mergeable, mergeQueueState: mergeQueue.state, mergeQueuePosition: mergeQueue.position, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, branchName: pr.head.ref };
}

export function usePRCheckStatus(token: string, owner: string, repo: string, pullNumber: number, enabled: boolean) {
  return useQuery<PRCheckSummary>({
    queryKey: ['pr-checks', owner, repo, pullNumber],
    queryFn: async ({ signal }) => {
      const [pr, mergeQueue] = await Promise.all([
        fetchPRDetail(token, owner, repo, pullNumber, signal),
        fetchMergeQueueStatus(token, owner, repo, pullNumber, signal),
      ]);
      const data = await fetchCheckRuns(token, owner, repo, pr.head.sha, signal);
      return summarizeChecks(data.check_runs, pr, mergeQueue);
    },
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 90_000 : false,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
