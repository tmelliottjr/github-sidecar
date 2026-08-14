import { useEffect, useState } from 'react'

/**
 * Tracks whether this tab is on screen. Hidden tabs do not request anything at
 * all; when the user switches to one it hydrates from the shared cache in the
 * service worker, which is effectively instant.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  )

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  return visible
}
