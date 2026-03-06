import { Check, X, Circle, AlertTriangle, MessageSquare, Loader } from 'lucide-react';
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
      return <img src="/icons/git-pull-request-closed-16.svg" alt="Merged" className="w-3.5 h-3.5 shrink-0 state-icon-merged" />;
    }
    if (item.draft) {
      return <img src="/icons/git-pull-request-draft-16.svg" alt="Draft" className="w-3.5 h-3.5 shrink-0 state-icon-draft" />;
    }
    if (item.state === 'closed') {
      return <img src="/icons/git-pull-request-closed-16.svg" alt="Closed" className="w-3.5 h-3.5 shrink-0 state-icon-closed" />;
    }
    return <img src="/icons/git-pull-request-16.svg" alt="Open" className="w-3.5 h-3.5 shrink-0 state-icon-open" />;
  }

  if (item.state === 'closed') {
    return <img src="/icons/issue-closed-16.svg" alt="Closed" className="w-3.5 h-3.5 shrink-0 state-icon-closed" />;
  }
  return <img src="/icons/issue-opened-16.svg" alt="Open" className="w-3.5 h-3.5 shrink-0 state-icon-open" />;
}

function getLabelColors(hexColor: string) {
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);
  const isDark = document.documentElement.classList.contains('dark');

  if (isDark) {
    const bg = `rgba(${r}, ${g}, ${b}, 0.15)`;
    const textR = Math.min(255, Math.round(r * 0.6 + 120));
    const textG = Math.min(255, Math.round(g * 0.6 + 120));
    const textB = Math.min(255, Math.round(b * 0.6 + 120));
    const text = `rgb(${textR}, ${textG}, ${textB})`;
    const border = `rgba(${r}, ${g}, ${b}, 0.35)`;
    return { bg, text, border };
  }

  // Light mode: lighter background, darker text/border for good contrast
  const bg = `rgba(${r}, ${g}, ${b}, 0.12)`;
  const textR = Math.max(0, Math.round(r * 0.45));
  const textG = Math.max(0, Math.round(g * 0.45));
  const textB = Math.max(0, Math.round(b * 0.45));
  const text = `rgb(${textR}, ${textG}, ${textB})`;
  const border = `rgba(${r}, ${g}, ${b}, 0.45)`;
  return { bg, text, border };
}

function LabelBadge({ label }: { label: GitHubLabel }) {
  const colors = getLabelColors(label.color);
  return (
    <span
      className="inline-block px-[7px] rounded-full text-[10px] font-semibold leading-[18px] whitespace-nowrap tracking-[0.01em] border"
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
    <div className="flex items-center flex-wrap gap-1">
      {visible.map((label) => (
        <LabelBadge key={label.id} label={label} />
      ))}
      {overflow.length > 0 && (
        <Hovercard
          trigger={
            <span
              className="inline-flex items-center justify-center px-[7px] rounded-full text-[10px] font-semibold leading-[18px] whitespace-nowrap bg-bg-tertiary text-text-secondary border border-border cursor-default transition-[background,color,border-color] hover:bg-border hover:text-text-primary hover:border-text-secondary"
              aria-label={`${overflow.length} more labels`}
            >
              +{overflow.length}
            </span>
          }
          popoverWidth={260}
          showDelay={300}
          hideDelay={200}
          className="p-2"
        >
          {() => (
            <div className="flex flex-wrap gap-1">
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
      <span className="inline-flex items-center gap-1 ml-auto">
        <span className="text-[11px] font-bold w-3 text-center text-text-secondary opacity-50" title="Unable to load checks">–</span>
        <span className="inline-block w-3" />
      </span>
    );
  }
  if (isLoading || !summary) {
    return (
      <span className="inline-flex items-center gap-1 ml-auto">
        <span className="text-[11px] font-bold w-3 text-center text-text-secondary opacity-50 animate-pulse-opacity" title="Loading checks…"><Loader size={11} className="animate-spin" /></span>
        <span className="inline-block w-3" />
      </span>
    );
  }

  const ciIcons: Record<string, React.ReactNode> = {
    success: <Check size={11} />,
    failure: <X size={11} />,
    pending: <Circle size={11} />,
  };

  const statusColors: Record<string, string> = {
    success: 'text-state-open',
    failure: 'text-state-closed',
    pending: 'text-warning animate-pulse-opacity',
  };

  const hasConflict = summary.mergeable === false;

  return (
    <span className="inline-flex items-center gap-1 ml-auto">
      {summary.status !== 'neutral' ? (
        <span
          className={`text-[11px] font-bold w-3 text-center ${statusColors[summary.status] ?? ''}`}
          title={`${summary.success} passed, ${summary.failure} failed, ${summary.pending} pending`}
        >
          {ciIcons[summary.status]}
        </span>
      ) : (
        <span className="inline-block w-3" />
      )}
      {hasConflict ? (
        <span className="text-[11px] font-bold w-3 text-center text-warning" title="Has merge conflicts"><AlertTriangle size={11} /></span>
      ) : (
        <span className="inline-block w-3" />
      )}
    </span>
  );
}

export function ItemCard({ item, token }: ItemCardProps) {
  const repo = repoFromUrl(item.repository_url);
  const { owner, repo: repoName } = parseRepo(item.repository_url);
  const isPR = !!item.pull_request;

  return (
    <div
      className="block py-3 px-3.5 border-b border-border no-underline text-inherit transition-colors relative hover:bg-bg-secondary"
    >
      <div className="flex items-center gap-[5px] text-[11px] text-text-secondary mb-[3px] tracking-[0.01em]">
        <StateIcon item={item} />
        <a
          href={item.html_url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-text-secondary no-underline rounded px-1 -mx-1 transition-all duration-150 hover:text-text-primary hover:bg-bg-tertiary"
        >
          {repo}<span className="opacity-50 mx-px">#</span>{item.number}
        </a>
        {isPR && token && <CIStatus token={token} owner={owner} repo={repoName} pullNumber={item.number} />}
      </div>
      <div className="text-[13px] font-semibold leading-snug mb-1.5 break-words text-text-primary">{item.title}</div>
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-secondary">
        <img src={item.user.avatar_url} alt={item.user.login} className="w-3.5 h-3.5 rounded-full shrink-0" title={item.user.login} />
        <span>{timeAgo(item.updated_at)}</span>
        {item.comments > 0 && (
          token ? (
            <CommentsHovercard token={token} owner={owner} repo={repoName} issueNumber={item.number} commentCount={item.comments} />
          ) : (
            <span className="flex items-center gap-0.5"><MessageSquare size={11} /> {item.comments}</span>
          )
        )}
        {item.labels.length > 0 && <Labels labels={item.labels} />}
      </div>
    </div>
  );
}
