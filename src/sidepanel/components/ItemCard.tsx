import { useState } from 'react';
import { Check, X, Circle, AlertTriangle, MessageSquare, Loader, Pin, GitBranch, Copy } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { GitHubIssueItem, GitHubLabel, PRCheckSummary } from '../../types';
import { usePRCheckStatus } from '../hooks/usePRCheckStatus';
import { CommentsHovercard } from './CommentsHovercard';
import { Hovercard } from './Hovercard';
import { Tooltip } from './Tooltip';

interface ItemCardProps {
  item: GitHubIssueItem;
  token?: string;
  isUnread?: boolean;
  unreadTooltip?: string;
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

function StateIcon({ item, mergeQueueState, mergeQueuePosition }: { item: GitHubIssueItem; mergeQueueState?: 'queued' | 'merging' | null; mergeQueuePosition?: number | null }) {
  const isPR = !!item.pull_request;
  const isMerged = isPR && item.pull_request?.merged_at;

  if (isPR) {
    if (mergeQueueState) {
      const tip = mergeQueueState === 'merging'
        ? 'Merge in progress'
        : `In merge queue${mergeQueuePosition != null ? ` · Position ${mergeQueuePosition + 1}` : ''}`;
      return <Tooltip content={tip}><img src="/icons/git-merge-queue-16.svg" alt="Queued" className="w-3.5 h-3.5 shrink-0 state-icon-queue" /></Tooltip>;
    }
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

function CIStatusBadge({ summary, isLoading, isError, htmlUrl }: { summary?: PRCheckSummary; isLoading: boolean; isError: boolean; htmlUrl: string }) {
  if (isError) {
    return (
      <Tooltip content="Unable to load checks">
        <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary opacity-60">
          <span>–</span>
          <span>Checks</span>
        </span>
      </Tooltip>
    );
  }
  if (isLoading || !summary) {
    return (
      <Tooltip content="Loading checks…">
        <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary">
          <Loader size={10} className="animate-spin" />
        </span>
      </Tooltip>
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
  const checksUrl = `${htmlUrl}/checks`;

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
      {summary.status !== 'neutral' && (
        <Tooltip content={`${summary.success} passed, ${summary.failure} failed, ${summary.pending} pending`}>
          <a
            href={checksUrl}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-0.5 no-underline transition-transform hover:scale-105 ${statusColors[summary.status] ?? ''} ${summary.status === 'pending' ? 'animate-pulse-opacity' : ''}`}
          >
            {ciIcons[summary.status]}
            <span>{statusLabel[summary.status]}</span>
          </a>
        </Tooltip>
      )}
      {hasConflict && (
        <>
          {summary.status !== 'neutral' && <span className="text-text-secondary opacity-40">·</span>}
          <Tooltip content="Has merge conflicts">
            <span className="inline-flex items-center gap-0.5 text-warning">
              <AlertTriangle size={10} />
              <span>Conflicts</span>
            </span>
          </Tooltip>
        </>
      )}
    </span>
  );
}

function DiffStats({ additions, deletions, changedFiles, htmlUrl }: { additions: number; deletions: number; changedFiles: number; htmlUrl: string }) {
  return (
    <Tooltip content="View changed files">
      <a
        href={`${htmlUrl}/files`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[10px] font-medium no-underline transition-transform hover:scale-105"
      >
      <span className="text-state-open">+{additions}</span>
      <span className="text-state-closed">−{deletions}</span>
      <span className="text-text-secondary opacity-40">·</span>
      <span className="text-text-secondary">{changedFiles} {changedFiles === 1 ? 'file' : 'files'}</span>
    </a>
    </Tooltip>
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
    <Tooltip content={copied ? 'Copied!' : `Copy branch: ${branchName}`}>
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1 text-text-secondary transition-colors hover:text-text-primary bg-transparent border-none cursor-pointer p-0 min-w-0"
      >
        {copied ? <Check size={11} className="text-state-open shrink-0" /> : <GitBranch size={11} className="shrink-0" />}
        <span className="text-[10px] font-mono truncate max-w-[120px]">{branchName}</span>
      </button>
    </Tooltip>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Tooltip content={copied ? 'Copied!' : 'Copy link'}>
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 bg-transparent border-none cursor-pointer p-0.5 rounded transition-all text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
      >
        {copied ? <Check size={11} className="text-state-open" /> : <Copy size={11} />}
      </button>
    </Tooltip>
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

export function ItemCard({ item, token, isUnread, unreadTooltip, isPinned, onRead, onTogglePin }: ItemCardProps) {
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
      {/* Row 1: Header — state icon, repo#number, time, pin */}
      <div className="flex items-center gap-[5px] text-[11px] text-text-secondary tracking-[0.01em]">
        {isUnread && (
          <Tooltip content={unreadTooltip || 'Updated since last viewed'}>
            <span className="w-[7px] h-[7px] rounded-full bg-text-link shrink-0 -ml-0.5" />
          </Tooltip>
        )}
        <StateIcon item={item} mergeQueueState={prSummary?.mergeQueueState} mergeQueuePosition={prSummary?.mergeQueuePosition} />
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
        <CopyLinkButton url={item.html_url} />
        <span className="ml-auto text-[10px]">{timeAgo(item.updated_at)}</span>
        <Tooltip content={isPinned ? 'Unpin' : 'Pin to top'}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onTogglePin?.(item.html_url); }}
            className={`bg-transparent border-none cursor-pointer p-1 rounded transition-all hover:bg-bg-tertiary ${isPinned ? 'opacity-100 text-text-link' : 'opacity-0 group-hover:opacity-100 text-text-secondary hover:text-text-primary'}`}
          >
            <Pin size={12} />
          </button>
        </Tooltip>
      </div>

      {/* Row 2: Avatar + Title */}
      <div className="flex items-start gap-1.5 mt-1 mb-1.5">
        <Tooltip content={item.user.login}>
          <img src={item.user.avatar_url} alt={item.user.login} className="w-4 h-4 rounded-full shrink-0 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] mt-px" />
        </Tooltip>
        <span className="text-[13px] font-semibold leading-snug break-words text-text-primary">{item.title}</span>
      </div>

      {/* Row 3: Meta — comments, labels */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-secondary">
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
          <CIStatusBadge summary={prSummary} isLoading={prLoading} isError={prError} htmlUrl={item.html_url} />
          {prSummary && (
            <>
              <span className="text-border">|</span>
              <DiffStats additions={prSummary.additions} deletions={prSummary.deletions} changedFiles={prSummary.changedFiles} htmlUrl={item.html_url} />
              <span className="ml-auto" />
              <CopyBranchButton branchName={prSummary.branchName} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
