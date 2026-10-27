import { useId, useRef } from 'react'
import { ChevronRightIcon, FoldIcon, MarkGithubIcon, UnfoldIcon } from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Radius of the concave corners where the tab meets the edge of the viewport. */
const FILLET = 12

interface Props {
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
 * Stands in for the panel while it is hidden or collapsed: a tab on the left
 * edge of the viewport, centered vertically, with the GitHub mark, the result
 * count in a circle, and an open chevron. Shrunk, it shows the GitHub mark
 * with the count as a bubble. The query name is only in the description that
 * screen readers announce.
 */
export function Launcher({ title, count, compact, onOpen, onCompactChange }: Props) {
  const detailId = useId()
  const openRef = useRef<HTMLButtonElement>(null)
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

  // Grid tracks animate between 0fr and 1fr, which a height transition cannot
  // do without a fixed height, and the count is not always there.
  const fold = cn(
    'grid transition-[grid-template-rows,opacity] duration-300 ease-stack',
    'motion-reduce:transition-none',
    compact ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
  )

  return (
    <div
      data-launcher=""
      className={cn(
        'group/launcher fixed left-0 top-1/2 z-[2147483646] flex -translate-y-1/2 items-center gap-1.5',
        'animate-launcher-in',
      )}
    >
      <div className="relative shadow-tab">
        <button
          ref={openRef}
          type="button"
          onClick={onOpen}
          aria-label="Open GitHub Sidecar"
          aria-describedby={detailId}
          data-launcher-capsule=""
          className={cn(
            'group/open relative flex flex-col items-center rounded-r-[22px] bg-background',
            'py-1.5 pl-1.5 pr-1.5 text-foreground outline-none',
            // The border starts where the fillets end, so it never has to be
            // painted over where the tab joins the edge.
            "before:pointer-events-none before:absolute before:inset-y-0 before:right-0 before:left-[12px] before:content-['']",
            'before:rounded-r-[22px] before:border before:border-l-0 before:border-border',
            // Grows out from the edge on hover, the way a tab is pulled.
            'transition-[padding] duration-200 ease-stack group-hover/launcher:pr-2.5',
            'motion-reduce:transition-none',
            'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2',
          )}
        >
          <Fillet className="bottom-full" />
          <Fillet className="top-full -scale-y-100" />

          <span id={detailId} className="sr-only">
            {detail}
          </span>

          <Mark count={compact ? count : null} />

          <span className={fold} inert={compact}>
            <span className="min-h-0 overflow-hidden">
              <span className="flex flex-col items-center gap-1.5 pb-0.5 pt-1.5">
                {count !== null && (
                  <span
                    data-launcher-chip=""
                    className="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
                  >
                    {count > 999 ? '999+' : count}
                  </span>
                )}
                <ChevronRightIcon
                  className={cn(
                    'size-4 text-muted-foreground transition-[color,translate] duration-200 ease-stack',
                    'group-hover/open:translate-x-0.5 group-hover/open:text-foreground',
                    'motion-reduce:transition-none',
                  )}
                />
              </span>
            </span>
          </span>
        </button>

        {!compact && (
          <Hint label="Shrink to the GitHub mark" side="right">
            <button
              type="button"
              onClick={() => setCompact(true)}
              aria-label="Shrink launcher"
              className={cn(
                'absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full outline-none',
                'border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground',
                'opacity-0 transition-opacity group-hover/launcher:opacity-100 focus-visible:opacity-100',
                'focus-visible:ring-2 focus-visible:ring-ring/60',
              )}
            >
              <FoldIcon className="size-3" />
            </button>
          </Hint>
        )}
      </div>

      {compact && (
        <Hint label="Show the count" side="right">
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
            <UnfoldIcon className="size-3.5" />
          </button>
        </Hint>
      )}
    </div>
  )
}

/**
 * The quarter circle from the viewport edge to the tab border, centered on the
 * 1px stroke at each end: half a pixel in from the edge, and half a pixel below
 * the top of the tab, which sits at `y = FILLET`.
 */
const ARC_RADIUS = FILLET - 0.5
const ARC_TO = `A${ARC_RADIUS} ${ARC_RADIUS} 0 0 0 ${FILLET} ${FILLET + 0.5}`

/**
 * A concave corner joining the tab to the edge of the viewport, drawn above
 * the tab and flipped for below it. The arc carries on the tab border, which
 * starts at `x = FILLET`.
 */
function Fillet({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      width={FILLET}
      height={FILLET}
      viewBox={`0 0 ${FILLET} ${FILLET}`}
      className={cn('pointer-events-none absolute left-0 overflow-visible', className)}
    >
      <path d={`M0 1H0.5${ARC_TO}V${FILLET + 1}H0Z`} className="fill-background" />
      <path d={`M0.5 1${ARC_TO}`} className="fill-none stroke-border" />
    </svg>
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
