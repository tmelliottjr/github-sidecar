import type { ItemMemory } from './attention'
import type { SoundName } from './sound'

export interface SavedQuery {
  id: string
  name: string
  /** GitHub search syntax, e.g. `is:open is:pr review-requested:@me`. */
  query: string
}

/**
 * Shape and placement, shared by every tab. Whether the panel is *showing* is
 * deliberately not part of this: that is per tab, and lives in the worker's
 * session storage instead. See `useTabOpen`.
 */
export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  collapsed: boolean
  /** When locked the window cannot be dragged or resized. */
  locked: boolean
  /** Docked mode pins the panel into the host page's left gutter. */
  docked: boolean
  /** Width of the docked panel, kept apart so undocking restores the float. */
  dockWidth: number
}

/**
 * What the panel does beyond listing rows. Every one of these costs the reader
 * something — a mark to learn, a keystroke to remember, a permission to grant —
 * so each is theirs to switch off, and the list reads the same without any of
 * them.
 */
export interface FeatureFlags {
  /** Mark rows that have changed since the reader last looked at them. */
  changes: boolean
  /** Say when a pull request has conflicts or has fallen behind its base. */
  mergeState: boolean
  /** List the checks that failed under the row, and link to them. */
  failingChecks: boolean
  /** Let the reader ask to be reminded about a row, by time or by change. */
  reminders: boolean
  /** Let a row be taken out of the list without losing sight of it. */
  hide: boolean
  /** Move through the list from the keyboard. */
  keyboard: boolean
  /** Filter and reorder the rows already loaded. */
  filter: boolean
  /** Count what is waiting on the toolbar icon. */
  badge: boolean
}

/**
 * Settings for working on the panel rather than with it. Kept apart from the
 * feature switches on purpose: those are choices about how the panel behaves,
 * and these make it behave *wrongly on purpose* so that behaviour can be seen
 * without waiting until tomorrow morning for it.
 */
export interface DeveloperSettings {
  enabled: boolean
  /**
   * How long each named reminder waits, in seconds, while developer mode is
   * on. The clock is otherwise the reader's own — "this evening" means this
   * evening — which is exactly what makes reminders hard to try out.
   */
  reminderSeconds: {
    hour: number
    evening: number
    tomorrow: number
    week: number
  }
}

/** Which sound each kind of notification makes, and how loudly. */
export interface SoundSettings {
  reminder: SoundName
  change: SoundName
  /** 0 to 1. Zero is the same as switching the sound off. */
  volume: number
}

/**
 * Everything about being interrupted, in one place, because that is how it is
 * decided: whether to speak at all, what to speak about, and what it sounds
 * like. Splitting these across a list of feature switches asked the reader to
 * hold the shape of it in their head.
 */
export interface NotificationSettings {
  /** The master switch. Needs Chrome's `notifications` permission. */
  enabled: boolean
  /** Speak when a reminder the reader set comes round. */
  reminders: boolean
  /** Speak when a row moves on its own. */
  changes: boolean
  /**
   * What each kind sounds like. `none` is how a kind is silenced — there is no
   * separate switch for sound, because "no sound" is one of the sounds.
   *
   * The panel plays these itself: whether Chrome's own notification makes a
   * noise is a matter for the operating system, and on macOS it is off unless
   * the reader has said otherwise — not something an extension can ask for,
   * but something it can do for itself.
   */
  sounds: SoundSettings
}

export interface Settings {
  token: string
  /** Polling cadence in milliseconds; 0 disables background refresh. */
  pollIntervalMs: number
  openIn: 'window' | 'tab'
  activeQueryId: string | null
  features: FeatureFlags
  notifications: NotificationSettings
  developer: DeveloperSettings
}

export interface StorageShape {
  settings: Settings
  savedQueries: SavedQuery[]
  windowState: WindowState
  /**
   * Node ids of items pinned to the top of the list, most recently pinned
   * first. Pins are kept apart from the queries that surface them so a pinned
   * row keeps its place whichever query it turns up in.
   */
  pinnedIds: string[]
  /** Keyed by node id. Trimmed on write, so it cannot grow without bound. */
  itemMemory: Record<string, ItemMemory>
}

export const DEFAULT_FEATURES: FeatureFlags = {
  changes: true,
  mergeState: true,
  failingChecks: true,
  reminders: true,
  hide: true,
  keyboard: true,
  filter: true,
  badge: true,
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  // Off by default: it needs a permission, and it speaks when nobody asked.
  enabled: false,
  // Once it is on, both kinds are worth hearing about; the reader can drop
  // either without losing the other.
  reminders: true,
  changes: true,
  sounds: {
    reminder: 'chime',
    change: 'ping',
    volume: 0.7,
  },
}

