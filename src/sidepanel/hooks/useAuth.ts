import { useState, useEffect, useCallback } from 'react';
import type { GitHubUser } from '../../types';

const STORAGE_KEY = 'github_pat';

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] as string | undefined;
      if (stored) {
        setToken(stored);
        validateToken(stored);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const validateToken = useCallback(async (pat: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Invalid token' : `GitHub API error: ${res.status}`);
      }
      const data: GitHubUser = await res.json();
      setUser(data);
      setToken(pat);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate token');
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveToken = useCallback(async (pat: string) => {
    await chrome.storage.local.set({ [STORAGE_KEY]: pat });
    await validateToken(pat);
  }, [validateToken]);

  const logout = useCallback(async () => {
    await chrome.storage.local.remove(STORAGE_KEY);
    setToken(null);
    setUser(null);
    setError(null);
  }, []);

  return { token, user, loading, error, saveToken, logout, isAuthenticated: !!token && !!user };
}
