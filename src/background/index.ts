import {
  GitHubApiError,
  enrichItems,
  fetchItem,
  fetchItems,
  fetchLayerReviews,
  fetchStacks,
  fetchViewer,
  observeApiCalls,
  searchIssues,
} from '@/lib/github/api'
import type { SearchItem } from '@/lib/github/types'
import type { BroadcastMessage, RequestMessage, ResponseMessage } from '@/lib/messages'
import {
  badgeText,
  forgetAnnounced,
  nextReminderAt,
  pendingNotifications,
  signatureOf,
  uniqueItems,
  unlistedReminderIds,
  waitingItems,
  type WaitingItem,
} from '@/lib/attention'
import {
  buildGroupNotification,
  buildNotification,
  searchUrl,
  MAX_INDIVIDUAL,
  type Notification,
  type NotificationEntry,
  type NotificationTarget,
} from '@/lib/notify'
import { carryEnrichment, mergeEnrichments } from '@/lib/github/enrichment'
import { readStorage, writeStorage, type SoundSettings } from '@/lib/storage'
import { browser, can, browserName } from '@/lib/browser'
import { clearApiLog, readApiLog, recordApiCall } from './api-log'
import { playNotificationSound } from './audio'
import {
  indexedDbItemStore,
  indexedDbLayerReviewStore,
  indexedDbStackStore,
  indexedDbStore,
} from './cache'
import { createSearchService, freshnessWindow, MAX_CACHE_AGE_MS } from './search-service'
import { createItemService, createLayerReviewService, createStackService } from './stack-service'
import { startDevReload } from './dev-reload'

const POPUP_WIDTH = 1100
const POPUP_HEIGHT = 900

/**
 * Whether the panel is showing is per tab, not per user.
 *
 * A new tab should start out of the way and cost nothing until it is asked
 * for, which rules out `browser.storage.local`: that is shared, so opening the
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
  const stored = await browser.storage.session.get(key)
  return stored[key] === true
}

async function writeTabOpen(tabId: number | undefined, open: boolean): Promise<void> {
  if (tabId == null) return
  await browser.storage.session.set({ [openKey(tabId)]: open })
}

async function requireToken(): Promise<string> {
  const { token } = await readStorage('settings')
  if (!token) {
    throw new GitHubApiError('Add a GitHub token in settings to load results.', {
      kind: 'auth',
    })
  }
  return token
}

/**
 * Revalidation only happens for the tab the user is actually looking at.
 * Background tabs are served from IndexedDB.
 */
async function isTabActive(tabId: number | undefined): Promise<boolean> {
  if (tabId == null) return true
  try {
    const tab = await browser.tabs.get(tabId)
    if (!tab.active) return false
    const window = await browser.windows.get(tab.windowId)
    return window.focused !== false
  } catch {
    return false
  }
}

async function broadcastToGitHubTabs(message: BroadcastMessage): Promise<void> {
  const tabs = await browser.tabs.query({ url: 'https://github.com/*' })
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return
      // Fails harmlessly for tabs where the content script has not loaded.
      await browser.tabs.sendMessage(tab.id, message).catch(() => undefined)
    }),
  )
}

/**
 * What has already been announced, keyed by node id. Session storage on
 * purpose: a browser that has been closed and reopened is a reader coming back
 * to their desk, and telling them what moved while they were away is the point
 * rather than a repetition.
 */
const ANNOUNCED_KEY = 'announced-changes'
/**
 * Notifications outlive the worker that raised them — it is shut down between
 * messages, and the click may be minutes later — so what each one is about is
 * written to session storage under its id rather than held in memory.
 */
const NOTIFICATION_PREFIX = 'sidecar:'
const TARGET_PREFIX = 'notification:'

/** How long a "remind me in an hour" from a notification button waits. */
const LATER_MS = 60 * 60_000

