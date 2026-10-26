import { useId, useRef } from 'react'
import {
  ArrowUpRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MarkGithubIcon,
  XIcon,
} from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'
import { DOCK_INSET } from '@/content/page-layout'
import { cn } from '@/lib/utils'

/** Matches the corner the floating launcher has always used. */
const FLOAT_INSET = 20

interface Props {
  /** Corner the launcher sits in: the side the panel opens on. */
  side: 'left' | 'right'
  /** Name of the active query. */
  title: string
  /** Total matches, or `null` while nothing has loaded yet. */
  count: number | null
  /** Whether the launcher is shrunk to the GitHub mark. */
  compact: boolean
  /** Handler that is called when the launcher is clicked to open the panel. */
  onOpen: () => void
  /** Handler that is called when the launcher is shrunk or expanded. */
  onCompactChange: (compact: boolean) => void
}

/**
 * Stands in for the panel while it is hidden or collapsed: a capsule in the
 * corner with the GitHub mark, the query name, and the result count, with the
 * open action riding beside it as its own disc. Shrunk, it shows the GitHub
 * mark with the count as a bubble.
 */
export function Launcher({ side, title, count, compact, onOpen, onCompactChange }: Props) {
  const detailId = useId()
  const openRef = useRef<HTMLButtonElement>(null)
  const inset = side === 'left' ? DOCK_INSET : FLOAT_INSET
  const detail =
    count === null
      ? title
      : `${title}, ${count.toLocaleString()} ${count === 1 ? 'result' : 'results'}`

  // Shrinking unmounts the shrink button and growing unmounts the expand
  // button, so focus has to move or it falls back to the page body.
  const setCompact = (next: boolean) => {
    onCompactChange(next)
    openRef.current?.focus()
  }

  // Grid tracks animate between 0fr and 1fr, which a width transition cannot
  // do without knowing the label width ahead of time.
  const fold = cn(
    'grid transition-[grid-template-columns,opacity] duration-300 ease-stack',
    'motion-reduce:transition-none',
    compact ? 'grid-cols-[0fr] opacity-0' : 'grid-cols-[1fr] opacity-100',
  )

  return (
    <div
      data-launcher=""
      className={cn(
        'group/launcher fixed z-[2147483646] flex items-center gap-1.5 animate-launcher-in',
        side === 'right' && 'flex-row-reverse',
      )}
      style={side === 'left' ? { left: inset, bottom: inset } : { right: inset, bottom: inset }}
    >
      <div
        className={cn(
          'relative transition-transform duration-200 ease-stack group-hover/launcher:-translate-y-0.5',
          'motion-reduce:transition-none motion-reduce:group-hover/launcher:translate-y-0',
        )}
      >
        <button
          ref={openRef}
          type="button"
          onClick={onOpen}
          aria-label="Open GitHub Sidecar"
          aria-describedby={detailId}
          className={cn(
            'group/open flex items-center rounded-full text-foreground outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2',
          )}
        >
          <span id={detailId} className="sr-only">
            {detail}
          </span>

          <span className="flex h-11 items-center rounded-full border border-border bg-background p-[5px] shadow-launcher">
            <Mark count={compact ? count : null} />

            <span className={fold} inert={compact}>
              <span className="min-w-0 overflow-hidden">
                <span className="flex items-center gap-2 whitespace-nowrap pl-2.5 pr-3">
                  <span className="max-w-52 truncate text-[13px] font-semibold">{title}</span>
                  {count !== null && (
                    <span
                      data-launcher-chip=""
                      className="rounded-full bg-muted px-2 text-[12px] font-semibold leading-5 tabular-nums text-muted-foreground"
                    >
                      {count.toLocaleString()}
                    </span>
                  )}
                </span>
              </span>
            </span>
          </span>

          {/* The sidecar disc. It folds by width, since the grid fold's
              overflow-hidden would clip its shadow. */}
          <span
            inert={compact}
            className={cn(
              'flex justify-end transition-[width,opacity] duration-300 ease-stack motion-reduce:transition-none',
              compact ? 'w-0 opacity-0' : 'w-12 opacity-100',
            )}
          >
            <span
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-launcher',
                'transition-transform duration-200 ease-stack group-hover/open:scale-105',
                'motion-reduce:transition-none motion-reduce:group-hover/open:scale-100',
              )}
            >
              <ArrowUpRightIcon className="size-4" />
            </span>
          </span>
        </button>

        {!compact && (
          <Hint label="Shrink to the GitHub mark" side="top">
            <button
              type="button"
              onClick={() => setCompact(true)}
              aria-label="Shrink launcher"
              className={cn(
                'absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full outline-none',
                'border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground',
                'opacity-0 transition-opacity group-hover/launcher:opacity-100 focus-visible:opacity-100',
                'focus-visible:ring-2 focus-visible:ring-ring/60',
              )}
            >
              <XIcon className="size-3" />
            </button>
          </Hint>
        )}
      </div>

      {compact && (
        <Hint label="Show the query and count" side="top">
          <button
            type="button"
            onClick={() => setCompact(false)}
            aria-label="Expand launcher"
            className={cn(
              'flex size-6 items-center justify-center rounded-full border border-border bg-background outline-none',
              'text-muted-foreground shadow-launcher transition-opacity hover:text-foreground',
              'opacity-0 group-hover/launcher:opacity-100 focus-visible:opacity-100',
              'focus-visible:ring-2 focus-visible:ring-ring/60',
            )}
          >
            {side === 'left' ? (
              <ChevronRightIcon className="size-3.5" />
            ) : (
              <ChevronLeftIcon className="size-3.5" />
            )}
          </button>
        </Hint>
      )}
    </div>
  )
}

/** The GitHub mark on a solid disc, with the result count as a bubble when one is given. */
function Mark({ count }: { count: number | null }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
      <MarkGithubIcon className="size-[18px]" />

      {count !== null && count > 0 && (
        <span
          data-launcher-count=""
          className={cn(
            'absolute -right-2 -top-2 min-w-4 rounded-full bg-link px-1',
            'text-center text-[10px] font-bold leading-4 tabular-nums text-background',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </span>
  )
}
