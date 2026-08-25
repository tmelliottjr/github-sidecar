import type { WaitingItem } from './attention'
import { can } from './browser.ts'

/**
 * What a notification says, and what acting on it should do.
 *
 * Chrome gives a notification three pieces of text of decreasing weight, an
 * icon, and up to two buttons. Used carelessly that is a title reading
 * `acme/app #34` — the one thing the reader already knows, since they are the
 * one tracking it — and a body carrying everything else. So the item's own
 * title leads, what happened comes next, and where it lives goes in the dim
 * line underneath, which is the order the reader asks the questions in.
 *
 * Firefox gives a notification a title, a body, an icon that has to come from
 * the extension itself, and nothing else: no buttons, no list, no dim third
 * line, no say in how loud it is. What Chrome puts in the third line is folded
 * into the body there rather than dropped, because a notification naming a row
 * without saying which repository it is in is a notification that has to be
 * clicked to be understood.
 */
export interface Notification {
  options: chrome.notifications.NotificationCreateOptions
  /** What the notification is about, for whatever the reader clicks. */
  target: NotificationTarget
}

export interface NotificationTarget {
  /** Rows the buttons act on. */
  itemIds: string[]
  /** Where clicking the body goes, when there is one place to go. */
  url: string | null
  /** What the single button does, if there is one. */
  action: 'seen' | 'later' | null
}

/**
 * More than this many at once stop being news and start being a flood, so they
 * arrive as one notification listing them instead.
 */
export const MAX_INDIVIDUAL = 2

/** How many rows the grouped notification names before it starts counting. */
const MAX_LISTED = 5

/** Chrome's own priorities: 2 is as loud as an extension is allowed to be. */
const PRIORITY_REMINDER = 2
const PRIORITY_CHANGE = 0

/**
 * How much of a notification this browser will actually show. Defaults to the
 * answer for the browser this was built for; named so the tests can ask for
 * either without a bundler.
 */
export interface NotificationStyle {
  rich?: boolean
}

export function buildNotification(
  entry: WaitingItem,
  icon: string,
  { rich = can.richNotifications }: NotificationStyle = {},
): Notification {
  const { item, reason } = entry
  const isReminder = reason === 'reminder'

  const context = [
    `${item.repository} #${item.number}`,
    item.authorLogin ? `by ${item.authorLogin}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (!rich) {
    return {
      options: {
        type: 'basic',
        // Only an icon the extension ships with will load here, so the
        // author's face is not on offer.
        iconUrl: icon,
        title: item.title,
        message: `${entry.summary}\n${context}`,
      },
      target: {
        itemIds: [item.id],
        url: item.url,
        // No buttons, so nothing to press: clicking the body still opens the
        // row, which is the answer the reader wanted most of the time anyway.
        action: null,
      },
    }
  }

  return {
    options: {
      type: 'basic',
      // The author's face where there is one: a notification is recognised
      // before it is read, and every row here would otherwise carry the same
      // mark. Callers fall back to the extension's own icon if it will not
      // load.
      iconUrl: item.authorAvatarUrl ?? icon,
      title: item.title,
      message: entry.summary,
      contextMessage: context,
      eventTime: Date.now(),
      // A reminder was asked for by name, so it is allowed to interrupt and to
      // stay until it is dealt with. A change was not, so it is neither.
      priority: isReminder ? PRIORITY_REMINDER : PRIORITY_CHANGE,
      requireInteraction: isReminder,
      silent: !isReminder,
      buttons: [{ title: isReminder ? 'Remind me in an hour' : 'Mark as seen' }],
    },
    target: {
      itemIds: [item.id],
      url: item.url,
      action: isReminder ? 'later' : 'seen',
    },
  }
}

/**
 * Several at once, as one notification. Chrome's list type is made for exactly
 * this, and it keeps the count honest: five rows moving is one thing that
 * happened, not five. Where there is no list type the same rows are written
 * into the body instead, which says the same thing with less ceremony.
 */
export function buildGroupNotification(
  entries: readonly WaitingItem[],
  icon: string,
  {
    queryName,
    url,
    rich = can.richNotifications,
  }: { queryName: string | null; url: string | null } & NotificationStyle,
): Notification {
  const listed = entries.slice(0, MAX_LISTED)
  const rest = entries.length - listed.length
  const title = `${entries.length} rows need you`
  const lines = [
    ...listed.map((entry) => `${entry.item.repository} #${entry.item.number}`),
    ...(rest > 0 ? [`and ${rest} more`] : []),
  ]

  if (!rich) {
    return {
      options: {
        type: 'basic',
        iconUrl: icon,
        title,
        message: [...lines, queryName].filter(Boolean).join('\n'),
      },
      target: {
        itemIds: entries.map((entry) => entry.item.id),
        url,
        action: null,
      },
    }
  }

  return {
    options: {
      type: 'list',
      iconUrl: icon,
      title,
      // Repeated as the message because Chrome shows the list only where it
      // has the room, and a notification that says nothing without it is a
      // notification that sometimes says nothing.
      message: listed.map((entry) => `${entry.item.repository} #${entry.item.number}`).join(', '),
      contextMessage: queryName ?? 'GitHub Sidecar',
      items: [
        ...listed.map((entry) => ({
          title: `${entry.item.repository} #${entry.item.number}`,
          message: entry.summary,
        })),
        ...(rest > 0 ? [{ title: `and ${rest} more`, message: '' }] : []),
      ],
      eventTime: Date.now(),
      priority: entries.some((entry) => entry.reason === 'reminder')
        ? PRIORITY_REMINDER
        : PRIORITY_CHANGE,
      requireInteraction: false,
      silent: !entries.some((entry) => entry.reason === 'reminder'),
      buttons: [{ title: 'Mark all as seen' }],
    },
    target: {
      itemIds: entries.map((entry) => entry.item.id),
      url,
      action: 'seen',
    },
  }
}

/** The search that produced these rows, which is where "all of them" lives. */
export function searchUrl(query: string): string {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=issues`
}
