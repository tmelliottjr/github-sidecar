import type { GitHubIssueItem, GitHubLabel } from '../../types';
import { usePRCheckStatus } from '../hooks/usePRCheckStatus';
import { CommentsHovercard } from './CommentsHovercard';
import { Hovercard } from './Hovercard';

interface ItemCardProps {
  item: GitHubIssueItem;
  token?: string;
}

const MAX_VISIBLE_LABELS = 2;

function repoFromUrl(url: string): string {
  const match = url.match(/repos\/(.+)/);
  return match ? match[1] : '';
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function StateIcon({ item }: { item: GitHubIssueItem }) {
  const isPR = !!item.pull_request;
  const isMerged = isPR && item.pull_request?.merged_at;

  if (isPR) {
    if (isMerged) {
      return <img src="/icons/git-pull-request-closed-16.svg" alt="Merged" className="state-icon state-merged" />;
    }
    if (item.draft) {
      return <img src="/icons/git-pull-request-draft-16.svg" alt="Draft" className="state-icon state-draft" />;
    }
    if (item.state === 'closed') {
      return <img src="/icons/git-pull-request-closed-16.svg" alt="Closed" className="state-icon state-closed" />;
    }
    return <img src="/icons/git-pull-request-16.svg" alt="Open" className="state-icon state-open" />;
  }

  if (item.state === 'closed') {
    return <img src="/icons/issue-closed-16.svg" alt="Closed" className="state-icon state-closed" />;
  }
  return <img src="/icons/issue-opened-16.svg" alt="Open" className="state-icon state-open" />;
}

function getLabelColors(hexColor: string) {
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);
  // Muted background at 15% opacity
  const bg = `rgba(${r}, ${g}, ${b}, 0.15)`;
  // Lighter tinted text for dark backgrounds
  const textR = Math.min(255, Math.round(r * 0.6 + 120));
  const textG = Math.min(255, Math.round(g * 0.6 + 120));
  const textB = Math.min(255, Math.round(b * 0.6 + 120));
  const text = `rgb(${textR}, ${textG}, ${textB})`;
  const border = `rgba(${r}, ${g}, ${b}, 0.3)`;
  return { bg, text, border };
}

function LabelBadge({ label }: { label: GitHubLabel }) {
  const colors = getLabelColors(label.color);
  return (
    <span
      className="label-badge"
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        borderColor: colors.border,
      }}
    >
      {label.name}
    </span>
  );
}

function Labels({ labels }: { labels: GitHubLabel[] }) {
  const visible = labels.slice(0, MAX_VISIBLE_LABELS);
  const overflow = labels.slice(MAX_VISIBLE_LABELS);

  return (
    <div className="item-labels">
      {visible.map((label) => (
        <LabelBadge key={label.id} label={label} />
      ))}
      {overflow.length > 0 && (
        <Hovercard
          trigger={
            <span className="label-overflow-count" aria-label={`${overflow.length} more labels`}>
              +{overflow.length}
            </span>
          }
          popoverWidth={260}
          showDelay={300}
          hideDelay={200}
          className="label-overflow-popover"
        >
          {() => (
            <div className="label-overflow-content">
              {overflow.map((label) => (
                <LabelBadge key={label.id} label={label} />
              ))}
            </div>
          )}
        </Hovercard>
      )}
    </div>
  );
}

function parseRepo(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.match(/repos\/([^/]+)\/([^/]+)/);
  return match ? { owner: match[1], repo: match[2] } : { owner: '', repo: '' };
}

function CIStatus({ token, owner, repo, pullNumber }: { token: string; owner: string; repo: string; pullNumber: number }) {
  const { data: summary, isLoading, isError } = usePRCheckStatus(token, owner, repo, pullNumber, !!owner && !!repo);

  if (isError) {
    return (
      <span className="pr-status-indicators">
        <span className="ci-status ci-status-neutral" title="Unable to load checks">–</span>
        <span className="merge-status-slot" />
      </span>
    );
  }
  if (isLoading || !summary) {
    return (
      <span className="pr-status-indicators">
        <span className="ci-status ci-status-loading" title="Loading checks…">●</span>
        <span className="merge-status-slot" />
      </span>
    );
  }

  const ciIcons: Record<string, string> = {
    success: '✓',
    failure: '✗',
    pending: '●',
  };

  const hasConflict = summary.mergeable === false;

  return (
    <span className="pr-status-indicators">
      {summary.status !== 'neutral' ? (
        <span className={`ci-status ci-status-${summary.status}`} title={`${summary.success} passed, ${summary.failure} failed, ${summary.pending} pending`}>
          {ciIcons[summary.status]}
        </span>
      ) : (
        <span className="ci-status-slot" />
      )}
      {hasConflict ? (
        <span className="merge-status merge-status-conflict" title="Has merge conflicts">⚠</span>
      ) : (
        <span className="merge-status-slot" />
      )}
    </span>
  );
}

export function ItemCard({ item, token }: ItemCardProps) {
  const repo = repoFromUrl(item.repository_url);
  const { owner, repo: repoName } = parseRepo(item.repository_url);
  const isPR = !!item.pull_request;

  return (
    <a href={item.html_url} target="_blank" rel="noreferrer" className="item-card">
      <div className="item-card-header">
        <StateIcon item={item} />
        <span className="item-repo">{repo}</span>
        <span className="item-number">#{item.number}</span>
        {isPR && token && <CIStatus token={token} owner={owner} repo={repoName} pullNumber={item.number} />}
      </div>
      <div className="item-title">{item.title}</div>
      <div className="item-meta">
        {item.labels.length > 0 && <Labels labels={item.labels} />}
        <div className="item-info">
          <img src={item.user.avatar_url} alt={item.user.login} className="item-author-avatar" title={item.user.login} />
          <span>{timeAgo(item.updated_at)}</span>
          {item.comments > 0 && (
            token ? (
              <CommentsHovercard token={token} owner={owner} repo={repoName} issueNumber={item.number} commentCount={item.comments} />
            ) : (
              <span className="comment-count">💬 {item.comments}</span>
            )
          )}
        </div>
      </div>
    </a>
  );
}
