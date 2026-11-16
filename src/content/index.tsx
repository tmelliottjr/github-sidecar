import { StrictMode, useEffect, useState } from 'react'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Sidebar } from '@/components/sidebar'
import { browser } from '@/lib/browser'
import { PortalContainerProvider } from '@/components/ui/portal-container'
import { TooltipProvider } from '@/components/ui/tooltip'
import { watchColorScheme } from '@/content/color-scheme'
import { resolveFontStack } from '@/content/fonts'
import { isolateKeyboard } from '@/content/keyboard'
import { HOST_ID } from '@/content/page-layout'
import { withShadowRootProperties } from '@/content/stylesheet'
import styles from '@/styles/app.css?inline'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnReconnect: true,
    },
  },
})

function Root({ container }: { container: HTMLElement }) {
  const [isDark, setIsDark] = useState(false)

  useEffect(() => watchColorScheme(setIsDark), [])

  useEffect(() => {
    container.classList.toggle('dark', isDark)
  }, [container, isDark])

  return (
    <QueryClientProvider client={queryClient}>
      <PortalContainerProvider container={container}>
        <TooltipProvider>
          <Sidebar />
        </TooltipProvider>
      </PortalContainerProvider>
    </QueryClientProvider>
  )
}

let mounted: { host: HTMLElement; root: ReactRoot } | null = null

function mount(): void {
  if (mounted?.host.isConnected) return
  unmount()
  // Firefox injects this script into open tabs when the extension is installed
  // or updated, and the copy it replaces leaves a dead panel in the page.
  document.getElementById(HOST_ID)?.remove()

  const host = document.createElement('div')
  host.id = HOST_ID
  // The host is a zero-size anchor; the window itself is position: fixed.
  host.style.cssText = 'all: initial; position: static;'
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  isolateKeyboard(shadow)

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(withShadowRootProperties(styles))
  shadow.adoptedStyleSheets = [sheet]

  const container = document.createElement('div')
  container.id = 'github-sidecar-container'
  container.className = 'gh-sidebar-root'
  // Overrides the stylesheet's own default with the page's stack, so the panel
  // reads as part of github.com rather than as something pasted onto it.
  container.style.setProperty('--font-sans', resolveFontStack())
  shadow.appendChild(container)

  const root = createRoot(container)
  root.render(
    <StrictMode>
      <Root container={container} />
    </StrictMode>,
  )
  mounted = { host, root }
}

/** Unmounting runs the panel cleanup, which gives the page its space back. */
function unmount(): void {
  if (!mounted) return
  mounted.root.unmount()
  mounted.host.remove()
  mounted = null
}

// GitHub uses Turbo navigation, which can replace large parts of the DOM.
// Remounting on navigation keeps the sidebar present.
const NAVIGATION_EVENTS = ['turbo:load', 'pjax:end']

/** When the reader comes back to the tab or reaches for the panel. */
const ORPHAN_CHECKS: Array<[EventTarget, string]> = [
  [document, 'visibilitychange'],
  [window, 'focus'],
  [document, 'pointerdown'],
  [document, 'keydown'],
]

function onNavigation(): void {
  if (!removeIfOrphaned()) mount()
}

/**
 * Chrome keeps this script running after the extension is reloaded, updated,
 * or removed, but clears `runtime.id` and fails every extension call, so the
 * panel stays on screen with buttons that do nothing.
 */
function removeIfOrphaned(): boolean {
  if (browser.runtime?.id) return false
  for (const type of NAVIGATION_EVENTS) document.removeEventListener(type, onNavigation)
  for (const [target, type] of ORPHAN_CHECKS) {
    target.removeEventListener(type, removeIfOrphaned, { capture: true })
  }
  unmount()
  return true
}

function keepMounted(): void {
  mount()
  for (const type of NAVIGATION_EVENTS) document.addEventListener(type, onNavigation)
  for (const [target, type] of ORPHAN_CHECKS) {
    target.addEventListener(type, removeIfOrphaned, { capture: true })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', keepMounted, { once: true })
} else {
  keepMounted()
}
