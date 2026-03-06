import { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Sparkles, MoreHorizontal, Plus, Pencil, ArrowUp, ArrowDown, Trash2, ArrowLeft } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useSavedViews } from './hooks/useSavedViews';
import { useReviewCount } from './hooks/useGitHubSearch';
import { useTheme } from './hooks/useTheme';
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

function ThemeToggle({ resolvedTheme, onToggle }: { resolvedTheme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary transition-colors"
      title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {resolvedTheme === 'dark' ? (
        <Sun size={16} />
      ) : (
        <Moon size={16} />
      )}
    </button>
  );
}

function WelcomeScreen({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center h-full">
      <div className="text-[32px] mb-3 opacity-70"><Sparkles size={32} /></div>
      <h2 className="text-lg font-semibold text-text-primary mb-2">Welcome to GitHub Sidecar</h2>
      <p className="text-[13px] text-text-secondary max-w-[280px] leading-relaxed mb-5">
        Create your first view to get started. Views are saved filters
        that appear as tabs so you can quickly switch between them.
      </p>
      <button
        className="border-none rounded-md px-6 py-2.5 text-sm font-medium cursor-pointer bg-accent text-white hover:bg-accent-hover transition-colors"
        onClick={onCreate}
      >
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

  const tabBase = 'bg-transparent border-none text-text-secondary text-xs font-medium py-3 px-3 cursor-pointer border-b-2 border-b-transparent transition-[color,border-color] duration-150 whitespace-nowrap overflow-hidden text-ellipsis max-w-[120px] hover:text-text-primary';

  return (
    <nav className="flex items-center flex-1 min-w-0 relative">
      <div className="flex items-center min-w-0">
        {visibleTabs.map((view) => (
          <button
            key={view.id}
            className={`${tabBase} ${activeId === view.id ? 'text-text-primary border-b-[#f78166]' : ''}`}
            onClick={() => onSelect(view.id)}
            onContextMenu={(e) => handleContextMenu(e, view.id)}
            title={view.name}
          >
            {view.name}
          </button>
        ))}

        {overflowTabs.length > 0 && (
          <div className="relative shrink-0" ref={overflowRef}>
            <button
              className={`${tabBase} max-w-none text-base tracking-widest ${overflowTabs.some((v) => v.id === activeId) ? 'text-text-primary border-b-[#f78166]' : ''}`}
              onClick={() => setShowOverflow(!showOverflow)}
            >
              <MoreHorizontal size={14} />
            </button>
            {showOverflow && (
              <div className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.4)] z-[200] min-w-[140px] max-w-[220px] overflow-hidden animate-slide-in">
                {overflowTabs.map((view) => (
                  <button
                    key={view.id}
                    className={`block w-full bg-transparent border-none border-b border-b-border text-text-primary py-2 px-3 text-xs text-left cursor-pointer transition-colors duration-100 last:border-b-0 hover:bg-bg-tertiary ${activeId === view.id ? 'text-text-link' : ''}`}
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

        <button
          className={`${tabBase} max-w-none text-base shrink-0 hover:text-text-link`}
          onClick={onCreate}
          title="Create new view"
        >
          <Plus size={14} />
        </button>

        <button
          className={`${tabBase} max-w-none shrink-0 inline-flex items-center gap-[5px] ${activeId === REVIEWS_VIEW.id ? 'text-text-primary border-b-[#f78166]' : ''}`}
          onClick={onReviewsClick}
          title="Review requests"
        >
          Reviews
          {reviewCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-text-link text-white leading-none">
              {reviewCount > 99 ? '99+' : reviewCount}
            </span>
          )}
        </button>
      </div>

      {contextMenu && viewForContext && (
        <div
          ref={contextRef}
          className="bg-bg-secondary border border-border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.45)] z-[300] min-w-[150px] overflow-hidden animate-slide-in"
          style={{ position: 'fixed', top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 160) }}
        >
          <button className="flex items-center gap-1.5 w-full bg-transparent border-none border-b border-b-border text-text-primary py-2 px-3 text-xs text-left cursor-pointer transition-colors duration-100 last:border-b-0 hover:bg-bg-tertiary" onClick={() => { onEdit(viewForContext); setContextMenu(null); }}>
            <Pencil size={12} /> Edit view
          </button>
          {contextIdx > 0 && (
            <button className="flex items-center gap-1.5 w-full bg-transparent border-none border-b border-b-border text-text-primary py-2 px-3 text-xs text-left cursor-pointer transition-colors duration-100 last:border-b-0 hover:bg-bg-tertiary" onClick={() => { onMoveUp(viewForContext.id); setContextMenu(null); }}>
              <ArrowUp size={12} /> Move left
            </button>
          )}
          {contextIdx < views.length - 1 && (
            <button className="flex items-center gap-1.5 w-full bg-transparent border-none border-b border-b-border text-text-primary py-2 px-3 text-xs text-left cursor-pointer transition-colors duration-100 last:border-b-0 hover:bg-bg-tertiary" onClick={() => { onMoveDown(viewForContext.id); setContextMenu(null); }}>
              <ArrowDown size={12} /> Move right
            </button>
          )}
          <button className="flex items-center gap-1.5 w-full bg-transparent border-none border-b border-b-border text-text-primary py-2 px-3 text-xs text-left cursor-pointer transition-colors duration-100 last:border-b-0 hover:bg-bg-tertiary hover:text-danger" onClick={() => { onDelete(viewForContext.id); setContextMenu(null); }}>
            <Trash2 size={12} /> Delete view
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
  const { resolvedTheme, toggleTheme } = useTheme();
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editorState, setEditorState] = useState<{ open: boolean; view?: SavedView }>({ open: false });

  const activeViewId = (() => {
    if (selectedViewId === REVIEWS_VIEW.id) return REVIEWS_VIEW.id;
    if (selectedViewId && views.find((v) => v.id === selectedViewId)) return selectedViewId;
    return views.length > 0 ? views[0].id : null;
  })();

  const setActiveViewId = (id: string | null) => setSelectedViewId(id);

  if (!isAuthenticated || showSettings) {
    return (
      <div className="flex flex-col h-screen">
        <header className="flex items-center justify-between px-3 h-12 bg-bg-secondary border-b border-border shrink-0">
          <h1 className="text-sm font-semibold">GitHub Sidecar</h1>
          <div className="flex items-center gap-1">
            <ThemeToggle resolvedTheme={resolvedTheme} onToggle={toggleTheme} />
            {isAuthenticated && (
              <button
                className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary"
                onClick={() => setShowSettings(false)}
                title="Back"
              >
                <ArrowLeft size={16} />
              </button>
            )}
          </div>
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
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-3 h-12 bg-bg-secondary border-b border-border shrink-0">
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
        <div className="flex items-center gap-1">
          <ThemeToggle resolvedTheme={resolvedTheme} onToggle={toggleTheme} />
          <button
            className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <img src={user?.avatar_url} alt={user?.login} className="w-6 h-6 rounded-full" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden">
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
