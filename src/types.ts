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

export interface GitHubComment {
  id: number;
  html_url: string;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
}

export interface PRCheckSummary {
  total: number;
  success: number;
  failure: number;
  pending: number;
  status: 'success' | 'failure' | 'pending' | 'neutral';
  mergeable: boolean | null;
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

export interface SavedView {
  id: string;
  name: string;
  queryType: QueryType;
  filters: FilterState;
  order: number;
}

export type QueryType = 'issues' | 'prs' | 'reviews';
export type ItemState = 'open' | 'closed' | 'all';
export type SortOption = 'created' | 'updated' | 'comments';
export type SortOrder = 'asc' | 'desc';
export type TabType = QueryType;

export interface FilterState {
  state: ItemState;
  repo: string;
  sort: SortOption;
  order: SortOrder;
  rawQuery?: string;
}

export interface SavedRepository {
  id: string;
  owner: string;
  repo: string;
  fullName: string;
  ownerAvatarUrl: string;
  description: string | null;
}

export interface GitHubUserSearchResult {
  login: string;
  avatar_url: string;
  type: 'User' | 'Organization';
}

export interface GitHubRepoSearchResult {
  full_name: string;
  name: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}
