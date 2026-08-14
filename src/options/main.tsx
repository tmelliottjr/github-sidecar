import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { TooltipProvider } from '@/components/ui/tooltip'

import './options.css'
import { OptionsApp } from './app'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => {
  document.documentElement.classList.toggle('dark', media.matches)
}
media.addEventListener('change', applyTheme)
applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <OptionsApp />
    </TooltipProvider>
  </StrictMode>,
)