/** What **Send a test notification** shows: a reminder for a made-up row. */
const TEST_REMINDER: NotificationEntry = {
  item: {
    id: 'sidecar-test',
    title: 'Make the sidebar say what changed',
    url: 'https://github.com/acme/app/pull/34',
    repository: 'acme/app',
    number: 34,
    authorLogin: 'octocat',
    authorAvatarUrl: null,
  },
  reason: 'reminder',
  summary: 'Reminder · 3 new comments',
}

/**
 * Plays the panel's own notification sound. Chrome notifications make no
 * sound on macOS, whatever `silent` says, so the panel plays the sound the
 * reader picked itself; see `./audio`.
 */
async function playSound(kind: 'reminder' | 'change'): Promise<void> {
  const { notifications } = await readStorage('settings')
  const { sounds } = notifications
  if (!willPlay(sounds, kind)) return
  await playNotificationSound(sounds[kind], sounds.volume)
}

const BADGE_BACKGROUND = '#2f81f7'

/**
 * The one alarm the worker keeps, set for the next timed reminder. A service
 * worker is shut down between messages, so a reminder for this evening cannot
 * be a timer held in memory; and a single alarm re-armed each time is enough,
 * because the soonest reminder is the only one that can come due first.
 */
const REMINDER_ALARM = 'reminder-due'

/** How soon a row read for a due reminder is tried again after a network failure. */
const REMINDER_RETRY_MS = 60_000

async function activeQueryText(): Promise<string | null> {
  const [settings, queries] = await Promise.all([
    readStorage('settings'),
    readStorage('savedQueries'),
  ])
  if (queries.length === 0) return null
  const active = queries.find((query) => query.id === settings.activeQueryId)
  return (active ?? queries[0]).query
}

async function announce(waiting: readonly WaitingItem[]): Promise<void> {
  const stored = await browser.storage.session.get(ANNOUNCED_KEY)
  const previous = (stored[ANNOUNCED_KEY] ?? {}) as Record<string, string>
  const { send, announced } = pendingNotifications(waiting, previous)
  if (send.length === 0) {
    await browser.storage.session.set({ [ANNOUNCED_KEY]: announced })
    return
  }

  const icon = browser.runtime.getURL('icon-128.png')
  const { notifications } = await readStorage('settings')
  const shown: WaitingItem[] = []
  const failed: WaitingItem[] = []

  if (send.length > MAX_INDIVIDUAL) {
    const [settings, queries] = await Promise.all([
      readStorage('settings'),
      readStorage('savedQueries'),
    ])
    const active = queries.find((query) => query.id === settings.activeQueryId) ?? queries[0]
    const loudest = kindsIn(send)[0]
    try {
      await show(
        `${NOTIFICATION_PREFIX}group:${Date.now()}`,
        buildGroupNotification(send, icon, {
          queryName: active?.name ?? null,
          url: active ? searchUrl(active.query) : null,
          ownSound: willPlay(notifications.sounds, loudest),
        }),
        icon,
      )
      shown.push(...send)
    } catch (error) {
      console.warn('[github-sidecar] could not show a notification', error)
      failed.push(...send)
    }
  } else {
    for (const entry of send) {
      try {
        // Sequential rather than parallel: two notifications raised in the same
        // instant arrive in whichever order Chrome feels like.
        // eslint-disable-next-line no-await-in-loop
        await show(
          `${NOTIFICATION_PREFIX}${entry.item.id}`,
          buildNotification(entry, icon, {
            ownSound: willPlay(notifications.sounds, entry.reason),
          }),
          icon,
        )
        shown.push(entry)
      } catch (error) {
        console.warn('[github-sidecar] could not show a notification', error)
        failed.push(entry)
      }
    }
  }

  // Saved after showing, so a notification the browser refused is sent again
  // on the next pass instead of counting as announced.
  await browser.storage.session.set({ [ANNOUNCED_KEY]: forgetAnnounced(announced, failed) })

  // A group plays one sound, for its loudest kind; single notifications play
  // one for each kind shown. Chrome was asked for silence wherever these play.
  const kinds = kindsIn(shown)
  for (const kind of send.length > MAX_INDIVIDUAL ? kinds.slice(0, 1) : kinds) {
    void playSound(kind)
  }
}

