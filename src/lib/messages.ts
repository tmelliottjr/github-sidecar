import { browser } from './browser.ts'
import type { ApiCall } from './github/api'
import type { ArrivedEnrichment } from './github/enrichment'
import type { ApiErrorKind, SearchItem, SearchPage } from './github/types'

/** One request the worker made, and when. Developer mode reads these. */
export interface ApiLogEntry extends ApiCall {
  /** Unix milliseconds, so the list can be read in order. */
  at: number
}

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
  /**
   * Resolves node ids to the rows behind them, from the worker's shared cache.
   * The management panel keeps only ids — a hidden row, a reminder, a pin are
   * each just a node id — so the title, repository and link it shows have to be
   * looked up from wherever the panel last saw the row. Ids the cache has since
   * dropped simply do not come back.
   */
  | { type: 'lookup-items'; ids: string[] }
  | { type: 'tab-open' }
  | { type: 'set-tab-open'; open: boolean }
  | { type: 'validate-token'; token: string }
  | { type: 'open-item'; url: string; target: 'window' | 'tab' }
  /** `section` scrolls the settings page to one part of itself. */
  | { type: 'open-options'; section?: string }
  /** Developer mode: proves the notification path end to end. */
  | { type: 'test-notification' }
  /** Developer mode: what the worker has asked GitHub, most recent first. */
  | { type: 'api-log' }
  | { type: 'clear-api-log' }

export type ResponseMessage<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; kind?: ApiErrorKind; retryable?: boolean }

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

/**
 * Broadcast when the costly half of some rows lands, or when it could not be
 * read. Carries the fields themselves rather than whole rows: the row it
 * belongs to may have been refreshed in the seconds it took to answer, and
 * merging by field is the only version of this that cannot put a stale title
 * back on screen.
 */
export interface EnrichmentUpdate extends ArrivedEnrichment {
  type: 'items-enriched'
}

export type BroadcastMessage =
  | ToggleMessage
  | SearchUpdate
  | ItemUpdate
  | EnrichmentUpdate

export type ResultFor<M extends RequestMessage> = M extends { type: 'search' }
  ? CachedSearchPage
  : M extends { type: 'validate-token' }
    ? { login: string }
    : M extends { type: 'refresh-item' }
      ? SearchItem
      : M extends { type: 'lookup-items' }
        ? SearchItem[]
        : M extends { type: 'tab-open' }
          ? boolean
          : M extends { type: 'api-log' }
            ? ApiLogEntry[]
            : void

/**
 * A failure that crossed the worker boundary. `browser.runtime.sendMessage`
 * flattens an Error to its message, so anything the panel needs in order to
 * react — whether retrying could help, whether to offer the settings page —
 * has to travel as its own field and be rebuilt here.
 */
export class RequestError extends Error {
  readonly kind: ApiErrorKind
  readonly retryable: boolean

  constructor(message: string, kind: ApiErrorKind = 'unknown', retryable = true) {
    super(message)
    this.name = 'RequestError'
    this.kind = kind
    this.retryable = retryable
  }
}

/**
 * Content scripts cannot call api.github.com directly because github.com's
 * CSP applies to their fetches, so every request is proxied through the
 * background service worker.
 */
export async function sendMessage<M extends RequestMessage>(
  message: M,
): Promise<ResultFor<M>> {
  const response = (await browser.runtime.sendMessage(message)) as
    | ResponseMessage<ResultFor<M>>
    | undefined

  if (!response) {
    throw new RequestError('The extension background worker did not respond.')
  }
  if (!response.ok) {
    throw new RequestError(response.error, response.kind, response.retryable ?? true)
  }
  return response.data
}
