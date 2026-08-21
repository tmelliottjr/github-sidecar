import {
  reminderDueAt,
  signatureOf,
  type ItemMemory,
  type Reminder,
  type ReminderChoice,
  type ReminderOverrides,
} from './attention.ts'
import type { SearchItem } from './github/types'

/**
 * The reader's own record of a row, read back for management rather than for
 * the list. Everything here is keyed by node id and kept apart from the rows
 * themselves, so managing it — bringing a hidden row back, dropping a reminder,
 * lifting a pin — never depends on the row still being cached.
 */
export interface HiddenEntry {
  id: string
  hiddenAt: number
}

export interface ReminderEntry {
  id: string
  reminder: Reminder
}

/** Every row the reader has hidden, most recently hidden first. */
export function hiddenEntries(memory: Record<string, ItemMemory>): HiddenEntry[] {
  return Object.entries(memory)
    .flatMap(([id, entry]) =>
      entry.hiddenAt === undefined ? [] : [{ id, hiddenAt: entry.hiddenAt }],
    )
    .toSorted((a, b) => b.hiddenAt - a.hiddenAt)
}

/**
 * Every row carrying a reminder. Timed reminders lead, soonest due at the top,
 * so the next one to come round is the first one read; change reminders have no
 * clock to sort by and trail them, most recently set first.
 */
export function reminderEntries(memory: Record<string, ItemMemory>): ReminderEntry[] {
  return Object.entries(memory)
    .flatMap(([id, entry]) => (entry.reminder ? [{ id, reminder: entry.reminder }] : []))
    .toSorted((a, b) => {
      const first = a.reminder.dueAt
      const second = b.reminder.dueAt
      if (first === null && second === null) return b.reminder.setAt - a.reminder.setAt
      if (first === null) return 1
      if (second === null) return -1
      return first - second
    })
}

/**
 * Brings a hidden row back into the list. When the current row is known its
 * signature is taken as a fresh look, so a row hidden months ago does not
 * return covered in marks for everything that moved meanwhile — the same reset
 * the sidebar makes when it unhides. A no-op if the row was not hidden.
 */
export function unhideItem(
  memory: Record<string, ItemMemory>,
  id: string,
  item?: SearchItem,
  now = Date.now(),
): Record<string, ItemMemory> {
  const entry = memory[id]
  if (!entry || entry.hiddenAt === undefined) return memory

  const { hiddenAt, ...rest } = entry
  void hiddenAt
  const next = item ? { ...rest, seen: signatureOf(item), seenAt: now } : rest
  return { ...memory, [id]: next }
}

/** Drops a reminder, leaving the rest of what is remembered untouched. */
export function removeReminder(
  memory: Record<string, ItemMemory>,
  id: string,
): Record<string, ItemMemory> {
  const entry = memory[id]
  if (!entry?.reminder) return memory

  const { reminder, ...rest } = entry
  void reminder
  return { ...memory, [id]: rest }
}

/**
 * Sets a reminder to a different time without disturbing what it is measured
 * against: the signature is carried over, so a change reminder still judges
 * change from where it was first set. A no-op if there is no reminder to move.
 */
export function rescheduleReminder(
  memory: Record<string, ItemMemory>,
  id: string,
  choice: ReminderChoice,
  { overrides = null, now = new Date() }: { overrides?: ReminderOverrides | null; now?: Date } = {},
): Record<string, ItemMemory> {
  const entry = memory[id]
  if (!entry?.reminder) return memory

  return {
    ...memory,
    [id]: {
      ...entry,
      reminder: {
        dueAt: reminderDueAt(choice, now, overrides),
        signature: entry.reminder.signature,
        setAt: now.getTime(),
      },
    },
  }
}

/** Lifts a pin. A no-op if the row was not pinned. */
export function removePin(pinnedIds: readonly string[], id: string): string[] {
  return pinnedIds.filter((pin) => pin !== id)
}

/**
 * Slides a pin up or down the order the pinned rows are drawn in. `delta` is
 * -1 to move it towards the top and 1 towards the bottom. A no-op if the row
 * is not pinned or is already at the end it is being moved towards.
 */
export function movePin(pinnedIds: readonly string[], id: string, delta: number): string[] {
  const index = pinnedIds.indexOf(id)
  const target = index + delta
  if (index === -1 || target < 0 || target >= pinnedIds.length) return [...pinnedIds]

  const next = [...pinnedIds]
  next.splice(index, 1)
  next.splice(target, 0, id)
  return next
}
