import type { CheckState, ItemState, ReviewDecision, SearchItem } from './github/types'

/**
 * What changed about an item since the reader last looked at it.
 *
 * A list that only reports state answers "what is true"; the reader has to
 * remember what was true last time to know whether anything needs them. These
 * are the changes worth being told about, and deliberately not every change:
 * GitHub bumps `updatedAt` when a label moves or a description is edited, and
 * a list that lit up for that would soon be ignored.
 */
export type ChangeKind = 'state' | 'review' | 'checks' | 'comments' | 'commits'

export interface ItemSignature {
  state: ItemState
  reviewDecision: ReviewDecision | null
  checkState: CheckState | null
  commentCount: number
  /** The head commit, which is what tells new pushes from everything else. */
  headRefOid: string | null
}

/**
 * When the reader asked to be reminded about a row.
 *
 * Two kinds, because there are two reasons to put something down: waiting on a
 * clock — read it after lunch — and waiting on the row itself, which is the
 * honest answer whenever "later" really means "once something happens".
 */
export interface Reminder {
  /** Epoch milliseconds, or null for one that waits for the row to change. */
  dueAt: number | null
  /** The state a change is measured against. */
  signature: ItemSignature
  setAt: number
}

/**
 * What the reader has already seen of an item, what they asked to be reminded
 * of, and whether they have hidden it. `seen` is a whole signature rather than
 * a timestamp: GitHub bumps `updatedAt` for edits nobody needs telling about,
 * so "changed" is defined by the handful of fields worth a second look.
 */
export interface ItemMemory {
  seen: ItemSignature
  seenAt: number
  reminder?: Reminder
  /** Set while the row is hidden from the list; cleared when it is restored. */
  hiddenAt?: number
}

export function signatureOf(item: SearchItem): ItemSignature {
  return {
    state: item.state,
    reviewDecision: item.reviewDecision,
    checkState: item.checkState,
    commentCount: item.commentCount,
    // Normalised rather than copied: a row cached before this field existed
    // has no head commit at all, and an absent one must compare equal to
    // itself rather than read as a push that never happened.
    headRefOid: item.headRefOid ?? null,
  }
}

/**
 * Ordered by how much each one asks of the reader, so a row with several
 * changes leads with the one most likely to need them. A merged pull request
 * outranks its own new comments; a comment outranks the push it came with.
 */
const ORDER: readonly ChangeKind[] = ['state', 'review', 'checks', 'comments', 'commits']

export function changesSince(
  seen: ItemSignature | undefined,
  item: SearchItem,
): ChangeKind[] {
  if (!seen) return []

  const now = signatureOf(item)
  const changed = new Set<ChangeKind>()

  if (now.state !== seen.state) changed.add('state')
  if (now.reviewDecision !== seen.reviewDecision) changed.add('review')
  if (now.checkState !== seen.checkState) changed.add('checks')
  // Only upwards: a deleted comment is not news, and would otherwise leave the
  // row permanently marked.
  if (now.commentCount > seen.commentCount) changed.add('comments')
  if (now.headRefOid && seen.headRefOid && now.headRefOid !== seen.headRefOid) {
    changed.add('commits')
  }

  return ORDER.filter((kind) => changed.has(kind))
}

const REVIEW_WORDS: Record<ReviewDecision, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review requested',
}

const CHECK_WORDS: Record<CheckState, string> = {
  SUCCESS: 'Checks passed',
  FAILURE: 'Checks failed',
  ERROR: 'Checks errored',
  PENDING: 'Checks running',
  EXPECTED: 'Checks queued',
}

const STATE_WORDS: Record<ItemState, string> = {
  open: 'Reopened',
  closed: 'Closed',
  merged: 'Merged',
  draft: 'Back to draft',
  queued: 'Queued to merge',
}

/** One change, said as what happened rather than as which field moved. */
export function describeChange(
  kind: ChangeKind,
  item: SearchItem,
  seen: ItemSignature,
): string {
  switch (kind) {
    case 'state':
      return STATE_WORDS[item.state]
    case 'review':
      return item.reviewDecision ? REVIEW_WORDS[item.reviewDecision] : 'Review cleared'
    case 'checks':
      return item.checkState ? CHECK_WORDS[item.checkState] : 'Checks cleared'
    case 'comments': {
      const count = item.commentCount - seen.commentCount
      return `${count} new ${count === 1 ? 'comment' : 'comments'}`
    }
    case 'commits':
      return 'New commits'
  }
}

