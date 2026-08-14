import * as React from 'react'

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
