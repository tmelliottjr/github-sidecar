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
      <div className="settings-authenticated">
        <div className="user-info">
          {avatarUrl && <img src={avatarUrl} alt={username} className="avatar" />}
          <span className="username">Signed in as <strong>{username}</strong></span>
        </div>
        <button onClick={onLogout} className="btn btn-danger">Sign Out</button>
      </div>
    );
  }

  return (
    <div className="settings-login">
      <div className="settings-header">
        <svg viewBox="0 0 16 16" width="48" height="48" className="github-logo">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <h2>GitHub Sidecar</h2>
        <p className="settings-description">
          Enter a <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">Personal Access Token</a> to get started.
          The token needs <code>repo</code> scope for private repos, or no scopes for public repos only.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="pat-form">
        <input
          type="password"
          value={pat}
          onChange={(e) => setPat(e.target.value)}
          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
          className="pat-input"
          autoComplete="off"
          disabled={saving || loading}
        />
        <button type="submit" className="btn btn-primary" disabled={!pat.trim() || saving || loading}>
          {saving || loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
      {error && <div className="error-message">{error}</div>}
    </div>
  );
}
