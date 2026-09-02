import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { ChevronRightIcon } from '@primer/octicons-react'

import { cn } from '@/lib/utils'
import { usePortalContainer } from './portal-container'

const ContextMenu = ({
  modal = false,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) => (
  // Non-modal, matching the dropdown: a modal menu would scroll-lock and
  // aria-hide the whole github.com page while open.
  <ContextMenuPrimitive.Root modal={modal} {...props} />
)

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

type SubHover = {
  /** Cancel a pending close (pointer re-entered the trigger or submenu). */
  keepOpen: () => void
  /** Close the submenu shortly, unless the pointer comes back first. */
  closeSoon: () => void
}

const SubHoverContext = React.createContext<SubHover | null>(null)

/**
 * How long to wait after the pointer leaves a submenu before closing it. Long
 * enough to cross the small gap toward an adjacent submenu (Radix's safe
 * triangle), short enough that leaving to empty space feels responsive.
 */
const SUB_CLOSE_DELAY_MS = 250

/** Run the caller's pointer handler, then the hover-intent one (mouse only). */
function composeMousePointer(
  original: ((event: React.PointerEvent<HTMLDivElement>) => void) | undefined,
  next: (() => void) | undefined,
) {
  return (event: React.PointerEvent<HTMLDivElement>) => {
    original?.(event)
    if (event.pointerType === 'mouse') next?.()
  }
}

/**
 * Radix closes a submenu only when a sibling item steals focus, on Escape, or
 * via the keyboard — never when the pointer just leaves it for empty space
 * (e.g. the underlying github.com page), which leaves it looking stuck. We make
 * the Sub controlled and close it a beat after the pointer leaves, cancelling
 * that timer whenever the pointer re-enters the trigger or the submenu content
 * so open-on-hover and safe-triangle traversal still work.
 */
function ContextMenuSub({
  children,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  const [open, setOpen] = React.useState(false)
  const closeTimer = React.useRef<number | null>(null)

  const keepOpen = React.useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      keepOpen()
      setOpen(next)
      onOpenChange?.(next)
    },
    [keepOpen, onOpenChange],
  )

  const hover = React.useMemo<SubHover>(
    () => ({
      keepOpen,
      closeSoon: () => {
        keepOpen()
        closeTimer.current = window.setTimeout(() => {
          closeTimer.current = null
          handleOpenChange(false)
        }, SUB_CLOSE_DELAY_MS)
      },
    }),
    [keepOpen, handleOpenChange],
  )

  React.useEffect(() => keepOpen, [keepOpen])

  return (
    <SubHoverContext.Provider value={hover}>
      <ContextMenuPrimitive.Sub {...props} open={open} onOpenChange={handleOpenChange}>
        {children}
      </ContextMenuPrimitive.Sub>
    </SubHoverContext.Provider>
  )
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  const container = usePortalContainer()
  return (
    <ContextMenuPrimitive.Portal container={container ?? undefined}>
      <ContextMenuPrimitive.Content
        collisionPadding={8}
        className={cn(
          'z-[2147483647] min-w-48 overflow-hidden rounded-lg border border-border bg-card p-1 text-foreground shadow-lg',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  children,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  const hover = React.useContext(SubHoverContext)
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent',
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:text-muted-foreground",
        className,
      )}
      onPointerEnter={composeMousePointer(onPointerEnter, hover?.keepOpen)}
      onPointerLeave={composeMousePointer(onPointerLeave, hover?.closeSoon)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3" aria-hidden />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  const container = usePortalContainer()
  const hover = React.useContext(SubHoverContext)
  return (
    <ContextMenuPrimitive.Portal container={container ?? undefined}>
      <ContextMenuPrimitive.SubContent
        collisionPadding={8}
        className={cn(
          'z-[2147483647] min-w-44 overflow-hidden rounded-lg border border-border bg-card p-1 text-foreground shadow-lg',
          className,
        )}
        onPointerEnter={composeMousePointer(onPointerEnter, hover?.keepOpen)}
        onPointerLeave={composeMousePointer(onPointerLeave, hover?.closeSoon)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
}
