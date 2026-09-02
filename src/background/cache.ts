import type { SearchItem, SearchPage } from '@/lib/github/types'

/**
 * Persistent search cache.
 *
 * This lives in the service worker on purpose: a content script's `indexedDB`
 * belongs to github.com's origin, so a cache written there would pollute the
 * host page's storage and would not be shared between tabs. The worker has its
 * own extension origin, giving every github.com tab one shared cache.
 */
const DB_NAME = 'github-sidecar'
/**
 * Bumped whenever a cached row gains a field the panel then reads.
 *
 * A cache holds a *shape* as well as a value, and a row written before a field
 * existed is not a hit for a panel that expects it — it is a row that will
 * crash the list. Dropping the store on upgrade costs one refetch and is the
 * only version of this that cannot be got wrong.
 */
const DB_VERSION = 3
const STORE = 'search-pages'
const QUERY_INDEX = 'query'
const UPDATED_INDEX = 'updatedAt'

export interface CacheEntry {
  /** Built by the search service; see cacheKey there. */
  key: string
  query: string
  page: SearchPage
  updatedAt: number
}

export interface CacheStore {
  read(key: string): Promise<CacheEntry | undefined>
  /** Every page cached for one query, in no particular order. */
  readQuery(query: string): Promise<CacheEntry[]>
  write(entry: CacheEntry): Promise<void>
  deleteQuery(query: string): Promise<void>
  prune(maxAgeMs: number): Promise<void>
  /** Replaces one row wherever it is cached. Returns how many pages changed. */
  updateItem(item: SearchItem): Promise<number>
  /**
   * Rewrites every cached page through `revise`, keeping the ones it changed.
   * `revise` returning null means the page was not one of them.
   *
   * Generic because what a revision *is* lives outside this module: the pages
   * are the cache's business, the rows in them are not.
   */
  revisePages(revise: (page: SearchPage) => SearchPage | null): Promise<number>
  /** Looks rows up by node id, wherever they happen to be cached. */
  findItems(ids: readonly string[]): Promise<SearchItem[]>
}

/** Swaps a refreshed row into a page, or returns null if it is not in it. */
export function replaceItem(page: SearchPage, item: SearchItem): SearchPage | null {
  const index = page.items.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) return null

  const items = [...page.items]
  items[index] = item
  return { ...page, items }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      // Rebuilt rather than migrated: every entry is re-fetchable, and one
      // wrong migration would put a row of the old shape on screen.
      if (database.objectStoreNames.contains(STORE)) database.deleteObjectStore(STORE)
      const store = database.createObjectStore(STORE, { keyPath: 'key' })
      store.createIndex(QUERY_INDEX, 'query', { unique: false })
      store.createIndex(UPDATED_INDEX, 'updatedAt', { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch((error: unknown) => {
    // Allow a later call to retry rather than caching the rejection forever.
    databasePromise = null
    throw error
  })

  return databasePromise
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE, mode)
  const result = await run(transaction.objectStore(STORE))

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
  return result
}

export const indexedDbStore: CacheStore = {
  async read(key) {
    return withStore('readonly', (store) =>
      promisify<CacheEntry | undefined>(store.get(key)),
    )
  },

  async write(entry) {
    await withStore('readwrite', (store) => promisify(store.put(entry)))
  },

  async readQuery(query) {
    return withStore('readonly', (store) =>
      promisify<CacheEntry[]>(store.index(QUERY_INDEX).getAll(query)),
    )
  },

  async findItems(ids) {
    const wanted = new Set(ids)
    if (wanted.size === 0) return []

    return withStore('readonly', async (store) => {
      const entries = await promisify<CacheEntry[]>(store.getAll())
      const found = new Map<string, SearchItem>()
      for (const entry of entries) {
        for (const item of entry.page.items) {
          if (wanted.has(item.id)) found.set(item.id, item)
        }
      }
      return [...found.values()]
    })
  },

  async deleteQuery(query) {
    await withStore('readwrite', async (store) => {
      const keys = await promisify(store.index(QUERY_INDEX).getAllKeys(query))
      await Promise.all(keys.map((key) => promisify(store.delete(key))))
    })
  },

  /**
   * A refreshed row has to land in the cache as well as on screen. Without
   * this the next poll would serve the stale cached page straight back over
   * it, and the refresh would appear to undo itself moments later.
   */
  async updateItem(item) {
    return withStore('readwrite', async (store) => {
      const entries = await promisify<CacheEntry[]>(store.getAll())
      // The entry's own age is left alone: one fresh row does not make the
      // rest of the page any newer than it was.
      const writes = entries
        .map((entry) => ({ entry, page: replaceItem(entry.page, item) }))
        .filter((candidate) => candidate.page !== null)
        .map(({ entry, page }) => promisify(store.put({ ...entry, page })))

      await Promise.all(writes)
      return writes.length
    })
  },

  /**
   * The second half of a page landing, or anything else that rewrites rows in
   * place. Written to the cache before it is broadcast, for the same reason a
   * single refreshed row is: a tab that reacts by asking for its page must not
   * be handed the copy this just replaced.
   */
  async revisePages(revise) {
    return withStore('readwrite', async (store) => {
      const entries = await promisify<CacheEntry[]>(store.getAll())
      // The entry's own age is left alone: this is the rest of the answer it
      // already holds, not a newer one.
      const writes = entries
        .map((entry) => ({ entry, page: revise(entry.page) }))
        .filter((candidate) => candidate.page !== null)
        .map(({ entry, page }) => promisify(store.put({ ...entry, page })))

      await Promise.all(writes)
      return writes.length
    })
  },

  async prune(maxAgeMs) {
    await withStore('readwrite', async (store) => {
      const cutoff = Date.now() - maxAgeMs
      const keys = await promisify(
        store.index(UPDATED_INDEX).getAllKeys(IDBKeyRange.upperBound(cutoff)),
      )
      await Promise.all(keys.map((key) => promisify(store.delete(key))))
    })
  },
}
