import { cn } from '@/lib/utils'

interface Props {
  /** Announced to assistive tech, which gets no benefit from the animation. */
  label: string
  className?: string
}

/**
 * A hairline bar for work whose progress cannot be measured — a poll, a
 * revalidation — where the only honest thing to report is that it is happening
 * at all.
 *
 * The whole width is lit rather than a lone travelling segment, so the bar
 * reads as one continuous state that is running rather than as an object
 * crossing the header. It breathes to say it is live, and a brighter crest
 * runs left to right across it to give that breathing a direction.
 *
 * It carries no size of its own, so it can be laid over an edge that is
 * already there rather than claiming a strip of its own and pushing the
 * content below it around every time the work starts and stops.
 */
export function IndeterminateBar({ label, className }: Props) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn(
        'pointer-events-none overflow-hidden bg-open/85 animate-progress-pulse',
        className,
      )}
    >
      {/*
       * The crest lightens the track rather than being another shade of green
       * on top of it. Over a solid green line that reads as a highlight in
       * both colour modes, where a second green only reads as a seam.
       */}
      <div className="h-full w-1/3 bg-linear-to-r from-transparent via-white/55 to-transparent animate-progress-sweep" />
    </div>
  )
}
