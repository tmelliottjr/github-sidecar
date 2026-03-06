import { useState } from 'react';
import { Check, X, Circle, AlertTriangle, MessageSquare, Loader, Pin, GitBranch } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { GitHubIssueItem, GitHubLabel, PRCheckSummary } from '../../types';
import { usePRCheckStatus } from '../hooks/usePRCheckStatus';
import { CommentsHovercard } from './CommentsHovercard';
import { Hovercard } from './Hovercard';

interface ItemCardProps {
  item: GitHubIssueItem;
  token?: string;
  isUnread?: boolean;
  isPinned?: boolean;
  onRead?: (item: GitHubIssueItem) => void;
  onTogglePin?: (url: string) => void;
}

const MAX_VISIBLE_LABELS = 2;

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">{children}</a>
  ),
};

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

function CIStatusBadge({ summary, isLoading, isError }: { summary?: PRCheckSummary; isLoading: boolean; isError: boolean }) {
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary opacity-60" title="Unable to load checks">
        <span>–</span>
        <span>Checks</span>
      </span>
    );
  }
  if (isLoading || !summary) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary" title="Loading checks…">
        <Loader size={10} className="animate-spin" />
      </span>
    );
  }

  const ciIcons: Record<string, React.ReactNode> = {
    success: <Check size={11} strokeWidth={2.5} />,
    failure: <X size={11} strokeWidth={2.5} />,
    pending: <Circle size={11} />,
  };

  const statusColors: Record<string, string> = {
    success: 'text-state-open',
    failure: 'text-state-closed',
    pending: 'text-warning',
  };

  const statusLabel: Record<string, string> = {
    success: `${summary.total}/${summary.total}`,
    failure: `${summary.failure} failed`,
    pending: `${summary.pending} pending`,
  };

  const hasConflict = summary.mergeable === false;

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
      {summary.status !== 'neutral' && (
        <span
          className={`inline-flex items-center gap-0.5 ${statusColors[summary.status] ?? ''} ${summary.status === 'pending' ? 'animate-pulse-opacity' : ''}`}
          title={`${summary.success} passed, ${summary.failure} failed, ${summary.pending} pending`}
        >
          {ciIcons[summary.status]}
          <span>{statusLabel[summary.status]}</span>
        </span>
      )}
      {hasConflict && (
        <>
          {summary.status !== 'neutral' && <span className="text-text-secondary opacity-40">·</span>}
          <span className="inline-flex items-center gap-0.5 text-warning" title="Has merge conflicts">
            <AlertTriangle size={10} />
            <span>Conflicts</span>
          </span>
        </>
      )}
    </span>
  );
}

function DiffStats({ additions, deletions, changedFiles }: { additions: number; deletions: number; changedFiles: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium">
      <span className="text-state-open">+{additions}</span>
      <span className="text-state-closed">−{deletions}</span>
      <span className="text-text-secondary opacity-40">·</span>
      <span className="text-text-secondary">{changedFiles} {changedFiles === 1 ? 'file' : 'files'}</span>
    </span>
  );
}

