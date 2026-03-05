import { useState, useRef, useEffect } from 'react';
import { useAuth } from './hooks/useAuth';
import { useSavedViews } from './hooks/useSavedViews';
import { useReviewCount } from './hooks/useGitHubSearch';
import { Settings } from './components/Settings';
import { ViewList } from './components/ViewList';
import { ViewEditor } from './components/ViewEditor';
import type { SavedView, QueryType, FilterState } from '../types';

const MAX_VISIBLE_TABS = 3;

const REVIEWS_VIEW: SavedView = {
  id: '__reviews__',
  name: 'Reviews',
  queryType: 'reviews',
  filters: { state: 'open', repo: '', sort: 'updated', order: 'desc' },
  order: -1,
};

function WelcomeScreen({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="welcome-screen">
      <div className="welcome-icon">✦</div>
      <h2 className="welcome-title">Welcome to GitHub Sidecar</h2>
      <p className="welcome-text">
        Create your first view to get started. Views are saved filters
        that appear as tabs so you can quickly switch between them.
      </p>
      <button className="btn btn-primary welcome-btn" onClick={onCreate}>
        + Create your first view
      </button>
    </div>
  );
}

function TabBar({
  views,
  activeId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  reviewCount,
  onReviewsClick,
}: {
  views: SavedView[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (view: SavedView) => void;
  onDelete: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  reviewCount: number;
  onReviewsClick: () => void;
}) {
  const visibleTabs = views.slice(0, MAX_VISIBLE_TABS);
  const overflowTabs = views.slice(MAX_VISIBLE_TABS);
  const [showOverflow, setShowOverflow] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
      if (contextRef.current && !contextRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  };

  const viewForContext = contextMenu ? views.find((v) => v.id === contextMenu.id) : null;
  const contextIdx = viewForContext ? views.indexOf(viewForContext) : -1;

  return (
    <nav className="tab-bar">
      <div className="tab-bar-tabs">
        {visibleTabs.map((view) => (
          <button
            key={view.id}
            className={`tab ${activeId === view.id ? 'tab-active' : ''}`}
            onClick={() => onSelect(view.id)}
            onContextMenu={(e) => handleContextMenu(e, view.id)}
            title={view.name}
          >
            {view.name}
          </button>
        ))}

        {overflowTabs.length > 0 && (
          <div className="tab-overflow-wrapper" ref={overflowRef}>
            <button
              className={`tab tab-overflow-btn ${overflowTabs.some((v) => v.id === activeId) ? 'tab-active' : ''}`}
              onClick={() => setShowOverflow(!showOverflow)}
            >
              ⋯
            </button>
            {showOverflow && (
              <div className="tab-overflow-menu">
                {overflowTabs.map((view) => (
                  <button
                    key={view.id}
                    className={`tab-overflow-item ${activeId === view.id ? 'tab-overflow-item-active' : ''}`}
                    onClick={() => { onSelect(view.id); setShowOverflow(false); }}
                    onContextMenu={(e) => handleContextMenu(e, view.id)}
                  >
                    {view.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button className="tab tab-add" onClick={onCreate} title="Create new view">
          +
        </button>

        <button
          className={`tab tab-reviews ${activeId === REVIEWS_VIEW.id ? 'tab-active' : ''}`}
          onClick={onReviewsClick}
          title="Review requests"
        >
          Reviews
          {reviewCount > 0 && (
            <span className="review-badge">{reviewCount > 99 ? '99+' : reviewCount}</span>
          )}
        </button>
      </div>

      {contextMenu && viewForContext && (
        <div
          ref={contextRef}
          className="tab-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 160) }}
        >
          <button className="tab-ctx-item" onClick={() => { onEdit(viewForContext); setContextMenu(null); }}>
            ✎ Edit view
          </button>
          {contextIdx > 0 && (
            <button className="tab-ctx-item" onClick={() => { onMoveUp(viewForContext.id); setContextMenu(null); }}>
              ↑ Move left
            </button>
          )}
          {contextIdx < views.length - 1 && (
            <button className="tab-ctx-item" onClick={() => { onMoveDown(viewForContext.id); setContextMenu(null); }}>
              ↓ Move right
            </button>
          )}
          <button className="tab-ctx-item tab-ctx-danger" onClick={() => { onDelete(viewForContext.id); setContextMenu(null); }}>
            🗑 Delete view
          </button>
        </div>
      )}
    </nav>
  );
}

export function App() {
  const { token, user, loading, error, saveToken, logout, isAuthenticated } = useAuth();
  const { views, addView, updateView, deleteView, moveUp, moveDown } = useSavedViews();
  const { count: reviewCount } = useReviewCount(token, user?.login ?? '');
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editorState, setEditorState] = useState<{ open: boolean; view?: SavedView }>({ open: false });

  // Derive active view: use selected if valid, otherwise first view
  const activeViewId = (() => {
    if (selectedViewId === REVIEWS_VIEW.id) return REVIEWS_VIEW.id;
    if (selectedViewId && views.find((v) => v.id === selectedViewId)) return selectedViewId;
    return views.length > 0 ? views[0].id : null;
  })();

  const setActiveViewId = (id: string | null) => setSelectedViewId(id);

  if (!isAuthenticated || showSettings) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>GitHub Sidecar</h1>
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

  const activeView = activeViewId === REVIEWS_VIEW.id
    ? REVIEWS_VIEW
    : views.find((v) => v.id === activeViewId);

  const handleSave = (name: string, queryType: QueryType, filters: FilterState) => {
    if (editorState.view) {
      updateView(editorState.view.id, { name, queryType, filters });
    } else {
      const newView = addView(name, queryType, filters);
      setActiveViewId(newView.id);
    }
    setEditorState({ open: false });
  };

  const handleDelete = (id: string) => {
    deleteView(id);
  };

  return (
    <div className="app">
      <header className="app-header">
        <TabBar
          views={views}
          activeId={activeViewId}
          onSelect={setActiveViewId}
          onCreate={() => setEditorState({ open: true })}
          onEdit={(view) => setEditorState({ open: true, view })}
          onDelete={handleDelete}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          reviewCount={reviewCount}
          onReviewsClick={() => setActiveViewId(REVIEWS_VIEW.id)}
        />
        <button className="icon-btn settings-btn" onClick={() => setShowSettings(true)} title="Settings">
          <img src={user?.avatar_url} alt={user?.login} className="header-avatar" />
        </button>
      </header>

      <main className="app-main">
        {editorState.open && (
          <ViewEditor
            existingView={editorState.view}
            onSave={handleSave}
            onCancel={() => setEditorState({ open: false })}
            username={user!.login}
          />
        )}
        {!editorState.open && activeView ? (
          <ViewList token={token!} username={user!.login} view={activeView} />
        ) : !editorState.open && views.length === 0 && activeViewId !== REVIEWS_VIEW.id ? (
          <WelcomeScreen onCreate={() => setEditorState({ open: true })} />
        ) : null}
      </main>
    </div>
  );
}
