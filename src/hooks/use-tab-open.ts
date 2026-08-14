import { useCallback, useEffect, useState } from 'react'

import { sendMessage } from '@/lib/messages'

/**
 * Whether the panel is showing in *this* tab.
 *
 * A new tab starts closed and stays silent — no query runs until it is opened,
 * so a tab the user never asks about costs nothing. The flag is held by the
 * service worker against this tab's id, which keeps it out of github.com's own
 * storage and keeps one tab's choice from deciding another's.
 *
 * Null until the worker answers, which is the signal not to render anything
 * yet: showing the launcher and then swapping it for an open panel would be a
 * visible flash on every page load.
 */
export function useTabOpen(): [boolean | null, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void sendMessage({ type: 'tab-open' })
      .then((stored) => {
        if (active) setOpen(stored)
      })
      // A worker that cannot answer should leave the panel out of the way.
      .catch(() => {
        if (active) setOpen(false)
      })
    return () => {
      active = false
    }
  }, [])

  const update = useCallback((next: boolean) => {
    setOpen(next)
    void sendMessage({ type: 'set-tab-open', open: next }).catch(() => undefined)
  }, [])

  return [open, update]
}