/** The kinds among these entries, loudest first: a reminder was asked for. */
function kindsIn(entries: readonly WaitingItem[]): Array<WaitingItem['reason']> {
  return (['reminder', 'change'] as const).filter((kind) =>
    entries.some((entry) => entry.reason === kind),
  )
}

/**
 * Whether Chrome will fetch an avatar for us. Notifications are drawn by the
 * browser, not by a page, so the image is fetched with the extension's own
 * privileges — and github.com's avatar host is not one this extension asks for.
 * Where that is refused it is refused every time, so the first failure is
 * remembered and every notification after it goes straight to the icon that is
 * certainly there.
 */
let avatarsLoad = true

/** Whether the panel itself will make a noise for this kind of notification. */
function willPlay(sounds: SoundSettings, kind: 'reminder' | 'change'): boolean {
  return !can.systemNotificationSound && sounds[kind] !== 'none' && sounds.volume > 0
}

/**
 * Raises one notification and remembers what it was about. An image that will
 * not load takes the whole notification down with it — Chrome refuses to show
 * one whose images it could not fetch — so that failure is tried again with
 * the extension icon. Anything that still fails is thrown.
 */
async function show(id: string, notification: Notification, icon: string): Promise<void> {
  await browser.storage.session.set({ [`${TARGET_PREFIX}${id}`]: notification.target })

  const options = avatarsLoad ? notification.options : { ...notification.options, iconUrl: icon }

  try {
    await browser.notifications.create(id, options)
  } catch (error) {
    if (options.iconUrl === icon) throw error
    avatarsLoad = false
    await browser.notifications.create(id, { ...notification.options, iconUrl: icon })
  }
}

async function readTarget(id: string): Promise<NotificationTarget | null> {
  const stored = await browser.storage.session.get(`${TARGET_PREFIX}${id}`)
  return (stored[`${TARGET_PREFIX}${id}`] as NotificationTarget | undefined) ?? null
}

/**
 * What the notification's button does. Both answers are the ones the reader
 * would otherwise give by hand in the panel — clear it, or ask again later —
 * so both are written to the same record the panel reads, and the count on the
 * toolbar follows from that rather than being adjusted here.
 */
async function actOn(target: NotificationTarget): Promise<void> {
  if (!target.action) return

  const listed = await indexedDbStore.findItems(target.itemIds)
  const found = new Set(listed.map((item) => item.id))
  const missing = target.itemIds.filter((id) => !found.has(id))
  // A row read by id for its reminder can be in no cached page at all.
  const items =
    missing.length > 0 ? [...listed, ...(await indexedDbItemStore.read(missing))] : listed
  if (items.length === 0) return

  const memory = await readStorage('itemMemory')
  const now = Date.now()
  const next = { ...memory }

  for (const item of items) {
    const signature = signatureOf(item)
    const existing = next[item.id]

    next[item.id] =
      target.action === 'seen'
        ? { ...existing, seen: signature, seenAt: now }
        : {
            ...existing,
            seen: signature,
            seenAt: now,
            reminder: { dueAt: now + LATER_MS, signature, setAt: now },
          }

    // A reminder that has been answered — by either button — has done its job.
    if (target.action === 'seen') delete next[item.id].reminder
  }

  await writeStorage('itemMemory', next)
}

/**
 * Recounts what is waiting and says so on the toolbar, and — where the reader
 * has asked for it and granted the permission — out loud.
 *
 * Runs after anything that could change the answer: a refreshed page, a row
 * re-read on its own, and the reader marking rows as seen in any tab.
 */
