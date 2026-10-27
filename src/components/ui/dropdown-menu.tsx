import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { CheckIcon, ChevronRightIcon } from '@primer/octicons-react'

import { cn } from '@/lib/utils'
import { usePortalContainer } from './portal-container'
import { SubHoverContext, composeMousePointer, useSubmenuHover } from './submenu-hover'

const DropdownMenu = ({
  modal = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) => (
  // Non-modal by default: a modal menu would scroll-lock and aria-hide the
  // whole github.com page while open.
  <DropdownMenuPrimitive.Root modal={modal} {...props} />
)
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const container = usePortalContainer()
  return (
    <DropdownMenuPrimitive.Portal container={container ?? undefined}>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-[2147483647] min-w-48 overflow-hidden rounded-xl border border-border bg-card p-1 text-foreground shadow-window',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:text-muted-foreground",
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-[13px] outline-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuSub({
  children,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  const sub = useSubmenuHover(onOpenChange)
  return (
    <SubHoverContext.Provider value={sub.hover}>
      <DropdownMenuPrimitive.Sub {...props} open={sub.open} onOpenChange={sub.onOpenChange}>
        {children}
      </DropdownMenuPrimitive.Sub>
    </SubHoverContext.Provider>
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  const hover = React.useContext(SubHoverContext)
  return (
    <DropdownMenuPrimitive.SubTrigger
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
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  onPointerEnter,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const container = usePortalContainer()
  const hover = React.useContext(SubHoverContext)
  return (
    <DropdownMenuPrimitive.Portal container={container ?? undefined}>
      <DropdownMenuPrimitive.SubContent
        collisionPadding={8}
        className={cn(
          'z-[2147483647] min-w-44 overflow-hidden rounded-xl border border-border bg-card p-1 text-foreground shadow-window',
          className,
        )}
        onPointerEnter={composeMousePointer(onPointerEnter, hover?.keepOpen)}
        onPointerLeave={composeMousePointer(onPointerLeave, hover?.closeSoon)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
