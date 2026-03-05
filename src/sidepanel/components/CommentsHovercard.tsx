import { useState } from 'react';
import Markdown from 'react-markdown';
import { useIssueComments } from '../hooks/useIssueComments';
import { Hovercard } from './Hovercard';
import type { GitHubComment } from '../../types';

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

function CommentRow({ comment }: { comment: GitHubComment }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = comment.body.length > 140;
  const previewText = isLong ? comment.body.slice(0, 140) + '…' : comment.body;

  return (
    <div className="comment-row">
      <div
        className="comment-row-clickable"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isLong) setExpanded(!expanded);
        }}
        role={isLong ? 'button' : undefined}
      >
        <div className="comment-row-header">
          <img src={comment.user.avatar_url} alt="" className="comment-avatar" />
          <span className="comment-author">{comment.user.login}</span>
          <span className="comment-time">{timeAgo(comment.created_at)}</span>
          {isLong && (
            <span className={`comment-expand-icon ${expanded ? 'comment-expand-open' : ''}`}>›</span>
          )}
        </div>
        <div className={`comment-body ${expanded ? 'comment-body-expanded' : 'comment-body-collapsed'}`}>
          <Markdown>{expanded ? comment.body : previewText}</Markdown>
        </div>
      </div>
      {expanded && (
        <a
          href={comment.html_url}
          target="_blank"
          rel="noreferrer"
          className="comment-open-link"
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
    <div className="comments-loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="comment-skeleton">
          <div className="skeleton-header">
            <div className="skeleton-avatar" />
            <div className="skeleton-text" />
          </div>
          <div className="skeleton-body" />
        </div>
      ))}
    </div>
  );
}

export function CommentsHovercard({ token, owner, repo, issueNumber, commentCount }: CommentsHovercardProps) {
  return (
    <Hovercard
      trigger={<>💬 {commentCount}</>}
      popoverWidth={320}
      className="comments-popover"
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
      <div className="comments-popover-header">Latest comments</div>
      {isLoading ? (
        <LoadingSkeleton />
      ) : comments && comments.length > 0 ? (
        <div className="comments-list">
          {comments.map((c) => <CommentRow key={c.id} comment={c} />)}
        </div>
      ) : (
        <div className="comments-empty">No comments</div>
      )}
    </>
  );
}
