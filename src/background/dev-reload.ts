/**
 * Dev-only live reload. This lives in the service worker rather than the
 * content script because github.com's CSP governs content script fetches and
 * would block a connection to localhost.
 *
 * Chrome does not pick up content script edits without reloading the
 * extension, so a rebuild reloads the extension and then refreshes any
 * github.com tabs. State that matters (window position, saved queries,
 * settings) lives in extension storage and survives the reload.
 */
import { browser } from '@/lib/browser'

const PENDING_KEY = 'devReloadPending'
const RETRY_DELAY_MS = 2000

interface PendingReload {
  /** The build this worker reloaded for, used to detect a missed rebuild. */
  buildId: string
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function reloadGitHubTabs(): Promise<void> {
  const tabs = await browser.tabs.query({ url: 'https://github.com/*' })
  await Promise.all(
    tabs.map((tab) => (tab.id == null ? undefined : browser.tabs.reload(tab.id))),
  )
}

/**
 * Runs when the worker restarts after a reload we triggered. Returns the build
 * we reloaded for so the watcher can tell whether anything landed since; the
 * pages and content bundles are produced by two separate builds, and the
 * second can finish after the reload has already begun.
 */
async function finishPendingReload(): Promise<string | null> {
  const stored = await browser.storage.local.get(PENDING_KEY)
  const pending = stored[PENDING_KEY] as PendingReload | undefined
  if (!pending) return null

  // Clear first so a failure below cannot cause a reload loop.
  await browser.storage.local.remove(PENDING_KEY)
  await reloadGitHubTabs()
  return pending.buildId
}

async function watchForRebuilds(knownBuildId: string | null): Promise<void> {
  let buildId = knownBuildId

  for (;;) {
    try {
      // The server holds this request open until the next rebuild, so there is
      // no polling loop and the worker stays alive while you work.
      const response = await fetch(
        `${__DEV_RELOAD_ORIGIN__}/wait?id=${encodeURIComponent(buildId ?? '')}`,
      )
      const { id } = (await response.json()) as { id: string }

      if (buildId !== null && id !== buildId) {
        console.info('[dev] rebuild detected, reloading extension')
        await browser.storage.local.set({
          [PENDING_KEY]: { buildId: id } satisfies PendingReload,
        })
        browser.runtime.reload()
        return
      }
      buildId = id
    } catch {
      // The dev server is not running yet, or has stopped. Keep trying quietly.
      await delay(RETRY_DELAY_MS)
    }
  }
}

export function startDevReload(): void {
  void finishPendingReload().then(watchForRebuilds)
}
