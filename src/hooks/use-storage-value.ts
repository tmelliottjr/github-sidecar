import { useCallback, useEffect, useRef, useState } from 'react'

import { browser } from '@/lib/browser'
import { readStorage, writeStorage, type StorageShape } from '@/lib/storage'

type Updater<T> = T | ((current: T) => T)

/**
 * Reads a value from browser.storage.local and keeps it in sync across every
 * open github.com tab, so moving the window in one tab updates the others.
 * Supports functional updates because window geometry and settings are patched
 * from callbacks that would otherwise capture a stale value.
 */
export function useStorageValue<K extends keyof StorageShape>(
  key: K,
): [StorageShape[K] | null, (next: Updater<StorageShape[K]>) => void] {
  const [value, setValue] = useState<StorageShape[K] | null>(null)
  const valueRef = useRef<StorageShape[K] | null>(null)

  const commit = useCallback((next: StorageShape[K] | null) => {
    valueRef.current = next
    setValue(next)
  }, [])

  useEffect(() => {
    let active = true
    void readStorage(key).then((stored) => {
      if (active) commit(stored)
    })
    return () => {
      active = false
    }
  }, [commit, key])

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local' || !(key in changes)) return
      commit((changes[key].newValue ?? null) as StorageShape[K] | null)
    }
    browser.storage.onChanged.addListener(listener)
    return () => browser.storage.onChanged.removeListener(listener)
  }, [commit, key])

  const update = useCallback(
    (next: Updater<StorageShape[K]>) => {
      const current = valueRef.current
      // Ignore functional updates that land before the initial read resolves.
      if (current === null && typeof next === 'function') return
      const resolved =
        typeof next === 'function'
          ? (next as (previous: StorageShape[K]) => StorageShape[K])(
              current as StorageShape[K],
            )
          : next
      commit(resolved)
      void writeStorage(key, resolved)
    },
    [commit, key],
  )

  return [value, update]
}