export const DEFAULT_SOUNDS: SoundSettings = {
  // The one asked for by name gets the fuller sound; the one that arrived on
  // its own is closer to punctuation.
  reminder: 'chime',
  change: 'ping',
  volume: 0.7,
}

export const DEFAULT_DEVELOPER: DeveloperSettings = {
  enabled: false,
  // Far enough apart to tell one from another, near enough to sit and watch.
  reminderSeconds: { hour: 30, evening: 60, tomorrow: 120, week: 300 },
}

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  pollIntervalMs: 60_000,
  openIn: 'tab',
  activeQueryId: 'review-requested',
  features: DEFAULT_FEATURES,
  notifications: DEFAULT_NOTIFICATIONS,
  developer: DEFAULT_DEVELOPER,
}

export const DEFAULT_QUERIES: SavedQuery[] = [
  {
    id: 'review-requested',
    name: 'Needs my review',
    query: 'is:open is:pr review-requested:@me archived:false',
  },
  {
    id: 'my-pull-requests',
    name: 'My pull requests',
    query: 'is:open is:pr author:@me archived:false',
  },
  {
    id: 'assigned',
    name: 'Assigned to me',
    query: 'is:open assignee:@me archived:false',
  },
]

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: -1,
  y: 88,
  width: 420,
  height: 580,
  collapsed: false,
  locked: false,
  docked: false,
  dockWidth: 380,
}

export const DEFAULTS: StorageShape = {
  settings: DEFAULT_SETTINGS,
  savedQueries: DEFAULT_QUERIES,
  windowState: DEFAULT_WINDOW_STATE,
  pinnedIds: [],
  itemMemory: {},
}

/** How many items are remembered. Oldest sightings are dropped first. */
export const MAX_REMEMBERED_ITEMS = 500

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fills in whatever a stored value has never heard of. Nested objects are
 * merged too, or a settings blob written before a feature existed would carry
 * `features` without it and switch it off for everyone who upgraded.
 *
 * Records whose keys are data rather than schema — `itemMemory` — have no
 * defaults to merge, so an empty default object leaves them untouched.
 */
export function withDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(stored) || !isPlainObject(defaults)) {
    return (stored === undefined ? defaults : (stored as T))
  }

  const merged: Record<string, unknown> = { ...defaults, ...stored }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (isPlainObject(fallback)) merged[key] = withDefaults(fallback, stored[key])
  }
  return merged as T
}

/**
 * Carries forward settings written before notifications were gathered into one
 * place. Without this, upgrading would silently switch off the one setting
 * that took a permission to turn on — the worst possible thing to lose
 * quietly, since its whole job is to speak up.
 */
export function migrateSettings(stored: Record<string, unknown>): Record<string, unknown> {
  const features = stored.features as Record<string, unknown> | undefined
  const current = (stored.notifications ?? {}) as Record<string, unknown>

  const legacy: Record<string, unknown> = {
    ...(typeof features?.notifications === 'boolean'
      ? { enabled: features.notifications }
      : {}),
    ...(stored.sounds ? { sounds: stored.sounds } : {}),
  }

  // A sound switched off has become a pair of silent sounds, since silence is
  // now one of the sounds rather than a switch beside them.
  const wasSilent = features?.sound === false || current.sound === false
  if (wasSilent) {
    const sounds = (current.sounds ?? legacy.sounds ?? DEFAULT_NOTIFICATIONS.sounds) as
      SoundSettings
    legacy.sounds = { ...sounds, reminder: 'none', change: 'none' }
  }

  if (Object.keys(legacy).length === 0) return stored

  // Anything already written under the new shape wins, except the sounds a
  // silenced switch has just spoken for.
  const { sound, ...keep } = current
  void sound
  return {
    ...stored,
    notifications: { ...keep, ...legacy, ...(wasSilent ? {} : keep) },
  }
}

export async function readStorage<K extends keyof StorageShape>(
  key: K,
): Promise<StorageShape[K]> {
  const result = await chrome.storage.local.get(key)
  const value = result[key] as StorageShape[K] | undefined
  if (value === undefined) return DEFAULTS[key]
  if (Array.isArray(value) || typeof value !== 'object') return value
  const stored =
    key === 'settings' ? migrateSettings(value as Record<string, unknown>) : value
  return withDefaults(DEFAULTS[key], stored)
}

export async function writeStorage<K extends keyof StorageShape>(
  key: K,
  value: StorageShape[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value })
}

export function createQueryId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`
}
