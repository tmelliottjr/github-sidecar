import { ChevronUpIcon } from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'

interface Props {
  /** Glyph shown before the caption. */
  icon: React.ReactNode
  /** What the drawer holds. */
  caption: React.ReactNode
  /** Secondary detail shown after the caption in muted text. */
  meta?: React.ReactNode
  /** Accessible name and tooltip of the close button. */
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * A section a row opens inside itself, under a hairline. The row lifts into a
 * card while one is open. The header lines up with the row title and has its
 * own close button, since the badge that opened it can be several lines up.
 */
export function Drawer({ icon, caption, meta, closeLabel, onClose, children }: Props) {
  return (
    <div className="border-t border-border/70">
      <div className="flex h-8 items-center gap-1.5 pl-12 pr-1.5 text-[11px]">
        {icon}
        <span className="min-w-0 truncate font-semibold text-foreground">{caption}</span>
        {meta && <span className="min-w-0 truncate text-muted-foreground">{meta}</span>}
        <Hint label={closeLabel} side="top">
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="group/lid ml-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronUpIcon
              className="size-3.5 transition-[translate] duration-200 group-hover/lid:-translate-y-px motion-reduce:transition-none"
              aria-hidden
            />
          </button>
        </Hint>
      </div>
      {/* Rows inset their own padding, so their contents line up with the header. */}
      <div className="pb-2 pl-[42px] pr-1.5">{children}</div>
    </div>
  )
}
