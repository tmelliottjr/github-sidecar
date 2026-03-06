import { useState } from 'react';
import { MessageSquare, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useIssueComments } from '../hooks/useIssueComments';
import { Hovercard } from './Hovercard';
import { Tooltip } from './Tooltip';
import type { GitHubComment } from '../../types';

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer">{children}</a>
  ),
};

interface CommentsHovercardProps {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  commentCount: number;
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

function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function CommentRow({ comment }: { comment: GitHubComment }) {
  const [expanded, setExpanded] = useState(false);
  const cleaned = stripHtmlComments(comment.body);
  const isLong = cleaned.length > 140;
  const previewText = isLong ? cleaned.slice(0, 140) + '…' : cleaned;

  return (
    <div className="border-b border-border transition-colors last:border-b-0 hover:bg-bg-tertiary">
      <div
        className="py-2 px-3 cursor-pointer"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) return;
          e.preventDefault();
          e.stopPropagation();
          if (isLong) setExpanded(!expanded);
        }}
        role={isLong ? 'button' : undefined}
      >
        <div className="flex items-center gap-1.5 mb-[3px]">
          <img src={comment.user.avatar_url} alt="" className="w-4 h-4 rounded-full shrink-0" />
          <span className="text-[11px] font-semibold text-text-primary">{comment.user.login}</span>
          <span className="text-[10px] text-text-secondary ml-auto">{timeAgo(comment.created_at)}</span>
          <Tooltip content="Open on GitHub">
            <a
              href={comment.html_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-text-link no-underline hover:underline shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          </Tooltip>
          {isLong && (
            <span className={`text-xs text-text-secondary transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}><ChevronRight size={12} /></span>
          )}
        </div>
        <div className={`comment-markdown text-[11px] text-text-secondary leading-snug break-words ${expanded ? '' : 'max-h-10 overflow-hidden'}`}>
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>{expanded ? cleaned : previewText}</Markdown>
        </div>
      </div>
      {expanded && (
        <a
          href={comment.html_url}
          target="_blank"
          rel="noreferrer"
          className="block px-3 pt-1 pb-2 text-[10px] text-text-link no-underline hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Open on GitHub ↗
        </a>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="py-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="py-2 px-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-4 h-4 rounded-full bg-bg-tertiary animate-skeleton" />
            <div className="w-20 h-2.5 rounded bg-bg-tertiary animate-skeleton" />
          </div>
          <div className="w-full h-2.5 rounded bg-bg-tertiary animate-skeleton" />
        </div>
      ))}
    </div>
  );
}

export function CommentsHovercard({ token, owner, repo, issueNumber, commentCount }: CommentsHovercardProps) {
  return (
    <Hovercard
      trigger={<><MessageSquare size={11} /> {commentCount}</>}
      popoverWidth={480}
      showClose
    >
      {({ hovered }) => (
        <CommentsContent token={token} owner={owner} repo={repo} issueNumber={issueNumber} enabled={hovered} />
      )}
    </Hovercard>
  );
}

function CommentsContent({ token, owner, repo, issueNumber, enabled }: {
  token: string; owner: string; repo: string; issueNumber: number; enabled: boolean;
}) {
  const { data: comments, isLoading } = useIssueComments(token, owner, repo, issueNumber, enabled);

  return (
    <>
      <div className="py-2 px-3 text-[11px] font-semibold text-text-secondary border-b border-border uppercase tracking-wide">
        Latest comments
      </div>
      {isLoading ? (
        <LoadingSkeleton />
      ) : comments && comments.length > 0 ? (
        <div className="max-h-[300px] overflow-y-auto">
          {comments.map((c) => <CommentRow key={c.id} comment={c} />)}
        </div>
      ) : (
        <div className="py-4 px-3 text-center text-text-secondary text-[11px]">No comments</div>
      )}
    </>
  );
}