export function describeChanges(
  kinds: readonly ChangeKind[],
  item: SearchItem,
  seen: ItemSignature,
): string {
  return kinds.map((kind) => describeChange(kind, item, seen)).join(' · ')
}

/** How the reader asked to be reminded, before it is turned into a time. */
export type ReminderChoice = 'hour' | 'evening' | 'tomorrow' | 'week' | 'change'

export const REMINDER_LABELS: Record<ReminderChoice, string> = {
  hour: 'In an hour',
  evening: 'This evening',
  tomorrow: 'Tomorrow morning',
  week: 'Next week',
  change: 'When it changes',
}

/**
 * What the menu entry says. With overrides in force the label would be a lie,
 * so it carries what will actually happen beside it rather than instead of it:
 * the choices stay where the fingers know them.
 */
export function reminderChoiceLabel(
  choice: ReminderChoice,
  overrides: ReminderOverrides | null = null,
): string {
  if (!overrides || choice === 'change') return REMINDER_LABELS[choice]
  const seconds = Math.max(0, overrides[choice])
  return `${REMINDER_LABELS[choice]} · ${seconds}s`
}

const EVENING_HOUR = 18
const MORNING_HOUR = 9

/** Seconds to wait for each named choice, while developer mode is on. */
export type ReminderOverrides = Record<Exclude<ReminderChoice, 'change'>, number>

/**
 * Turns a choice into a moment, in the reader's own clock. The named times are
 * rounded to the hour on purpose — nobody asking to be reminded "this evening"
 * means 18:07 — and always land in the future, so choosing "this evening" at
 * midnight means the evening that is coming rather than the one that has gone.
 *
 * Overrides replace the clock entirely, and are for working on reminders
 * rather than using them: "tomorrow morning" cannot be tried out tomorrow
 * morning.
 */
export function reminderDueAt(
  choice: ReminderChoice,
  now = new Date(),
  overrides: ReminderOverrides | null = null,
): number | null {
  if (choice === 'change') return null
  if (overrides) return now.getTime() + Math.max(0, overrides[choice]) * 1000
  if (choice === 'hour') return now.getTime() + 60 * 60_000

  const due = new Date(now)
  due.setMinutes(0, 0, 0)

  if (choice === 'evening') {
    due.setHours(EVENING_HOUR)
    if (due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1)
    return due.getTime()
  }

  due.setHours(MORNING_HOUR)
  due.setDate(due.getDate() + (choice === 'week' ? 7 : 1))
  return due.getTime()
}

export type ReminderState = 'none' | 'waiting' | 'due'

/**
 * Whether a reminder has come round yet. A timed one comes due on the clock; a
 * change reminder comes due when the row moves, judged by the same signature
 * as everything else here, so a reminder cannot miss the very thing it was set
 * for.
 */
export function reminderState(
  memory: ItemMemory | undefined,
  item: SearchItem,
  now = Date.now(),
): ReminderState {
  const reminder = memory?.reminder
  if (!reminder) return 'none'
  if (reminder.dueAt !== null) return now >= reminder.dueAt ? 'due' : 'waiting'
  return changesSince(reminder.signature, item).length > 0 ? 'due' : 'waiting'
}

/** What a waiting reminder is waiting for, said in the reader's own terms. */
export function describeReminder(reminder: Reminder, now = Date.now()): string {
  if (reminder.dueAt === null) return 'Reminder when this changes'
  if (now >= reminder.dueAt) return 'Reminder due'

  const due = new Date(reminder.dueAt)
  const sameDay = new Date(now).toDateString() === due.toDateString()
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return sameDay
    ? `Reminder at ${time}`
    : `Reminder on ${due.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} at ${time}`
}

/**
 * A hidden row is one the reader has said they do not want to see, which is
 * not the same as one they have dealt with: it stays counted, stays listed
 * where hidden rows are reviewed, and comes back the moment they say so.
 */
