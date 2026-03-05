import { useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { Settings } from './components/Settings';
import { IssueList } from './components/IssueList';
import { PRList } from './components/PRList';
import type { TabType } from '../types';

export function App() {
  const { token, user, loading, error, saveToken, logout, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('issues');
  const [showSettings, setShowSettings] = useState(false);

  if (!isAuthenticated || showSettings) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>GH Sidecar</h1>
          {isAuthenticated && (
            <button className="icon-btn" onClick={() => setShowSettings(false)} title="Back">
              ←
            </button>
          )}
        </header>
        <Settings
          onSave={saveToken}
          onLogout={logout}
          isAuthenticated={isAuthenticated}
          username={user?.login}
          avatarUrl={user?.avatar_url}
          error={error}
          loading={loading}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <nav className="tabs">
          <button
            className={`tab ${activeTab === 'issues' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('issues')}
          >
            Issues
          </button>
          <button
            className={`tab ${activeTab === 'prs' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('prs')}
          >
            Pull Requests
          </button>
        </nav>
        <button className="icon-btn settings-btn" onClick={() => setShowSettings(true)} title="Settings">
          <img src={user?.avatar_url} alt={user?.login} className="header-avatar" />
        </button>
      </header>

      <main className="app-main">
        {activeTab === 'issues' ? (
          <IssueList token={token!} username={user!.login} />
        ) : (
          <PRList token={token!} username={user!.login} />
        )}
      </main>
    </div>
  );
}
