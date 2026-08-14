import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Sidebar } from '@/components/sidebar'
import { PortalContainerProvider } from '@/components/ui/portal-container'
import { TooltipProvider } from '@/components/ui/tooltip'
import { watchColorScheme } from '@/content/color-scheme'
import { injectFonts } from '@/content/fonts'
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

function mount(): void {
  if (document.getElementById(HOST_ID)) return

  injectFonts()

  const host = document.createElement('div')
  host.id = HOST_ID
  // The host is a zero-size anchor; the window itself is position: fixed.
  host.style.cssText = 'all: initial; position: static;'
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(withShadowRootProperties(styles))
  shadow.adoptedStyleSheets = [sheet]

  const container = document.createElement('div')
  container.id = 'github-sidebar-container'
  container.className = 'gh-sidebar-root'
  shadow.appendChild(container)

  createRoot(container).render(
    <StrictMode>
      <Root container={container} />
    </StrictMode>,
  )
}

// GitHub uses Turbo navigation, which can replace large parts of the DOM.
// Remounting on navigation keeps the sidebar present.
function keepMounted(): void {
  mount()
  document.addEventListener('turbo:load', mount)
  document.addEventListener('pjax:end', mount)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', keepMounted, { once: true })
} else {
  keepMounted()
}