export function isHidden(memory: ItemMemory | undefined): boolean {
  return memory?.hiddenAt !== undefined
}

/** A row asking for the reader's attention, and why it is asking. */
export interface WaitingItem {
  item: SearchItem
  /** A reminder outranks a change: the reader asked for it by name. */
  reason: 'reminder' | 'change'
  changes: ChangeKind[]
  /** What happened, in the words the reader would be told. */
  summary: string
}

export interface WaitingOptions {
  now?: number
  /**
   * Whether reminders and hiding are switched on. Both are read here rather
   * than left to the panel: a feature the reader has switched off must stop
   * counting towards the toolbar and stop speaking, and a row they can plainly
   * see must go on being counted even if they hid it before changing their
   * mind about hiding rows at all.
   */
  reminders?: boolean
  hiding?: boolean
}

/**
 * What is waiting, worked out in the worker rather than in a panel.
 *
 * The count on the toolbar and the notification that something moved both have
 * to be right in a browser with no github.com tab open at all, which is
 * exactly when the panel is not running. Both therefore read the same cache
 * the panel does and the same record of what the reader has seen and asked to
 * be reminded of.
 */
export function waitingItems(
  items: readonly SearchItem[],
  memory: Record<string, ItemMemory>,
  { now = Date.now(), reminders = true, hiding = true }: WaitingOptions = {},
): WaitingItem[] {
  const waiting: WaitingItem[] = []

  for (const item of items) {
    const entry = memory[item.id]
    const seen = entry?.seen
    const changes = seen ? changesSince(seen, item) : []
    const summary = seen && changes.length > 0 ? describeChanges(changes, item, seen) : ''

    if (reminders && reminderState(entry, item, now) === 'due') {
      waiting.push({
        item,
        reason: 'reminder',
        changes,
        summary: summary ? `Reminder · ${summary}` : 'Reminder',
      })
      continue
    }

    // A hidden row is one the reader has said they do not want to see, so it
    // is not counted either — a reminder is the way to hear from one.
    if (changes.length === 0 || (hiding && isHidden(entry))) continue
    waiting.push({ item, reason: 'change', changes, summary })
  }

  return waiting
}

/** The same row can be on several cached pages; it is still one row. */
export function uniqueItems(items: readonly SearchItem[]): SearchItem[] {
  const byId = new Map<string, SearchItem>()
  for (const item of items) byId.set(item.id, item)
  return [...byId.values()]
}

/**
 * A change is one thing to be told about, however many times it is noticed. A
 * reminder coming due is its own thing to be told about, even when nothing
 * about the row itself has moved.
 */
export function waitingStamp(entry: WaitingItem): string {
  const signature = signatureOf(entry.item)
  return [
    entry.reason,
    signature.state,
    signature.reviewDecision ?? '-',
    signature.checkState ?? '-',
    signature.commentCount,
    signature.headRefOid ?? '-',
  ].join('|')
}

/**
 * Which of these have not been announced yet, and what to remember having
 * announced. A row that changes again is announced again; a row that is merely
 * still waiting is not, or every poll would repeat itself until the reader
 * happened to read it.
 */
export function pendingNotifications(
  waiting: readonly WaitingItem[],
  announced: Record<string, string>,
): { send: WaitingItem[]; announced: Record<string, string> } {
  const next: Record<string, string> = {}
  const send: WaitingItem[] = []

  for (const entry of waiting) {
    const stamp = waitingStamp(entry)
    next[entry.item.id] = stamp
    if (announced[entry.item.id] !== stamp) send.push(entry)
  }

  return { send, announced: next }
}

/**
 * When the next timed reminder comes round, so the worker can sleep until then
 * rather than poll for it. Change reminders need no alarm: they can only come
 * due when new results arrive, which wakes the worker anyway.
 */
export function nextReminderAt(
  memory: Record<string, ItemMemory>,
  now = Date.now(),
): number | null {
  let soonest: number | null = null

  for (const entry of Object.values(memory)) {
    const dueAt = entry.reminder?.dueAt
    if (dueAt == null || dueAt <= now) continue
    if (soonest === null || dueAt < soonest) soonest = dueAt
  }

  return soonest
}

/** Chrome's badge is four characters wide at best, so large counts round off. */
export function badgeText(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}
