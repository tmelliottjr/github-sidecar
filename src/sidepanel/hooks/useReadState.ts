import { useState, useEffect, useCallback, useRef } from 'react';
import type { GitHubIssueItem } from '../../types';

const STORAGE_KEY = 'read_state';

interface ItemSnapshot {
  updatedAt: string;
  comments: number;
  state: string;
}

type ReadStateMap = Record<string, ItemSnapshot | string>;

function toSnapshot(item: GitHubIssueItem): ItemSnapshot {
  return {
    updatedAt: item.updated_at,
    comments: item.comments,
    state: item.pull_request?.merged_at ? 'merged' : item.state,
  };
}

function getSnapshot(entry: ItemSnapshot | string | undefined): ItemSnapshot | null {
  if (!entry) return null;
  if (typeof entry === 'string') return { updatedAt: entry, comments: -1, state: '' };
  return entry;
}

export type UnreadReason = 'new_comments' | 'state_changed' | 'updated';

export function getUnreadReasons(item: GitHubIssueItem, snapshot: ItemSnapshot): UnreadReason[] {
  const reasons: UnreadReason[] = [];
  const currentState = item.pull_request?.merged_at ? 'merged' : item.state;

  if (snapshot.comments >= 0 && item.comments > snapshot.comments) {
    reasons.push('new_comments');
  }
  if (snapshot.state && currentState !== snapshot.state) {
    reasons.push('state_changed');
  }
  if (reasons.length === 0) {
    reasons.push('updated');
  }
  return reasons;
}

export function formatUnreadReasons(reasons: UnreadReason[], item: GitHubIssueItem, snapshot: ItemSnapshot): string {
  const parts: string[] = [];
  for (const reason of reasons) {
    switch (reason) {
      case 'new_comments': {
        const diff = item.comments - snapshot.comments;
        parts.push(`${diff} new comment${diff === 1 ? '' : 's'}`);
        break;
      }
      case 'state_changed': {
        const currentState = item.pull_request?.merged_at ? 'merged' : item.state;
        parts.push(`${currentState.charAt(0).toUpperCase() + currentState.slice(1)}`);
        break;
      }
      case 'updated':
        parts.push('Updated since last viewed');
        break;
    }
  }
  return parts.join(' · ');
}

export function useReadState() {
  const [readState, setReadState] = useState<ReadStateMap>({});
  const readStateRef = useRef(readState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] as ReadStateMap | undefined;
      if (stored) {
        setReadState(stored);
        readStateRef.current = stored;
      }
      setLoaded(true);
    });
  }, []);

  const persist = useCallback((updated: ReadStateMap) => {
    readStateRef.current = updated;
    setReadState(updated);
    chrome.storage.local.set({ [STORAGE_KEY]: updated });
  }, []);

  const isUnread = useCallback((item: GitHubIssueItem): boolean => {
    const snapshot = getSnapshot(readState[item.html_url]);
    if (!snapshot) return false;
    return item.updated_at > snapshot.updatedAt;
  }, [readState]);

  const unreadReasons = useCallback((item: GitHubIssueItem): UnreadReason[] => {
    const snapshot = getSnapshot(readState[item.html_url]);
    if (!snapshot || item.updated_at <= snapshot.updatedAt) return [];
    return getUnreadReasons(item, snapshot);
  }, [readState]);

  const unreadTooltip = useCallback((item: GitHubIssueItem): string => {
    const snapshot = getSnapshot(readState[item.html_url]);
    if (!snapshot || item.updated_at <= snapshot.updatedAt) return '';
    const reasons = getUnreadReasons(item, snapshot);
    return formatUnreadReasons(reasons, item, snapshot);
  }, [readState]);

  const markAsRead = useCallback((item: GitHubIssueItem) => {
    const updated = { ...readStateRef.current, [item.html_url]: toSnapshot(item) };
    persist(updated);
  }, [persist]);

  const trackItems = useCallback((items: GitHubIssueItem[]) => {
    const current = readStateRef.current;
    let changed = false;
    const updated = { ...current };
    for (const item of items) {
      if (!(item.html_url in updated)) {
        updated[item.html_url] = toSnapshot(item);
        changed = true;
      }
    }
    if (changed) persist(updated);
  }, [persist]);

  return { isUnread, unreadReasons, unreadTooltip, markAsRead, trackItems, loaded };
}