async function refreshAttention(): Promise<void> {
  const settings = await readStorage('settings')
  const { features } = settings
  if (!features.badge && !settings.notifications.enabled) {
    await browser.action.setBadgeText({ text: '' })
    return
  }

  const query = await activeQueryText()
  if (!query) return

  const [entries, memory] = await Promise.all([
    indexedDbStore.readQuery(query),
    readStorage('itemMemory'),
  ])
  const listed = uniqueItems(entries.flatMap((entry) => entry.page.items))
  // Reminders belong to rows, not to the query that listed them. A merged pull
  // request leaves every `is:open` query in the same poll that makes its "when
  // it changes" reminder due, so rows the active query does not list are read
  // by id.
  const reminderIds = features.reminders ? unlistedReminderIds(memory, listed) : []
  const unlisted: SearchItem[] = []
  let retryAt: number | null = null
  if (reminderIds.length > 0) {
    const read = await itemService.items({
      ids: reminderIds,
      freshMs: freshnessWindow(settings.pollIntervalMs),
    })
    // A row never read by id can still sit in another query's cached pages.
    const cached = read.failedIds.length > 0 ? await indexedDbStore.findItems(read.failedIds) : []
    unlisted.push(...read.items, ...cached)
    // With no row to show, a reminder that has come round waits for the next
    // pass, and a timed one may have no other pass coming. A read that failed
    // on the network is worth another try soon; a refused token, a rate limit,
    // or a row GitHub would not return is not.
    const shown = new Set(cached.map((item) => item.id))
    if (read.retryIds.some((id) => !shown.has(id))) retryAt = Date.now() + REMINDER_RETRY_MS
  }
  const waiting = waitingItems(listed, memory, {
    reminders: features.reminders,
    hiding: features.hide,
    unlisted,
  })

  await armReminderAlarm(features.reminders ? memory : {}, retryAt)

  await browser.action.setBadgeText({
    text: features.badge ? badgeText(waiting.length) : '',
  })
  if (features.badge) {
    await browser.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND })
  }

  const { notifications } = settings
  if (!can.notifications || !notifications.enabled) return
  // The permission is optional and can be taken away from the browser's own
  // settings, which the switch in ours never hears about.
  const allowed = await browser.permissions.contains({ permissions: ['notifications'] })
  if (!allowed) return

  // Each kind can be switched off on its own. A row left out here is still
  // counted on the toolbar — it is the speaking that was declined, not the
  // knowing.
  await announce(
    waiting.filter((entry) =>
      entry.reason === 'reminder' ? notifications.reminders : notifications.changes,
    ),
  )
}

/**
 * Coalesces the recount. Ten tabs polling the same query all ask for this, and
 * the answer is the same for all of them: one pass now, and at most one more
 * afterwards for whatever arrived while it was running.
 */
let counting: Promise<void> | null = null
let recount = false

/**
 * Sleeps until the next timed reminder, or until `retryAt` where that is
 * sooner, and stops waiting when there is neither — which includes the case
 * where reminders have been switched off, since an alarm that can only wake a
 * feature nobody wants is worse than no alarm.
 */
async function armReminderAlarm(
  memory: Awaited<ReturnType<typeof readStorage<'itemMemory'>>>,
  retryAt: number | null = null,
): Promise<void> {
  const next = nextReminderAt(memory)
  const due = next === null ? retryAt : retryAt === null ? next : Math.min(next, retryAt)
  if (due === null) {
    await browser.alarms.clear(REMINDER_ALARM)
    return
  }

  const existing = await browser.alarms.get(REMINDER_ALARM)
  if (existing && Math.abs(existing.scheduledTime - due) < 1000) return
  browser.alarms.create(REMINDER_ALARM, { when: due })
}

function scheduleAttention(): void {
  if (counting) {
    recount = true
    return
  }

  counting = refreshAttention()
    .catch((error: unknown) => {
      console.warn('[github-sidecar] could not update what is waiting', error)
    })
    .finally(() => {
      counting = null
      if (!recount) return
      recount = false
      scheduleAttention()
    })
}

/**
 * Every request the panel makes is kept, whether or not developer mode is on:
 * the log is worth having for the refresh that already failed, and switching
 * the setting on afterwards cannot go back and record it.
 */
