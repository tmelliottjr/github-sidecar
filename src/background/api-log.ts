import { browser } from '@/lib/browser'
import type { ApiCall } from '@/lib/github/api'
import type { ApiLogEntry } from '@/lib/messages'

/**
 * What the worker has asked GitHub, for developer mode to read back.
 *
 * Session storage rather than memory: the worker is shut down between
 * messages, and a log that is emptied every time it stops would never hold the
 * request anyone wants to look at. Session rather than local for the other
 * half of the same reason — this is for watching what is happening now, not a
 * record to keep, and it must not outlive the browser.
 */
const LOG_KEY = 'api-log'

/**
 * How many requests are kept. A refresh of one page is seven of them, so this
 * is roughly the last twenty refreshes: far enough back to catch what went
 * wrong, small enough to stay well inside the session storage quota.
 */
export const MAX_LOG_ENTRIES = 150

/**
 * Writes are serialised through this. Enrichment finishes its chunks at the
 * same moment by design, and read-modify-write on shared storage would drop
 * all but one of them.
 */
let queue: Promise<void> = Promise.resolve()

export async function readApiLog(): Promise<ApiLogEntry[]> {
  const stored = await browser.storage.session.get(LOG_KEY)
  const entries = stored[LOG_KEY]
  return Array.isArray(entries) ? (entries as ApiLogEntry[]) : []
}

/** Most recent first, which is the order it is read in. */
export function recordApiCall(call: ApiCall): Promise<void> {
  queue = queue
    .then(async () => {
      const entries = await readApiLog()
      const next = [{ ...call, at: Date.now() }, ...entries].slice(0, MAX_LOG_ENTRIES)
      await browser.storage.session.set({ [LOG_KEY]: next })
    })
    // A log that cannot be written must never take down the request it is
    // about, so this is the end of it.
    .catch(() => undefined)
  return queue
}

export async function clearApiLog(): Promise<void> {
  await browser.storage.session.remove(LOG_KEY)
}
