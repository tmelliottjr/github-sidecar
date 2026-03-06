import { useState, useEffect, useCallback, useRef } from 'react';
import type { GitHubIssueItem } from '../../types';

const STORAGE_KEY = 'read_state';
type ReadStateMap = Record<string, string>;

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
    const lastSeen = readState[item.html_url];
    if (!lastSeen) return false;
    return item.updated_at > lastSeen;
  }, [readState]);

  const markAsRead = useCallback((item: GitHubIssueItem) => {
    const updated = { ...readStateRef.current, [item.html_url]: item.updated_at };
    persist(updated);
  }, [persist]);

  const trackItems = useCallback((items: GitHubIssueItem[]) => {
    const current = readStateRef.current;
    let changed = false;
    const updated = { ...current };
    for (const item of items) {
      if (!(item.html_url in updated)) {
        updated[item.html_url] = item.updated_at;
        changed = true;
      }
    }
    if (changed) persist(updated);
  }, [persist]);

  return { isUnread, markAsRead, trackItems, loaded };
}
