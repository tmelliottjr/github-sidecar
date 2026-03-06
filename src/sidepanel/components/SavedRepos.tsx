import { useState, useRef, useEffect } from 'react';
import { Search, X, ArrowLeft, ExternalLink, Trash2, Star, BookmarkPlus, Loader, GripVertical } from 'lucide-react';
import { useUserSearch } from '../hooks/useUserSearch';
import { useRepoSearch } from '../hooks/useRepoSearch';
import { useSavedRepos } from '../hooks/useSavedRepos';
import { Tooltip } from './Tooltip';
import type { GitHubUserSearchResult, GitHubRepoSearchResult } from '../../types';

interface SavedReposProps {
  token: string;
  onClose: () => void;
}

function Spinner({ size = 14 }: { size?: number }) {
  return <Loader size={size} className="animate-spin text-text-secondary" />;
}

function OwnerSearch({
  token,
  onSelect,
}: {
  token: string;
  onSelect: (user: GitHubUserSearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const { results, isLoading, isDebouncing } = useUserSearch(token, query);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showResults = showDropdown && query.trim().length >= 2;
  const showSpinner = isLoading || isDebouncing;

  const [prevResults, setPrevResults] = useState(results);
  if (prevResults !== results) {
    setPrevResults(results);
    setHighlightedIndex(-1);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      onSelect(results[highlightedIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search users or organizations..."
          className="w-full bg-bg-primary border border-border rounded-lg py-2 pl-8 pr-8 text-text-primary text-[13px] placeholder:text-text-secondary focus:outline-none focus:border-text-link focus:ring-2 focus:ring-text-link/15 transition-[border-color,box-shadow]"
          autoFocus
        />
        {showSpinner && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Spinner />
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 bg-bg-secondary border border-border rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.25)] overflow-hidden animate-slide-in max-h-[240px] overflow-y-auto"
        >
          {results.map((user, i) => (
            <button
              key={user.login}
              className={`flex items-center gap-2.5 w-full bg-transparent border-none py-2 px-3 cursor-pointer transition-colors text-left ${
                i === highlightedIndex
                  ? 'bg-text-link/10'
                  : 'hover:bg-bg-tertiary'
              }`}
              onClick={() => onSelect(user)}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              <img
                src={user.avatar_url}
                alt={user.login}
                className="w-7 h-7 rounded-full shrink-0"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-medium text-text-primary truncate">
                  {user.login}
                </span>
                <span className="text-[10px] text-text-secondary">
                  {user.type}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {showResults && !showSpinner && results.length === 0 && query.trim().length >= 2 && (
        <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 bg-bg-secondary border border-border rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.25)] py-4 px-3 text-center text-[12px] text-text-secondary animate-slide-in">
          No users found for "{query}"
        </div>
      )}
    </div>
  );
}

function RepoSearch({
  token,
  owner,
  onSelect,
  onBack,
  isSaved,
}: {
  token: string;
  owner: GitHubUserSearchResult;
  onSelect: (repo: GitHubRepoSearchResult) => void;
  onBack: () => void;
  isSaved: (fullName: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const { results, isLoading, isDebouncing } = useRepoSearch(token, owner.login, query);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showSpinner = isLoading || isDebouncing;

  const [prevResults, setPrevResults] = useState(results);
  if (prevResults !== results) {
    setPrevResults(results);
    setHighlightedIndex(-1);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      if (!isSaved(results[highlightedIndex].full_name)) {
        onSelect(results[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div>
      {/* Selected owner chip */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 mb-3 bg-bg-tertiary border border-border rounded-lg py-1.5 px-2.5 cursor-pointer transition-colors hover:bg-border group"
      >
        <ArrowLeft size={12} className="text-text-secondary group-hover:text-text-primary transition-colors" />
        <img src={owner.avatar_url} alt={owner.login} className="w-5 h-5 rounded-full" />
        <span className="text-[12px] font-medium text-text-primary">{owner.login}</span>
        <span className="text-[10px] text-text-secondary">· Change</span>
      </button>

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={`Search ${owner.login}'s repositories...`}
          className="w-full bg-bg-primary border border-border rounded-lg py-2 pl-8 pr-8 text-text-primary text-[13px] placeholder:text-text-secondary focus:outline-none focus:border-text-link focus:ring-2 focus:ring-text-link/15 transition-[border-color,box-shadow]"
          autoFocus
        />
        {showSpinner && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <Spinner />
          </div>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="mt-1 bg-bg-secondary border border-border rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.25)] overflow-hidden animate-slide-in max-h-[280px] overflow-y-auto"
        >
          {results.map((repo, i) => {
            const alreadySaved = isSaved(repo.full_name);
            return (
              <button
                key={repo.full_name}
                className={`flex items-start gap-2.5 w-full bg-transparent border-none py-2.5 px-3 cursor-pointer transition-colors text-left ${
                  alreadySaved
                    ? 'opacity-50 cursor-default'
                    : i === highlightedIndex
                      ? 'bg-text-link/10'
                      : 'hover:bg-bg-tertiary'
                }`}
                onClick={() => !alreadySaved && onSelect(repo)}
                onMouseEnter={() => !alreadySaved && setHighlightedIndex(i)}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-text-primary truncate">
                      {repo.name}
                    </span>
                    {alreadySaved && (
                      <span className="text-[9px] bg-accent/15 text-accent rounded px-1.5 py-px font-medium shrink-0">
                        Saved
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <span className="text-[11px] text-text-secondary leading-snug mt-0.5 line-clamp-2">
                      {repo.description}
                    </span>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    {repo.language && (
                      <span className="text-[10px] text-text-secondary flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-text-link inline-block" />
                        {repo.language}
                      </span>
                    )}
                    <span className="text-[10px] text-text-secondary flex items-center gap-0.5">
                      <Star size={10} /> {repo.stargazers_count.toLocaleString()}
                    </span>
                  </div>
                </div>
                {!alreadySaved && (
                  <BookmarkPlus
                    size={14}
                    className="text-text-secondary mt-0.5 shrink-0 opacity-0 group-hover:opacity-100"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {showDropdown && !showSpinner && results.length === 0 && (
        <div className="mt-1 bg-bg-secondary border border-border rounded-lg py-4 px-3 text-center text-[12px] text-text-secondary animate-slide-in">
          {query ? `No repositories found for "${query}"` : 'No repositories found'}
        </div>
      )}
    </div>
  );
}

export function SavedRepos({ token, onClose }: SavedReposProps) {
  const { repos, addRepo, removeRepo, reorder, hasRepo } = useSavedRepos();
  const [selectedOwner, setSelectedOwner] = useState<GitHubUserSearchResult | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const handleSelectRepo = (repo: GitHubRepoSearchResult) => {
    addRepo({
      owner: repo.owner.login,
      repo: repo.name,
      fullName: repo.full_name,
      ownerAvatarUrl: repo.owner.avatar_url,
      description: repo.description,
    });
  };

  const handleOpenRepo = (fullName: string) => {
    window.open(`https://github.com/${fullName}`, '_blank');
  };

  return (
    <div className="flex flex-col h-full animate-slide-in">
      {/* Header */}
      <div className="flex items-center justify-between py-3 px-4 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold text-text-primary">Saved Repositories</h3>
        <button
          className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded-md flex items-center justify-center hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Search section */}
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">
            {selectedOwner ? 'Select a repository' : 'Find a repository'}
          </p>
          {selectedOwner ? (
            <RepoSearch
              token={token}
              owner={selectedOwner}
              onSelect={handleSelectRepo}
              onBack={() => setSelectedOwner(null)}
              isSaved={hasRepo}
            />
          ) : (
            <OwnerSearch token={token} onSelect={setSelectedOwner} />
          )}
        </div>

        {/* Saved repos list */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">
            Quick links {repos.length > 0 && `(${repos.length})`}
          </p>

          {repos.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <BookmarkPlus size={24} className="text-text-secondary opacity-40 mb-2" />
              <p className="text-[12px] text-text-secondary leading-relaxed max-w-[220px]">
                Search for a user or org above, then pick a repository to save as a quick link.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {repos.map((repo, index) => (
                <div
                  key={repo.id}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = 'move';
                    // Needed for Firefox
                    e.dataTransfer.setData('text/plain', '');
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropIndex(index);
                  }}
                  onDragLeave={(e) => {
                    // Only clear if leaving the element entirely
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropIndex(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== index) {
                      reorder(dragIndex, index);
                    }
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDropIndex(null);
                  }}
                  className={`group flex items-center gap-2 bg-bg-secondary border rounded-lg py-2 px-2 transition-all duration-150 ${
                    dragIndex === index
                      ? 'opacity-40 scale-[0.97] border-border'
                      : dropIndex === index && dragIndex !== null && dragIndex !== index
                        ? 'border-text-link shadow-[0_0_0_1px_var(--color-text-link)]'
                        : 'border-border hover:border-text-secondary/30'
                  }`}
                >
                  <div className="shrink-0 cursor-grab active:cursor-grabbing text-text-secondary/40 hover:text-text-secondary transition-colors">
                    <GripVertical size={14} />
                  </div>
                  <img
                    src={repo.ownerAvatarUrl}
                    alt={repo.owner}
                    className="w-6 h-6 rounded-full shrink-0 pointer-events-none"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <button
                      onClick={() => handleOpenRepo(repo.fullName)}
                      className="bg-transparent border-none p-0 text-left cursor-pointer"
                    >
                      <span className="text-[12px] font-medium text-text-link hover:underline truncate block">
                        {repo.fullName}
                      </span>
                    </button>
                    {repo.description && (
                      <span className="text-[10px] text-text-secondary truncate">
                        {repo.description}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Tooltip content="Open in GitHub">
                      <button
                        onClick={() => handleOpenRepo(repo.fullName)}
                        className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                      >
                        <ExternalLink size={12} />
                      </button>
                    </Tooltip>
                    {showConfirmDelete === repo.id ? (
                      <Tooltip content="Click again to confirm">
                        <button
                          onClick={() => {
                            removeRepo(repo.id);
                            setShowConfirmDelete(null);
                          }}
                          onMouseLeave={() => setShowConfirmDelete(null)}
                          className="bg-transparent border-none text-danger cursor-pointer p-1 rounded hover:bg-danger/10 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Remove">
                        <button
                          onClick={() => setShowConfirmDelete(repo.id)}
                          className="bg-transparent border-none text-text-secondary cursor-pointer p-1 rounded hover:text-danger hover:bg-danger/10 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
