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

export interface Settings {
  token: string
  /** Polling cadence in milliseconds; 0 disables background refresh. */
  pollIntervalMs: number
  openIn: 'window' | 'tab'
  activeQueryId: string | null
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
}

export const DEFAULT_SETTINGS: Settings = {
  token: '',
  pollIntervalMs: 60_000,
  openIn: 'tab',
  activeQueryId: 'review-requested',
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
}

export async function readStorage<K extends keyof StorageShape>(
  key: K,
): Promise<StorageShape[K]> {
  const result = await chrome.storage.local.get(key)
  const value = result[key] as StorageShape[K] | undefined
  if (value === undefined) return DEFAULTS[key]
  // Merge objects so newly added fields pick up their defaults.
  if (Array.isArray(value) || typeof value !== 'object') return value
  return { ...(DEFAULTS[key] as object), ...(value as object) } as StorageShape[K]
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
