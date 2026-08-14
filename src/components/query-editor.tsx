import { useEffect, useState } from 'react'
import { Check, GripVertical, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Hint } from '@/components/ui/tooltip'
import { createQueryId, type SavedQuery } from '@/lib/storage'

interface Props {
  queries: SavedQuery[]
  activeQueryId: string | null
  onChange: (queries: SavedQuery[]) => void
  onSelect: (id: string) => void
  /** Omitted on the options page, which has no panel to dismiss. */
  onDone?: () => void
}

const NEW_QUERY_TEMPLATE = 'is:open is:pr author:@me archived:false'

export function QueryEditor({ queries, activeQueryId, onChange, onSelect, onDone }: Props) {
  // Local drafts keep typing responsive; storage is written on blur.
  const [drafts, setDrafts] = useState(queries)

  useEffect(() => setDrafts(queries), [queries])

  const update = (id: string, patch: Partial<SavedQuery>) => {
    setDrafts((current) =>
      current.map((query) => (query.id === id ? { ...query, ...patch } : query)),
    )
  }

  const commit = () => {
    const cleaned = drafts.filter((query) => query.query.trim().length > 0)
    onChange(cleaned)
  }

  const add = () => {
    const query: SavedQuery = {
      id: createQueryId(),
      name: 'Untitled query',
      query: NEW_QUERY_TEMPLATE,
    }
    const next = [...drafts, query]
    setDrafts(next)
    onChange(next)
    onSelect(query.id)
  }

  const remove = (id: string) => {
    const next = drafts.filter((query) => query.id !== id)
    setDrafts(next)
    onChange(next)
  }

  return (
    <div className="scrollbar-slim flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-3">
        {drafts.map((query) => (
          <div
            key={query.id}
            className="group rounded-lg border border-border bg-card p-2.5 transition-colors focus-within:border-ring/60"
          >
            <div className="flex items-center gap-1.5">
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground/50" />
              <Input
                value={query.name}
                onChange={(event) => update(query.id, { name: event.target.value })}
                onBlur={commit}
                placeholder="Query name"
                className="h-7 border-0 bg-transparent px-1 font-semibold focus-visible:ring-0"
              />
              {query.id === activeQueryId && (
                <Hint label="Currently shown">
                  <Check className="size-3.5 shrink-0 text-open" />
                </Hint>
              )}
              <Hint label="Delete query">
                <Button
                  variant="danger"
                  size="icon-sm"
                  onClick={() => remove(query.id)}
                  aria-label={`Delete ${query.name}`}
                >
                  <Trash2 />
                </Button>
              </Hint>
            </div>

            <Input
              value={query.query}
              onChange={(event) => update(query.id, { query: event.target.value })}
              onBlur={commit}
              spellCheck={false}
              placeholder="is:open is:pr review-requested:@me"
              className="mt-1.5 font-mono text-[11px]"
            />
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={add} className="self-start">
          <Plus />
          Add query
        </Button>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-[11px] leading-tight text-muted-foreground">
          Uses GitHub advanced search syntax, including{' '}
          <code className="font-mono">AND</code>, <code className="font-mono">OR</code>,
          and parentheses. <code className="font-mono">@me</code> resolves to the token
          owner.
        </p>
        {onDone && (
          <Button size="sm" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
    </div>
  )
}