observeApiCalls((call) => void recordApiCall(call))

const searchService = createSearchService({
  store: indexedDbStore,
  fetchPage: async (params) => searchIssues(await requireToken(), params),
  enrichPage: async (ids) => enrichItems(await requireToken(), ids),
  // Merging lives outside the search service, which is run directly by the
  // test runner and so can import nothing that runs.
  merge: { apply: mergeEnrichments, carry: carryEnrichment },
  isTabActive,
  broadcast: (update) => {
    void broadcastToGitHubTabs(update)
    scheduleAttention()
  },
  onError: (error) => console.warn('[github-sidecar] revalidation failed', error),
})

const stackService = createStackService({
  store: indexedDbStackStore,
  fetchStacks: async (ids) => fetchStacks(await requireToken(), ids),
  broadcast: (update) => void broadcastToGitHubTabs(update),
  onError: (error) => console.warn('[github-sidecar] could not read stacks', error),
})

const layerReviewService = createLayerReviewService({
  store: indexedDbLayerReviewStore,
  fetchReviews: async (ids) => fetchLayerReviews(await requireToken(), ids),
  broadcast: (update) => void broadcastToGitHubTabs(update),
  onError: (error) => console.warn('[github-sidecar] could not read layer reviews', error),
})

const itemService = createItemService({
  store: indexedDbItemStore,
  fetchItems: async (ids) => fetchItems(await requireToken(), ids),
  // A row read by id replaces its copies in cached pages, as a refreshed row
  // does, so those queries and the notification buttons see it as it is now.
  onRead: (items) => {
    for (const { fetchedAt, ...item } of items) {
      void fetchedAt
      void indexedDbStore.updateItem(item).catch((error: unknown) => {
        console.warn('[github-sidecar] could not cache a row read by id', error)
      })
    }
  },
  onError: (error) => console.warn('[github-sidecar] could not read rows with reminders', error),
})

/** Drops cached pages, stacks, layer reviews, and rows read by id older than a day. */
function pruneCaches(): void {
  void indexedDbStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
  void indexedDbStackStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
  void indexedDbLayerReviewStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
  void indexedDbItemStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
}

async function openItem(url: string, target: 'window' | 'tab'): Promise<void> {
  if (target === 'tab') {
    await browser.tabs.create({ url, active: true })
    return
  }

  // Offset from the current window so the popup does not land exactly on top.
  const current = await browser.windows.getCurrent().catch(() => null)
  const left = current?.left != null ? current.left + 60 : undefined
  const top = current?.top != null ? current.top + 60 : undefined

  await browser.windows.create({
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
      scheduleAttention()
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
      scheduleAttention()
      return item
    }
    case 'stacks': {
      const { pollIntervalMs } = await readStorage('settings')
      return stackService.stacks({
        rows: message.rows,
        freshMs: freshnessWindow(pollIntervalMs),
      })
    }
    case 'layer-reviews': {
      const { pollIntervalMs } = await readStorage('settings')
      return layerReviewService.reviews({
        ids: message.ids,
        freshMs: freshnessWindow(pollIntervalMs),
      })
    }
    case 'lookup-items': {
      // Best-effort: rows the cache has dropped simply do not come back, and
      // the panel lists those by id and can still act on them without one.
      return indexedDbStore.findItems(message.ids)
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
    case 'test-notification': {
      if (!can.notifications) {
        throw new Error(
          `${browserName} has no notifications API for extensions, so there is nothing to test.`,
        )
      }
      const allowed = await browser.permissions.contains({ permissions: ['notifications'] })
      if (!allowed) {
        throw new Error(
          `${browserName} has not been given permission to post notifications. Switch desktop notifications on first.`,
        )
      }
      const { notifications: testNotifications } = await readStorage('settings')
      const testSound = willPlay(testNotifications.sounds, 'reminder')
      const testIcon = browser.runtime.getURL('icon-128.png')
      // Built like a real reminder, so the test takes the path reminders take.
      await show(
        'sidecar-test',
        buildNotification(TEST_REMINDER, testIcon, { ownSound: testSound }),
        testIcon,
      )
      if (testSound) await playSound('reminder')
      return undefined
    }
    case 'open-options': {
      // Content scripts cannot call openOptionsPage themselves, and that call
      // takes no fragment, so a request for one part of the page opens it by
      // URL instead.
      if (message.section) {
        await browser.tabs.create({
          url: browser.runtime.getURL(`options.html#${message.section}`),
          active: true,
        })
        return undefined
      }
      await browser.runtime.openOptionsPage()
      return undefined
    }
    case 'api-log': {
      return readApiLog()
    }
    case 'clear-api-log': {
      await clearApiLog()
      return undefined
    }
  }
}

browser.runtime.onMessage.addListener((message: RequestMessage, sender, sendResponse) => {
  handle(message, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies ResponseMessage<unknown>))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        // Only the message itself survives the channel, so what the panel is
        // meant to do about the failure travels beside it.
        ...(error instanceof GitHubApiError
          ? { kind: error.kind, retryable: error.retryable }
          : {}),
      } satisfies ResponseMessage<never>),
    )

  // Keeps the message channel open for the async response above.
  return true
})

