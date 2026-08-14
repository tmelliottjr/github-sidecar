import { fetchItem, fetchViewer, searchIssues } from '@/lib/github/api'
import type { BroadcastMessage, RequestMessage, ResponseMessage } from '@/lib/messages'
import { readStorage } from '@/lib/storage'
import { indexedDbStore } from './cache'
import { createSearchService, freshnessWindow, MAX_CACHE_AGE_MS } from './search-service'
import { startDevReload } from './dev-reload'

const POPUP_WIDTH = 1100
const POPUP_HEIGHT = 900

/**
 * Whether the panel is showing is per tab, not per user.
 *
 * A new tab should start out of the way and cost nothing until it is asked
 * for, which rules out `chrome.storage.local`: that is shared, so opening the
 * panel once would open it in every tab thereafter. Session storage keyed by
 * tab id gives each tab its own answer, survives reloads and navigation within
 * that tab, and is gone when the browser is. It lives in the worker rather
 * than the page so nothing is written to github.com's own storage.
 */
const OPEN_KEY_PREFIX = 'tab-open:'

function openKey(tabId: number): string {
  return `${OPEN_KEY_PREFIX}${tabId}`
}

async function readTabOpen(tabId: number | undefined): Promise<boolean> {
  if (tabId == null) return false
  const key = openKey(tabId)
  const stored = await chrome.storage.session.get(key)
  return stored[key] === true
}

async function writeTabOpen(tabId: number | undefined, open: boolean): Promise<void> {
  if (tabId == null) return
  await chrome.storage.session.set({ [openKey(tabId)]: open })
}

async function requireToken(): Promise<string> {
  const { token } = await readStorage('settings')
  if (!token) throw new Error('Add a GitHub token in settings to load results.')
  return token
}

/**
 * Revalidation only happens for the tab the user is actually looking at.
 * Background tabs are served from IndexedDB.
 */
async function isTabActive(tabId: number | undefined): Promise<boolean> {
  if (tabId == null) return true
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab.active) return false
    const window = await chrome.windows.get(tab.windowId)
    return window.focused !== false
  } catch {
    return false
  }
}

async function broadcastToGitHubTabs(message: BroadcastMessage): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' })
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return
      // Fails harmlessly for tabs where the content script has not loaded.
      await chrome.tabs.sendMessage(tab.id, message).catch(() => undefined)
    }),
  )
}

const searchService = createSearchService({
  store: indexedDbStore,
  fetchPage: async (params) => searchIssues(await requireToken(), params),
  isTabActive,
  broadcast: (update) => void broadcastToGitHubTabs(update),
  onError: (error) => console.warn('[github-sidecar] revalidation failed', error),
})

async function openItem(url: string, target: 'window' | 'tab'): Promise<void> {
  if (target === 'tab') {
    await chrome.tabs.create({ url, active: true })
    return
  }

  // Offset from the current window so the popup does not land exactly on top.
  const current = await chrome.windows.getCurrent().catch(() => null)
  const left = current?.left != null ? current.left + 60 : undefined
  const top = current?.top != null ? current.top + 60 : undefined

  await chrome.windows.create({
    url,
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    ...(left != null ? { left } : {}),
    ...(top != null ? { top } : {}),
    focused: true,
  })
}

async function handle(
  message: RequestMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'search': {
      const { pollIntervalMs } = await readStorage('settings')
      return searchService.search({
        q: message.q,
        first: message.first,
        after: message.after,
        tabId: sender.tab?.id,
        freshMs: freshnessWindow(pollIntervalMs),
      })
    }
    case 'invalidate': {
      await searchService.invalidate(message.q)
      return undefined
    }
    case 'refresh-item': {
      const item = await fetchItem(await requireToken(), {
        repository: message.repository,
        number: message.number,
      })
      // Patch the shared cache before telling anyone, so a tab that reacts by
      // asking for its page cannot be handed the copy this just replaced.
      await indexedDbStore.updateItem(item).catch((error: unknown) => {
        console.warn('[github-sidecar] could not cache the refreshed item', error)
      })
      await broadcastToGitHubTabs({ type: 'item-updated', item })
      return item
    }
    case 'validate-token': {
      const login = await fetchViewer(message.token)
      return { login }
    }
    case 'open-item': {
      await openItem(message.url, message.target)
      return undefined
    }
    case 'tab-open': {
      return readTabOpen(sender.tab?.id)
    }
    case 'set-tab-open': {
      await writeTabOpen(sender.tab?.id, message.open)
      return undefined
    }
    case 'open-options': {
      // Content scripts cannot call openOptionsPage themselves.
      await chrome.runtime.openOptionsPage()
      return undefined
    }
  }
}

chrome.runtime.onMessage.addListener((message: RequestMessage, sender, sendResponse) => {
  handle(message, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies ResponseMessage<unknown>))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ResponseMessage<never>),
    )

  // Keeps the message channel open for the async response above.
  return true
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return
  chrome.tabs.sendMessage(tab.id, { type: 'toggle-sidebar' }).catch(() => {
    // The content script is not injected on non-github.com tabs.
  })
})

// Tab ids are reused, so a closed tab's flag has to go with it or the next
// tab to take that id would inherit a panel it never opened.
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(openKey(tabId)).catch(() => undefined)
})

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  void indexedDbStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
  if (reason !== 'install') return
  const { token } = await readStorage('settings')
  if (!token) await chrome.runtime.openOptionsPage()
})

chrome.runtime.onStartup.addListener(() => {
  void indexedDbStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
})

// Compiled away entirely in a production build.
if (import.meta.env.MODE === 'development') startDevReload()
