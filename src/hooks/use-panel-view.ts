import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useStorageValue } from '@/hooks/use-storage-value'
import { useTabOpen } from '@/hooks/use-tab-open'
import { DEFAULT_PANEL_VIEW, type PanelView } from '@/lib/storage'

type Filters = Omit<PanelView, 'open'>

const NO_FILTERS: Filters = {
  filterText: DEFAULT_PANEL_VIEW.filterText,
  quickFilter: DEFAULT_PANEL_VIEW.quickFilter,
  sortOrder: DEFAULT_PANEL_VIEW.sortOrder,
}

/**
 * How long the search text rests before it is written. Every write redraws the
 * panel in every github.com tab, and with a write per keystroke the echo of an
 * earlier write can replace text typed since.
 */
const TEXT_WRITE_DELAY_MS = 300

/**
 * Whether the panel is showing in this tab, and how its rows are narrowed and
 * ordered.
 *
 * With `synced` on, every tab follows `panelView` in storage. With it off, each
 * tab keeps its own: open state comes from `useTabOpen`, and filters start
 * empty. Each change still writes the whole view of this tab to `panelView`,
 * so switching `synced` on shows the tab changed last.
 *
 * Null until `synced` is known and the state it reads has loaded.
 */
export function usePanelView(
  synced: boolean | null,
): [PanelView | null, (patch: Partial<PanelView>) => void] {
  const [stored, setStored] = useStorageValue('panelView')
  const [tabOpen, setTabOpen] = useTabOpen()
  const [own, setOwn] = useState<Filters>(NO_FILTERS)
  // Search text typed here and not written yet, shown in place of the stored text.
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Read by writes, which can run from a timer set before the latest render.
  const ownRef = useRef<Filters>(NO_FILTERS)
  const syncedRef = useRef(synced)
  const tabOpenRef = useRef(tabOpen)

  useEffect(() => {
    syncedRef.current = synced
    tabOpenRef.current = tabOpen
  }, [synced, tabOpen])

  const changeOwn = useCallback((next: Filters) => {
    ownRef.current = next
    setOwn(next)
  }, [])

  // Every write carries the pending search text, so a write of another field cannot drop it.
  const write = useCallback(
    (patch: Partial<PanelView>) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
      const text = draftRef.current
      draftRef.current = null
      setDraft(null)
      const typed = text === null ? {} : { filterText: text }
      if (syncedRef.current) {
        setStored((current) => ({ ...current, ...typed, ...patch }))
        return
      }
      // The whole view of this tab, so switching sync on shows one tab rather than a mix of several.
      setStored({ ...ownRef.current, open: tabOpenRef.current ?? false, ...typed, ...patch })
    },
    [setStored],
  )

  const flush = useCallback(() => {
    if (draftRef.current !== null) write({})
  }, [write])

  // The next tab can be shown before the timer runs, so leaving this one writes the text at once.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  // Kept in step while synced, so switching `synced` off leaves this tab as it is.
  useEffect(() => {
    if (!synced || !stored) return
    const { open, ...filters } = stored
    changeOwn(filters)
    if (tabOpen !== null && tabOpen !== open) setTabOpen(open)
  }, [changeOwn, setTabOpen, stored, synced, tabOpen])

  const patch = useCallback(
    (next: Partial<PanelView>) => {
      const { open, filterText, ...rest } = next
      if (open !== undefined) setTabOpen(open)
      changeOwn({
        ...ownRef.current,
        ...rest,
        ...(filterText === undefined ? {} : { filterText }),
      })
      if (filterText !== undefined) {
        draftRef.current = filterText
        setDraft(filterText)
      }
      if (open !== undefined || Object.keys(rest).length > 0) {
        write(open === undefined ? rest : { ...rest, open })
        return
      }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, TEXT_WRITE_DELAY_MS)
    },
    [changeOwn, flush, setTabOpen, write],
  )

  const view = useMemo<PanelView | null>(() => {
    if (synced === null) return null
    if (synced) {
      if (!stored) return null
      return draft === null ? stored : { ...stored, filterText: draft }
    }
    return tabOpen === null ? null : { ...own, open: tabOpen }
  }, [draft, own, stored, synced, tabOpen])

  return [view, patch]
}
