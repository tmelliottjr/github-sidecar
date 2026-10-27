import { useId } from 'react'
import { ChevronRightIcon, MarkGithubIcon } from '@primer/octicons-react'

import { cn } from '@/lib/utils'

/** Radius of the concave corners where the tab meets the edge of the viewport. */
const FILLET = 12

interface Props {
  /** Name of the active query. */
  title: string
  /** Total matches, or `null` while nothing has loaded yet. */
  count: number | null
  /** Handler that is called when the launcher is clicked to open the panel. */
  onOpen: () => void
}

/**
 * Stands in for the panel while it is hidden or collapsed: a tab on the left
 * edge of the viewport, centered vertically, with the GitHub mark, the result
 * count in a circle, and an open chevron. The query name is only in the
 * description that screen readers announce.
 */
export function Launcher({ title, count, onOpen }: Props) {
  const detailId = useId()
  const detail =
    count === null
      ? title
      : `${title}, ${count.toLocaleString()} ${count === 1 ? 'result' : 'results'}`

  return (
    <div
      data-launcher=""
      className="group/launcher fixed left-0 top-1/2 z-[2147483646] -translate-y-1/2 animate-launcher-in"
    >
      <div className="relative shadow-tab">
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open GitHub Sidecar"
          aria-describedby={detailId}
          data-launcher-capsule=""
          className={cn(
            'group/open relative flex flex-col items-center gap-1.5 rounded-r-[22px] bg-background',
            'pb-2 pl-1.5 pr-1.5 pt-1.5 text-foreground outline-none',
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

          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <MarkGithubIcon className="size-[18px]" />
          </span>
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
        </button>
      </div>
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