browser.action.onClicked.addListener((tab) => {
  if (tab.id == null) return
  browser.tabs.sendMessage(tab.id, { type: 'toggle-sidebar' }).catch(() => {
    // The content script is not injected on non-github.com tabs.
  })
})

// Tab ids are reused, so a closed tab's flag has to go with it or the next
// tab to take that id would inherit a panel it never opened.
browser.tabs.onRemoved.addListener((tabId) => {
  void browser.storage.session.remove(openKey(tabId)).catch(() => undefined)
})

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  pruneCaches()
  if (reason !== 'install') return
  const { token } = await readStorage('settings')
  if (!token) await browser.runtime.openOptionsPage()
})

browser.runtime.onStartup.addListener(() => {
  pruneCaches()
  scheduleAttention()
})

// Marking rows as seen, switching query, or turning either feature off all
// change what is waiting without any request being made.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if ('itemMemory' in changes || 'settings' in changes) scheduleAttention()
})

// A reminder set for a time comes round with no request behind it, so the
// alarm is the only thing that can notice.
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REMINDER_ALARM) scheduleAttention()
})

function onNotificationClicked(id: string): void {
  if (!id.startsWith(NOTIFICATION_PREFIX)) return
  void (async () => {
    const target = await readTarget(id)
    await browser.notifications.clear(id)
    if (target?.url) await openItem(target.url, 'tab')
  })()
}

function onNotificationButton(id: string, button: number): void {
  if (!id.startsWith(NOTIFICATION_PREFIX) || button !== 0) return
  void (async () => {
    const target = await readTarget(id)
    await browser.notifications.clear(id)
    if (target) await actOn(target)
  })().catch((error: unknown) => {
    console.warn('[github-sidecar] could not act on a notification', error)
  })
}

/**
 * The whole `notifications` namespace is absent until the optional permission
 * is granted, so this cannot simply be wired up at startup — and it has to be
 * wired up the moment the permission arrives, without waiting for the worker
 * to be restarted. On a browser with no notifications at all there is nothing
 * here to wire.
 */
function watchNotificationClicks(): void {
  if (!can.notifications) return
  const clicked = browser.notifications?.onClicked
  if (!clicked || clicked.hasListener(onNotificationClicked)) return
  clicked.addListener(onNotificationClicked)
  // Only a notification that can carry a button can report one being pressed.
  if (can.richNotifications) {
    browser.notifications.onButtonClicked.addListener(onNotificationButton)
  }
}

watchNotificationClicks()
browser.permissions.onAdded.addListener(() => {
  watchNotificationClicks()
  scheduleAttention()
})
browser.permissions.onRemoved.addListener(scheduleAttention)

// Compiled away entirely in a production build.
if (import.meta.env.MODE === 'development') startDevReload()
