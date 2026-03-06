import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ExternalLink, Bookmark, Plus } from 'lucide-react';
import { useSavedRepos } from '../hooks/useSavedRepos';

interface RepoQuickNavProps {
  onAddRepo: () => void;
}

export function RepoQuickNav({ onAddRepo }: RepoQuickNavProps) {
  const { repos } = useSavedRepos();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 bg-transparent border border-border rounded-md py-0.5 px-2 text-[10px] font-medium text-text-secondary cursor-pointer transition-colors hover:bg-bg-tertiary hover:text-text-primary"
      >
        <Bookmark size={10} />
        <span>Repos</span>
        <ChevronDown size={10} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] right-0 bg-bg-secondary border border-border rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.3)] z-[200] min-w-[200px] max-w-[280px] max-h-[280px] overflow-y-auto animate-slide-in">
          <div className="py-1">
            <button
              className="flex items-center gap-2 w-full bg-transparent border-none py-1.5 px-3 cursor-pointer transition-colors text-left hover:bg-bg-tertiary"
              onClick={() => {
                onAddRepo();
                setOpen(false);
              }}
            >
              <Plus size={12} className="text-text-link shrink-0" />
              <span className="text-[11px] font-medium text-text-link">Add repository</span>
            </button>

            {repos.length > 0 && (
              <>
                <div className="mx-2.5 my-1 border-t border-border" />
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    className="flex items-center gap-2 w-full bg-transparent border-none py-1.5 px-3 cursor-pointer transition-colors text-left hover:bg-bg-tertiary group"
                    onClick={() => {
                      window.open(`https://github.com/${repo.fullName}`, '_blank');
                      setOpen(false);
                    }}
                  >
                    <img
                      src={repo.ownerAvatarUrl}
                      alt={repo.owner}
                      className="w-4 h-4 rounded-full shrink-0"
                    />
                    <span className="text-[11px] font-medium text-text-primary truncate flex-1">
                      {repo.fullName}
                    </span>
                    <ExternalLink size={10} className="text-text-secondary shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
