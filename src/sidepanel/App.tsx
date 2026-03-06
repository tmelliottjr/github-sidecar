import { useState, useRef, useEffect } from 'react';
import { Sun, Moon, Sparkles, MoreHorizontal, Plus, Pencil, ArrowUp, ArrowDown, Trash2, ArrowLeft, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, type MotionProps } from 'motion/react';
import { useAuth } from './hooks/useAuth';
import { useSavedViews } from './hooks/useSavedViews';
import { useReviewCount } from './hooks/useGitHubSearch';
import { useTheme } from './hooks/useTheme';
import { Settings } from './components/Settings';
import { ViewList } from './components/ViewList';
import { ViewEditor } from './components/ViewEditor';
import { SavedRepos } from './components/SavedRepos';
import { Tooltip } from './components/Tooltip';
import type { SavedView, QueryType, FilterState } from '../types';

const MAX_VISIBLE_TABS = 3;

const dropdownMotion: MotionProps = {
  initial: { opacity: 0, y: -4, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.97 },
  transition: { duration: 0.12, ease: 'easeOut' },
};

const REVIEWS_VIEW: SavedView = {
  id: '__reviews__',
  name: 'Reviews',
  queryType: 'reviews',
  filters: { state: 'open', repo: '', sort: 'updated', order: 'desc' },
  order: -1,
};

function ThemeToggle({ resolvedTheme, onToggle }: { resolvedTheme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <Tooltip content={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}>
      <button
        onClick={onToggle}
        className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary transition-colors"
      >
        {resolvedTheme === 'dark' ? (
          <Sun size={16} />
        ) : (
          <Moon size={16} />
        )}
      </button>
    </Tooltip>
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

  const tabBase = 'relative bg-transparent border-0 border-solid border-b-2 border-b-transparent text-text-secondary text-xs font-medium px-3 cursor-pointer transition-colors duration-150 whitespace-nowrap self-stretch flex items-center hover:text-text-primary';
  const tabTextActive = 'text-text-primary';

  const truncate = (name: string, max = 20) => name.length > max ? name.slice(0, max) + '…' : name;
  const activeOverflow = overflowTabs.find((v) => v.id === activeId);

  const activeIndicator = (
    <motion.div
      layoutId="tab-indicator"
      className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#f78166]"
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    />
  );

  return (
    <nav className="flex items-stretch flex-1 min-w-0 relative h-full">
      <div className="flex items-stretch min-w-0">
        {visibleTabs.map((view) => (
          <Tooltip content={view.name} key={view.id}>
            <button
              className={`${tabBase} ${activeId === view.id ? tabTextActive : ''}`}
              onClick={() => onSelect(view.id)}
              onContextMenu={(e) => handleContextMenu(e, view.id)}
            >
              {truncate(view.name)}
              {activeId === view.id && activeIndicator}
            </button>
          </Tooltip>
        ))}

        {overflowTabs.length > 0 && (
          <div className="relative shrink-0 self-stretch flex items-stretch" ref={overflowRef}>
            <button
              className={`${tabBase} gap-1 ${activeOverflow ? tabTextActive : ''}`}
              onClick={() => setShowOverflow(!showOverflow)}
            >
              {activeOverflow ? (
                <>
                  {truncate(activeOverflow.name, 16)}
                  <motion.span animate={{ rotate: showOverflow ? 180 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronDown size={12} />
                  </motion.span>
                </>
              ) : (
                <>
                  <MoreHorizontal size={14} />
                  <motion.span animate={{ rotate: showOverflow ? 180 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronDown size={10} />
                  </motion.span>
                </>
              )}
              {activeOverflow && activeIndicator}
            </button>
            <AnimatePresence>
              {showOverflow && (
                <motion.div
                  {...dropdownMotion}
                  className="absolute top-[calc(100%+2px)] right-0 bg-bg-secondary border border-border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.4)] z-[200] min-w-[140px] max-w-[220px] overflow-hidden"
                >
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <Tooltip content="Create new view">
          <button
            className={`${tabBase} max-w-none text-base shrink-0 hover:text-text-link`}
            onClick={onCreate}
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

      <Tooltip content="Review requests" className="ml-auto">
        <button
          className={`${tabBase} max-w-none shrink-0 inline-flex items-center gap-[5px] ${activeId === REVIEWS_VIEW.id ? tabTextActive : ''}`}
          onClick={onReviewsClick}
        >
          Reviews
          {reviewCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold bg-text-link text-white leading-none">
              {reviewCount > 99 ? '99+' : reviewCount}
            </span>
          )}
          {activeId === REVIEWS_VIEW.id && activeIndicator}
        </button>
      </Tooltip>

      <AnimatePresence>
        {contextMenu && viewForContext && (
          <motion.div
            ref={contextRef}
            {...dropdownMotion}
            className="bg-bg-secondary border border-border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.45)] z-[300] min-w-[150px] overflow-hidden"
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
          </motion.div>
        )}
      </AnimatePresence>
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
  const [showSavedRepos, setShowSavedRepos] = useState(false);
  const [editorState, setEditorState] = useState<{ open: boolean; view?: SavedView }>({ open: false });

  const activeViewId = (() => {
    if (selectedViewId === REVIEWS_VIEW.id) return REVIEWS_VIEW.id;
    if (selectedViewId && views.find((v) => v.id === selectedViewId)) return selectedViewId;
    return views.length > 0 ? views[0].id : null;
  })();

  const setActiveViewId = (id: string | null) => setSelectedViewId(id);

  if (!isAuthenticated || showSettings || showSavedRepos) {
    if (isAuthenticated && showSavedRepos) {
      return (
        <div className="flex flex-col h-screen">
          <SavedRepos token={token!} onClose={() => setShowSavedRepos(false)} />
        </div>
      );
    }
    if (!isAuthenticated || showSettings) {
    return (
      <div className="flex flex-col h-screen">
        <header className="flex items-center justify-between px-3 h-12 bg-bg-secondary border-b border-border shrink-0">
          <h1 className="text-sm font-semibold">GitHub Sidecar</h1>
          <div className="flex items-center gap-1">
            <ThemeToggle resolvedTheme={resolvedTheme} onToggle={toggleTheme} />
            {isAuthenticated && (
              <Tooltip content="Back">
                <button
                  className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary"
                  onClick={() => setShowSettings(false)}
                >
                  <ArrowLeft size={16} />
                </button>
              </Tooltip>
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
          onSelect={(id) => { setActiveViewId(id); setEditorState({ open: false }); }}
          onCreate={() => setEditorState({ open: true })}
          onEdit={(view) => setEditorState({ open: true, view })}
          onDelete={handleDelete}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          reviewCount={reviewCount}
          onReviewsClick={() => { setActiveViewId(REVIEWS_VIEW.id); setEditorState({ open: false }); }}
        />
        <div className="flex items-center gap-1">
          <ThemeToggle resolvedTheme={resolvedTheme} onToggle={toggleTheme} />
          <Tooltip content="Settings">
            <button
              className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary"
              onClick={() => setShowSettings(true)}
            >
              <img src={user?.avatar_url} alt={user?.login} className="w-6 h-6 rounded-full" />
            </button>
          </Tooltip>
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
          <ViewList key={activeView.id} token={token!} username={user!.login} view={activeView} onAddRepo={() => setShowSavedRepos(true)} />
        ) : !editorState.open && views.length === 0 && activeViewId !== REVIEWS_VIEW.id ? (
          <WelcomeScreen onCreate={() => setEditorState({ open: true })} />
        ) : null}
      </main>
    </div>
  );
}
