import { useState, useEffect, useCallback } from 'react';
import type { SavedRepository } from '../../types';

const STORAGE_KEY = 'saved_repos';

export function useSavedRepos() {
  const [repos, setRepos] = useState<SavedRepository[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] as SavedRepository[] | undefined;
      if (stored) setRepos(stored);
      setLoaded(true);
    });
  }, []);

  const persist = useCallback((updated: SavedRepository[]) => {
    setRepos(updated);
    chrome.storage.local.set({ [STORAGE_KEY]: updated });
  }, []);

  const addRepo = useCallback((repo: Omit<SavedRepository, 'id'>): SavedRepository => {
    const newRepo: SavedRepository = { ...repo, id: `sr_${Date.now()}` };
    persist([newRepo, ...repos]);
    return newRepo;
  }, [repos, persist]);

  const removeRepo = useCallback((id: string) => {
    persist(repos.filter((r) => r.id !== id));
  }, [repos, persist]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    const updated = [...repos];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    persist(updated);
  }, [repos, persist]);

  const hasRepo = useCallback((fullName: string) => {
    return repos.some((r) => r.fullName === fullName);
  }, [repos]);

  return { repos, loaded, addRepo, removeRepo, reorder, hasRepo };
}
