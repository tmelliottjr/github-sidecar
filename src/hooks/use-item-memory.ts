import { useCallback, useMemo } from 'react'

import { useStorageValue } from '@/hooks/use-storage-value'
import {
  reminderDueAt,
  reminderState,
  signatureOf,
  type ItemMemory,
  type ReminderChoice,
  type ReminderOverrides,
} from '@/lib/attention'
import type { SearchItem } from '@/lib/github/types'
import { MAX_REMEMBERED_ITEMS } from '@/lib/storage'

export interface ItemMemoryApi {
  memory: Record<string, ItemMemory>
  /** Records what these rows look like now, as the state the reader has seen. */
  markSeen: (items: readonly SearchItem[]) => void
  /** Asks to be reminded about a row, on the clock or when it moves. */
  remind: (item: SearchItem, choice: ReminderChoice) => void
  clearReminder: (item: SearchItem) => void
  /** Takes a row out of the list without losing sight of it. */
  hide: (item: SearchItem) => void
  unhide: (item: SearchItem) => void
}

const NOTHING: Record<string, ItemMemory> = {}

/**
 * Remembers what the reader has already looked at, shared across their tabs
 * because looking at a pull request in one is looking at it in all of them.
 *
 * Bounded on write rather than swept on a timer: the only thing that grows
 * this record is reading rows, so that is the natural moment to drop the ones
 * read longest ago.
 */
export function useItemMemory(
  /** Set only in developer mode, where reminders are made to come round soon. */
  reminderOverrides: ReminderOverrides | null = null,
): ItemMemoryApi {
  const [stored, setStored] = useStorageValue('itemMemory')

  const update = useCallback(
    (change: (current: Record<string, ItemMemory>) => Record<string, ItemMemory>) => {
      setStored((current) => trim(change(current ?? {})))
    },
    [setStored],
  )

  const markSeen = useCallback(
    (items: readonly SearchItem[]) => {
      if (items.length === 0) return
      update((current) => {
        const next = { ...current }
        const seenAt = Date.now()

        for (const item of items) {
          const existing = next[item.id]
          // A reminder that has come round has done its job the moment the
          // reader looks at the row, so it retires itself rather than asking
          // to be dismissed twice. One still waiting is left alone: they asked
          // for this evening, and this is not it.
          const done = reminderState(existing, item, seenAt) === 'due'
          const { reminder, ...rest } = existing ?? {}
          next[item.id] = {
            ...rest,
            ...(done || !reminder ? {} : { reminder }),
            seen: signatureOf(item),
            seenAt,
          }
        }

        return next
      })
    },
    [update],
  )

  const remind = useCallback(
    (item: SearchItem, choice: ReminderChoice) => {
      update((current) => {
        const signature = signatureOf(item)
        const existing = current[item.id]
        return {
          ...current,
          [item.id]: {
            // Asking to be reminded is also having looked at it: the reminder
            // is what should speak next, not a mark left over from before.
            seen: signature,
            seenAt: Date.now(),
            ...(existing?.hiddenAt === undefined ? {} : { hiddenAt: existing.hiddenAt }),
            reminder: {
              dueAt: reminderDueAt(choice, new Date(), reminderOverrides),
              signature,
              setAt: Date.now(),
            },
          },
        }
      })
    },
    [reminderOverrides, update],
  )

  const clearReminder = useCallback(
    (item: SearchItem) => {
      update((current) => {
        const existing = current[item.id]
        if (!existing?.reminder) return current
        const { reminder, ...rest } = existing
        void reminder
        return { ...current, [item.id]: rest }
      })
    },
    [update],
  )

  const hide = useCallback(
    (item: SearchItem) => {
      update((current) => {
        const existing = current[item.id]
        return {
          ...current,
          [item.id]: {
            seen: existing?.seen ?? signatureOf(item),
            seenAt: existing?.seenAt ?? Date.now(),
            ...(existing?.reminder ? { reminder: existing.reminder } : {}),
            hiddenAt: Date.now(),
          },
        }
      })
    },
    [update],
  )

  const unhide = useCallback(
    (item: SearchItem) => {
      update((current) => {
        const existing = current[item.id]
        if (!existing) return current
        const { hiddenAt, ...rest } = existing
        void hiddenAt
        // Coming back is a fresh look, so a row hidden months ago does not
        // return covered in marks for everything that happened meanwhile.
        return { ...current, [item.id]: { ...rest, seen: signatureOf(item), seenAt: Date.now() } }
      })
    },
    [update],
  )

  return useMemo(
    () => ({ memory: stored ?? NOTHING, markSeen, remind, clearReminder, hide, unhide }),
    [clearReminder, hide, markSeen, remind, stored, unhide],
  )
}

function trim(memory: Record<string, ItemMemory>): Record<string, ItemMemory> {
  const entries = Object.entries(memory)
  if (entries.length <= MAX_REMEMBERED_ITEMS) return memory

  // A row with a reminder on it, or one the reader has hidden, is kept
  // whatever its age: dropping either would undo something they asked for.
  const weight = (entry: ItemMemory) =>
    Number(Boolean(entry.reminder)) + Number(entry.hiddenAt !== undefined)
  const ranked = entries.toSorted(
    ([, a], [, b]) => weight(b) - weight(a) || b.seenAt - a.seenAt,
  )
  return Object.fromEntries(ranked.slice(0, MAX_REMEMBERED_ITEMS))
}
