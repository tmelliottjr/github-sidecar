import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pinned_items';

export function usePinnedItems() {
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] as string[] | undefined;
      if (stored) setPinned(stored);
    });
  }, []);

  const persist = useCallback((updated: string[]) => {
    setPinned(updated);
    chrome.storage.local.set({ [STORAGE_KEY]: updated });
  }, []);

  const isPinned = useCallback((url: string) => pinned.includes(url), [pinned]);

  const togglePin = useCallback((url: string) => {
    if (pinned.includes(url)) {
      persist(pinned.filter((u) => u !== url));
    } else {
      persist([...pinned, url]);
    }
  }, [pinned, persist]);

  return { pinned, isPinned, togglePin };
}
