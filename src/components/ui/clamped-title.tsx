import { useTruncated } from '@/hooks/use-truncated'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  /** The full text, shown on hover only when the rendered text is cut off. */
  title: string
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Defaults to the title; supply this to render it alongside other marks. */
  children?: React.ReactNode
}

/**
 * A title that may be clipped by its container, revealing itself on hover when
 * it is. The tooltip is withheld while the whole title is visible: a hint that
 * repeats what is already on screen is only noise.
 *
 * The trigger itself is always mounted, so a panel resized under the reader's
 * cursor swaps only the hint, never the text they are pointing at.
 */
export function ClampedTitle({ title, className, side = 'bottom', children }: Props) {
  const [ref, isTruncated] = useTruncated<HTMLSpanElement>()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={ref} className={className}>
          {children ?? title}
        </span>
      </TooltipTrigger>
      {isTruncated && <TooltipContent side={side}>{title}</TooltipContent>}
    </Tooltip>
  )
}
