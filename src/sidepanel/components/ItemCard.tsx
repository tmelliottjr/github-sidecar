import type { GitHubIssueItem } from '../../types';

interface ItemCardProps {
  item: GitHubIssueItem;
}

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

export function ItemCard({ item }: ItemCardProps) {
  const repo = repoFromUrl(item.repository_url);

  return (
    <a href={item.html_url} target="_blank" rel="noreferrer" className="item-card">
      <div className="item-card-header">
        <StateIcon item={item} />
        <span className="item-repo">{repo}</span>
        <span className="item-number">#{item.number}</span>
      </div>
      <div className="item-title">{item.title}</div>
      <div className="item-meta">
        {item.labels.length > 0 && (
          <div className="item-labels">
            {item.labels.map((label) => (
              <span
                key={label.id}
                className="label-badge"
                style={{ backgroundColor: `#${label.color}`, color: getLabelTextColor(label.color) }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}
        <div className="item-info">
          <span>{timeAgo(item.updated_at)}</span>
          {item.comments > 0 && <span className="comment-count">💬 {item.comments}</span>}
        </div>
      </div>
    </a>
  );
}

function getLabelTextColor(bgColor: string): string {
  const r = parseInt(bgColor.slice(0, 2), 16);
  const g = parseInt(bgColor.slice(2, 4), 16);
  const b = parseInt(bgColor.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}
