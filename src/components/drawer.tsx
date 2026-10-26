import { ChevronUpIcon } from '@primer/octicons-react'

import { Hint } from '@/components/ui/tooltip'

interface Props {
  /** What the drawer holds, said in the caption. */
  caption: React.ReactNode
  /** Accessible name and tooltip of the button that shuts the drawer. */
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * The inset panel a row opens below itself, aligned with the title column so
 * it reads as part of the row it came from. The caption says what it holds,
 * and its close button sits where the eye already is, since the mark that
 * opened it can be several lines away by then.
 */
export function Drawer({ caption, closeLabel, onClose, children }: Props) {
  return (
    <div className="mb-1.5 ml-12 mr-1 rounded-xl bg-muted/70">
      <div className="flex h-7 items-center gap-2 pl-2.5 pr-0.5 text-[11px] font-semibold text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">{caption}</span>
        <Hint label={closeLabel} side="top">
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="group/lid flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronUpIcon
              className="size-3.5 transition-[color,translate] duration-200 group-hover/lid:-translate-y-px group-hover/lid:text-foreground motion-reduce:transition-none"
              aria-hidden
            />
          </button>
        </Hint>
      </div>
      {children}
    </div>
  )
}
