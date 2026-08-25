import { GitHubApiError, fetchItem, fetchViewer, searchIssues } from '@/lib/github/api'
import type { BroadcastMessage, RequestMessage, ResponseMessage } from '@/lib/messages'
import {
  badgeText,
  nextReminderAt,
  pendingNotifications,
  signatureOf,
  uniqueItems,
  waitingItems,
  type WaitingItem,
} from '@/lib/attention'
import {
  buildGroupNotification,
  buildNotification,
  searchUrl,
  MAX_INDIVIDUAL,
  type Notification,
  type NotificationTarget,
} from '@/lib/notify'
import { readStorage, writeStorage, type SoundSettings } from '@/lib/storage'
import { browser, can, browserName } from '@/lib/browser'
import { playNotificationSound } from './audio'
import { indexedDbStore } from './cache'
import { createSearchService, freshnessWindow, MAX_CACHE_AGE_MS } from './search-service'
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

/**
 * Plays the panel's own notification sound.
 *
 * A browser's `silent: false` is a request, not an instruction: on macOS
 * whether a notification makes a noise is a system setting for the browser as
 * a whole, and an extension cannot reach it. A sound the reader asked this
 * panel for is therefore made by the panel, by whichever route the browser
 * leaves open — see `./audio`.
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
  await browser.storage.session.set({ [ANNOUNCED_KEY]: announced })
  if (send.length === 0) return

  const icon = browser.runtime.getURL('icon-128.png')
  const { notifications } = await readStorage('settings')
  // Whoever makes the sound, only one of them does: Chrome's own is asked for
  // only where the panel is not making its own. Each kind answers for itself,
  // so a silent change and a chiming reminder are both possible.
  const loudest = send.some((entry) => entry.reason === 'reminder') ? 'reminder' : 'change'
  const ourSound = willPlay(notifications.sounds, loudest)
  if (ourSound) void playSound(loudest)

  if (send.length > MAX_INDIVIDUAL) {
    const [settings, queries] = await Promise.all([
      readStorage('settings'),
      readStorage('savedQueries'),
    ])
    const active = queries.find((query) => query.id === settings.activeQueryId) ?? queries[0]
    await show(
      `${NOTIFICATION_PREFIX}group:${Date.now()}`,
      hush(
        buildGroupNotification(send, icon, {
          queryName: active?.name ?? null,
          url: active ? searchUrl(active.query) : null,
        }),
        ourSound,
      ),
      icon,
    )
    return
  }

  for (const entry of send) {
    const kind = entry.reason === 'reminder' ? 'reminder' : 'change'
    const ours = willPlay(notifications.sounds, kind)
    if (ours && kind !== loudest) void playSound(kind)

    // Sequential rather than parallel: two notifications raised in the same
    // instant arrive in whichever order Chrome feels like.
    // eslint-disable-next-line no-await-in-loop
    await show(
      `${NOTIFICATION_PREFIX}${entry.item.id}`,
      hush(buildNotification(entry, icon), ours),
      icon,
    )
  }
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
  return sounds[kind] !== 'none' && sounds.volume > 0
}

/** Silences Chrome's own sound when the panel is making one of its own. */
function hush(notification: Notification, ourSound: boolean): Notification {
  if (!ourSound) return notification
  return { ...notification, options: { ...notification.options, silent: true } }
}

/**
 * Raises one notification and remembers what it was about. An image that will
 * not load takes the whole notification down with it — Chrome refuses to show
 * one whose images it could not fetch — so a failure is retried rather than
 * lost.
 */
async function show(id: string, notification: Notification, icon: string): Promise<void> {
  await browser.storage.session.set({ [`${TARGET_PREFIX}${id}`]: notification.target })

  const options = avatarsLoad ? notification.options : { ...notification.options, iconUrl: icon }

  try {
    await browser.notifications.create(id, options)
  } catch {
    if (options.iconUrl === icon) return
    avatarsLoad = false
    await browser.notifications
      .create(id, { ...notification.options, iconUrl: icon })
      .catch(() => undefined)
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

  const items = await indexedDbStore.findItems(target.itemIds)
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
  const waiting = waitingItems(
    uniqueItems(entries.flatMap((entry) => entry.page.items)),
    memory,
    { reminders: features.reminders, hiding: features.hide },
  )

  await armReminderAlarm(features.reminders ? memory : {})

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
 * Sleeps until the next timed reminder, and stops waiting when there is none —
 * which includes the case where reminders have been switched off, since an
 * alarm that can only wake a feature nobody wants is worse than no alarm.
 */
async function armReminderAlarm(memory: Awaited<ReturnType<typeof readStorage<'itemMemory'>>>): Promise<void> {
  const due = nextReminderAt(memory)
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

const searchService = createSearchService({
  store: indexedDbStore,
  fetchPage: async (params) => searchIssues(await requireToken(), params),
  isTabActive,
  broadcast: (update) => {
    void broadcastToGitHubTabs(update)
    scheduleAttention()
  },
  onError: (error) => console.warn('[github-sidecar] revalidation failed', error),
})

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
      if (testSound) await playSound('reminder')
      const testIcon = browser.runtime.getURL('icon-128.png')
      await browser.notifications.create('sidecar-test', {
        type: 'basic',
        iconUrl: testIcon,
        title: 'Make the sidebar say what changed',
        // What the reader sees here is what they would see for a real row, so
        // on a browser that shows only a title and a body, so does this.
        ...(can.richNotifications
          ? {
              message: 'Reminder · 3 new comments',
              contextMessage: 'acme/app #34 · by octocat',
              eventTime: Date.now(),
              priority: 2,
              silent: testSound,
              buttons: [{ title: 'Remind me in an hour' }],
            }
          : { message: 'Reminder · 3 new comments\nacme/app #34 · by octocat' }),
      })
      return undefined
    }
    case 'open-options': {
      // Content scripts cannot call openOptionsPage themselves.
      await browser.runtime.openOptionsPage()
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
  void indexedDbStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
  if (reason !== 'install') return
  const { token } = await readStorage('settings')
  if (!token) await browser.runtime.openOptionsPage()
})

browser.runtime.onStartup.addListener(() => {
  void indexedDbStore.prune(MAX_CACHE_AGE_MS).catch(() => undefined)
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
