import { useState } from 'react';

interface SettingsProps {
  onSave: (token: string) => Promise<void>;
  onLogout: () => void;
  isAuthenticated: boolean;
  username?: string;
  avatarUrl?: string;
  error: string | null;
  loading: boolean;
}

export function Settings({ onSave, onLogout, isAuthenticated, username, avatarUrl, error, loading }: SettingsProps) {
  const [pat, setPat] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pat.trim()) return;
    setSaving(true);
    await onSave(pat.trim());
    setSaving(false);
    setPat('');
  };

  if (isAuthenticated) {
    return (
      <div className="flex flex-col items-center py-10 px-5 gap-5">
        <div className="flex items-center gap-2.5">
          {avatarUrl && <img src={avatarUrl} alt={username} className="w-12 h-12 rounded-full" />}
          <span className="text-sm text-text-secondary">Signed in as <strong>{username}</strong></span>
        </div>
        <button
          onClick={onLogout}
          className="bg-transparent text-danger border border-danger rounded-md px-4 py-1.5 text-[13px] font-medium cursor-pointer transition-colors hover:bg-danger hover:text-white"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center py-10 px-5 gap-5">
      <div className="text-center">
        <svg viewBox="0 0 16 16" width="48" height="48" className="text-text-primary">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <h2 className="text-xl mt-3 mb-2">GitHub Sidecar</h2>
        <p className="text-text-secondary text-[13px] max-w-[300px]">
          Enter a <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer" className="text-text-link no-underline hover:underline">Personal Access Token</a> to get started.
          The token needs <code className="bg-bg-tertiary px-1.5 rounded text-xs">repo</code> scope for private repos, or no scopes for public repos only.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 w-full max-w-[320px]">
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          className="bg-bg-secondary border border-border rounded-md py-2 px-3 text-text-primary text-[13px] font-mono w-full focus:outline-none focus:border-text-link focus:ring-2 focus:ring-text-link/15 disabled:opacity-60"
          autoComplete="off"
          disabled={saving || loading}
        />
        <button
          type="submit"
          className="border-none rounded-md px-4 py-1.5 text-[13px] font-medium cursor-pointer bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          disabled={!pat.trim() || saving || loading}
        >
          {saving || loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
      {error && (
        <div className="bg-danger/10 text-danger border border-danger/30 rounded-md py-2 px-3 text-xs mx-3">
          {error}
        </div>
      )}
    </div>
  );
}
