import * as React from 'react'
import { useIsPresent } from 'motion/react'

/**
 * Radix portals default to document.body, which would escape the shadow root
 * and lose every style. Providers supply the in-shadow element to portal into;
 * consumers outside a provider (the options page) fall back to document.body.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: React.ReactNode
}) {
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
    </PortalContainerContext.Provider>
  )
}

export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext)
}

/**
 * Whether the UI that opened a portal is still on screen. Portaled content
 * sits outside its owner in the DOM, so a leaving panel's `inert` does not
 * reach it. Menus and tooltips render nothing once their owner starts leaving.
 */
export function useOwnerPresent(): boolean {
  return useIsPresent()
}