function CopyBranchButton({ branchName }: { branchName: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(branchName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-text-secondary transition-colors hover:text-text-primary bg-transparent border-none cursor-pointer p-0 min-w-0"
      title={copied ? 'Copied!' : `Copy branch: ${branchName}`}
    >
      {copied ? <Check size={11} className="text-state-open shrink-0" /> : <GitBranch size={11} className="shrink-0" />}
      <span className="text-[10px] font-mono truncate max-w-[120px]">{branchName}</span>
    </button>
  );
}

function BodyContent({ body }: { body: string }) {
  return (
    <>
      <div className="py-2 px-3 text-[11px] font-semibold text-text-secondary border-b border-border uppercase tracking-wide">
        Description
      </div>
      <div className="p-3 max-h-[300px] overflow-y-auto comment-markdown text-[12px] text-text-secondary leading-relaxed">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>{stripHtmlComments(body)}</Markdown>
      </div>
    </>
  );
}

export function ItemCard({ item, token, isUnread, isPinned, onRead, onTogglePin }: ItemCardProps) {
  const repo = repoFromUrl(item.repository_url);
  const { owner, repo: repoName } = parseRepo(item.repository_url);
  const isPR = !!item.pull_request;

  const { data: prSummary, isLoading: prLoading, isError: prError } = usePRCheckStatus(
    token ?? '', owner, repoName, item.number, isPR && !!token,
  );

  const handleLinkClick = () => {
    onRead?.(item);
  };

  const showPRDetails = isPR && !!token;

  return (
    <div
      className={`block py-3 px-3.5 border-b border-border no-underline text-inherit transition-colors relative group hover:bg-bg-secondary ${isPinned ? 'border-l-2 border-l-text-link' : ''}`}
    >
      {/* Unread indicator */}
      {isUnread && (
        <span className="absolute left-1 top-4 w-[7px] h-[7px] rounded-full bg-text-link" />
      )}

      {/* Row 1: Header — state icon, repo#number, time, pin */}
      <div className="flex items-center gap-[5px] text-[11px] text-text-secondary tracking-[0.01em]">
        <StateIcon item={item} />
        {item.body?.trim() ? (
          <Hovercard
            trigger={
              <a
                href={item.html_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-text-secondary no-underline rounded px-1 -mx-1 transition-all duration-150 cursor-pointer hover:text-text-primary hover:bg-bg-tertiary"
                onClick={handleLinkClick}
              >
                {repo}<span className="opacity-50 mx-px">#</span>{item.number}
              </a>
            }
            popoverWidth={480}
            showDelay={500}
            hideDelay={300}
            showClose
            className="p-0"
          >
            {() => (
              <BodyContent body={item.body!} />
            )}
          </Hovercard>
        ) : (
          <a
            href={item.html_url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-text-secondary no-underline rounded px-1 -mx-1 transition-all duration-150 hover:text-text-primary hover:bg-bg-tertiary"
            onClick={handleLinkClick}
          >
            {repo}<span className="opacity-50 mx-px">#</span>{item.number}
          </a>
        )}
        <span className="ml-auto text-[10px]">{timeAgo(item.updated_at)}</span>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin?.(item.html_url); }}
          className={`bg-transparent border-none cursor-pointer p-1 rounded transition-all hover:bg-bg-tertiary ${isPinned ? 'opacity-100 text-text-link' : 'opacity-0 group-hover:opacity-100 text-text-secondary hover:text-text-primary'}`}
          title={isPinned ? 'Unpin' : 'Pin to top'}
        >
          <Pin size={12} />
        </button>
      </div>

      {/* Row 2: Title */}
      <div className="text-[13px] font-semibold leading-snug mt-1 mb-1.5 break-words text-text-primary">{item.title}</div>

      {/* Row 3: Meta — avatar, comments, labels */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-secondary">
        <img src={item.user.avatar_url} alt={item.user.login} className="w-3.5 h-3.5 rounded-full shrink-0 shadow-[0_0_0_1px_rgba(0,0,0,0.1)]" title={item.user.login} />
        {item.comments > 0 && (
          token ? (
            <CommentsHovercard token={token} owner={owner} repo={repoName} issueNumber={item.number} commentCount={item.comments} />
          ) : (
            <span className="flex items-center gap-0.5"><MessageSquare size={11} /> {item.comments}</span>
          )
        )}
        {item.labels.length > 0 && <Labels labels={item.labels} />}
      </div>

      {/* Row 4: PR details bar (PR-only) */}
      {showPRDetails && (
        <div className="flex items-center gap-3 mt-2 text-[10px]">
          <CIStatusBadge summary={prSummary} isLoading={prLoading} isError={prError} />
          {prSummary && (
            <>
              <span className="text-border">|</span>
              <DiffStats additions={prSummary.additions} deletions={prSummary.deletions} changedFiles={prSummary.changedFiles} />
              <span className="ml-auto" />
              <CopyBranchButton branchName={prSummary.branchName} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
