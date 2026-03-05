export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
}

export interface GitHubIssueItem {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: GitHubUser;
  labels: GitHubLabel[];
  comments: number;
  pull_request?: {
    html_url: string;
    merged_at: string | null;
  };
  repository_url: string;
  draft?: boolean;
  body: string | null;
}

export interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubIssueItem[];
}

export type ItemState = 'open' | 'closed' | 'all';
export type SortOption = 'created' | 'updated' | 'comments';
export type SortOrder = 'asc' | 'desc';
export type TabType = 'issues' | 'prs';

export interface FilterState {
  state: ItemState;
  repo: string;
  sort: SortOption;
  order: SortOrder;
}
