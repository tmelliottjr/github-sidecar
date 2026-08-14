import type { SearchItem, SearchPage } from './github/types'

/** A search page plus where it came from, so the UI can show data age. */
export interface CachedSearchPage extends SearchPage {
  source: 'cache' | 'network'
  /** True when a refresh is in flight and will arrive via `search-updated`. */
  revalidating: boolean
}

export type RequestMessage =
  | { type: 'search'; q: string; first: number; after?: string | null }
  | { type: 'invalidate'; q: string }
  | { type: 'refresh-item'; repository: string; number: number }
  | { type: 'tab-open' }
  | { type: 'set-tab-open'; open: boolean }
  | { type: 'validate-token'; token: string }
  | { type: 'open-item'; url: string; target: 'window' | 'tab' }
  | { type: 'open-options' }

export type ResponseMessage<T> = { ok: true; data: T } | { ok: false; error: string }

/** Broadcast from the toolbar action to every github.com tab. */
export interface ToggleMessage {
  type: 'toggle-sidebar'
}

/**
 * Broadcast when a background revalidation produces new data. Every open tab
 * updates from this instead of making its own request.
 */
export interface SearchUpdate {
  type: 'search-updated'
  query: string
  after: string | null
  page: SearchPage
}

/**
 * Broadcast after a single row is refreshed on demand. Sent to every tab, and
 * the worker patches its own cache too, so the next poll cannot serve a stale
 * copy back over the fresh one.
 */
export interface ItemUpdate {
  type: 'item-updated'
  item: SearchItem
}

export type BroadcastMessage = ToggleMessage | SearchUpdate | ItemUpdate

export type ResultFor<M extends RequestMessage> = M extends { type: 'search' }
  ? CachedSearchPage
  : M extends { type: 'validate-token' }
    ? { login: string }
    : M extends { type: 'refresh-item' }
      ? SearchItem
      : M extends { type: 'tab-open' }
        ? boolean
        : void

/**
 * Content scripts cannot call api.github.com directly because github.com's
 * CSP applies to their fetches, so every request is proxied through the
 * background service worker.
 */
export async function sendMessage<M extends RequestMessage>(
  message: M,
): Promise<ResultFor<M>> {
  const response = (await chrome.runtime.sendMessage(message)) as
    | ResponseMessage<ResultFor<M>>
    | undefined

  if (!response) {
    throw new Error('The extension background worker did not respond.')
  }
  if (!response.ok) {
    throw new Error(response.error)
  }
  return response.data
}
