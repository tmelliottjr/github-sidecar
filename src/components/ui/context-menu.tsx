import * as React from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { ChevronRightIcon } from '@primer/octicons-react'

import { cn } from '@/lib/utils'
import { usePortalContainer } from './portal-container'
import { SubHoverContext, composeMousePointer, useSubmenuHover } from './submenu-hover'

const ContextMenu = ({
  modal = false,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) => (
  // Non-modal, matching the dropdown: a modal menu would scroll-lock and
  // aria-hide the whole github.com page while open.
  <ContextMenuPrimitive.Root modal={modal} {...props} />
)

const ContextMenuTrigger = ContextMenuPrimitive.Trigger

function ContextMenuSub({
  children,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  const sub = useSubmenuHover(onOpenChange)
  return (
    <SubHoverContext.Provider value={sub.hover}>
      <ContextMenuPrimitive.Sub {...props} open={sub.open} onOpenChange={sub.onOpenChange}>
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
          'z-[2147483647] min-w-48 overflow-hidden rounded-xl border border-border bg-card p-1 text-foreground shadow-window',
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
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] outline-none',
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
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] outline-none',
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
          'z-[2147483647] min-w-44 overflow-hidden rounded-xl border border-border bg-card p-1 text-foreground shadow-window',
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
