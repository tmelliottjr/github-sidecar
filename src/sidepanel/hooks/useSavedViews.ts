import { useState, useEffect, useCallback } from 'react';
import type { SavedView, QueryType, FilterState } from '../../types';

const STORAGE_KEY = 'saved_views';

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] as SavedView[] | undefined;
      if (stored) setViews(stored.sort((a, b) => a.order - b.order));
      setLoaded(true);
    });
  }, []);

  const persist = useCallback((updated: SavedView[]) => {
    const sorted = updated.sort((a, b) => a.order - b.order);
    setViews(sorted);
    chrome.storage.local.set({ [STORAGE_KEY]: sorted });
  }, []);

  const addView = useCallback((name: string, queryType: QueryType, filters: FilterState): SavedView => {
    const newView: SavedView = {
      id: `sv_${Date.now()}`,
      name,
      queryType,
      filters: { ...filters },
      order: views.length,
    };
    persist([...views, newView]);
    return newView;
  }, [views, persist]);

  const updateView = useCallback((id: string, updates: Partial<Pick<SavedView, 'name' | 'queryType' | 'filters'>>) => {
    persist(views.map((v) => v.id === id ? { ...v, ...updates, filters: updates.filters ? { ...updates.filters } : v.filters } : v));
  }, [views, persist]);

  const deleteView = useCallback((id: string) => {
    const remaining = views.filter((v) => v.id !== id);
    // Re-index orders
    persist(remaining.map((v, i) => ({ ...v, order: i })));
  }, [views, persist]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    const updated = [...views];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    persist(updated.map((v, i) => ({ ...v, order: i })));
  }, [views, persist]);

  const moveUp = useCallback((id: string) => {
    const idx = views.findIndex((v) => v.id === id);
    if (idx > 0) reorder(idx, idx - 1);
  }, [views, reorder]);

  const moveDown = useCallback((id: string) => {
    const idx = views.findIndex((v) => v.id === id);
    if (idx < views.length - 1) reorder(idx, idx + 1);
  }, [views, reorder]);

  return { views, loaded, addView, updateView, deleteView, moveUp, moveDown };
}
