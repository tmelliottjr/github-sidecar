import type { ItemState, SearchItem } from './github/types'

/**
 * How the rows already loaded are ordered. Deliberately not a GitHub `sort:`
 * qualifier: this reorders what is on screen without asking for anything, so
 * it costs no request and cannot lose the reader's place in a long list.
 */
export type SortOrder = 'default' | 'stalest' | 'repository'

export const SORT_LABELS: Record<SortOrder, string> = {
  default: 'Recently updated',
  stalest: 'Longest untouched',
  repository: 'By repository',
}

/**
 * How the rows already loaded are broken into sections. Like the sort order,
 * this only rearranges what is on screen: it groups the loaded rows under a
 * header each, without asking GitHub for anything.
 */
export type GroupBy = 'none' | 'status' | 'assignee' | 'repository'

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  status: 'By status',
  assignee: 'By assignee',
  repository: 'By repository',
}

/** The label shown for the bucket that holds rows with no assignee. */
export const UNASSIGNED_LABEL = 'Unassigned'

/**
 * The lifecycle states in the order their sections are drawn: what is still
 * open leads, and what is finished with trails.
 */
const STATUS_ORDER: readonly ItemState[] = ['open', 'draft', 'queued', 'merged', 'closed']

const STATUS_LABELS: Record<ItemState, string> = {
  open: 'Open',
  draft: 'Draft',
  queued: 'Queued to merge',
  merged: 'Merged',
  closed: 'Closed',
}

/** A section of the list: a header, and the rows that sit under it. */
export interface ItemGroup {
  /** Identifies the group within the list; stable across renders. */
  key: string
  label: string
  /** An assignee's avatar, when the group stands for one; null otherwise. */
  avatarUrl: string | null
  items: SearchItem[]
}

/**
 * One row the list draws: either a section header, or one of the items under
 * it. A grouped list is flattened to these so a single virtual scroller can
 * carry the headers and their rows together.
 */
export type ListRow =
  | {
      type: 'header'
      /** Unique among rows, so it can key the rendered element. */
      key: string
      /** The group this header stands for; what a collapse is keyed on. */
      groupKey: string
      label: string
      avatarUrl: string | null
      count: number
    }
  | {
      type: 'item'
      /** Unique among rows: an assignee's row appears once per assignee. */
      key: string
      /** The group the row sits under, or null when the list is ungrouped. */
      groupKey: string | null
      item: SearchItem
    }

/**
 * Matches a row against what the reader typed, across everything the row
 * shows: its title, where it lives, who wrote it, and its number. Terms are
 * ANDed so a second word narrows rather than widens, which is what typing
 * more of what you are looking for is meant to do.
 */
export function filterItems(items: SearchItem[], text: string): SearchItem[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return items

  return items.filter((item) => {
    const haystack = [
      item.title,
      item.repository,
      item.authorLogin ?? '',
      `#${item.number}`,
      ...item.labels.map((label) => label.name),
      ...item.assignees.map((assignee) => assignee.login),
    ]
      .join(' ')
      .toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

export function sortItems(items: SearchItem[], order: SortOrder): SearchItem[] {
  if (order === 'default') return items

  if (order === 'stalest') {
    // What has been waiting longest, which is what a review queue loses first.
    return items.toSorted((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
  }

  return items.toSorted(
    (a, b) => a.repository.localeCompare(b.repository) || a.number - b.number,
  )
}

/**
 * Breaks the rows into sections. The rows keep the order they arrive in, so
 * whatever `sortItems` did to them survives inside each section; only the
 * sections themselves are ordered, by what makes each grouping legible —
 * lifecycle for status, and name for the rest.
 *
 * Grouping by assignee lists a row under every assignee it has, so a shared
 * row appears in each of their sections. Rows with no assignee fall into one
 * `Unassigned` section, drawn last.
 */
export function groupItems(items: SearchItem[], groupBy: GroupBy): ItemGroup[] {
  switch (groupBy) {
    case 'status':
      return groupByStatus(items)
    case 'assignee':
      return groupByAssignee(items)
    case 'repository':
      return groupByRepository(items)
    default:
      return []
  }
}

function groupByStatus(items: SearchItem[]): ItemGroup[] {
  const buckets = new Map<ItemState, SearchItem[]>()
  for (const item of items) {
    const bucket = buckets.get(item.state)
    if (bucket) bucket.push(item)
    else buckets.set(item.state, [item])
  }

  return STATUS_ORDER.filter((state) => buckets.has(state)).map((state) => ({
    key: `status:${state}`,
    label: STATUS_LABELS[state],
    avatarUrl: null,
    items: buckets.get(state) ?? [],
  }))
}

function groupByRepository(items: SearchItem[]): ItemGroup[] {
  const buckets = new Map<string, SearchItem[]>()
  for (const item of items) {
    const bucket = buckets.get(item.repository)
    if (bucket) bucket.push(item)
    else buckets.set(item.repository, [item])
  }

  return [...buckets.keys()].toSorted((a, b) => a.localeCompare(b)).map((repository) => ({
    key: `repository:${repository}`,
    label: repository,
    avatarUrl: null,
    items: buckets.get(repository) ?? [],
  }))
}

function groupByAssignee(items: SearchItem[]): ItemGroup[] {
  const buckets = new Map<string, SearchItem[]>()
  const avatars = new Map<string, string | null>()
  const unassigned: SearchItem[] = []

  for (const item of items) {
    if (item.assignees.length === 0) {
      unassigned.push(item)
      continue
    }
    for (const assignee of item.assignees) {
      const bucket = buckets.get(assignee.login)
      if (bucket) bucket.push(item)
      else buckets.set(assignee.login, [item])
      if (!avatars.has(assignee.login)) avatars.set(assignee.login, assignee.avatarUrl)
    }
  }

  const groups: ItemGroup[] = [...buckets.keys()]
    .toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((login) => ({
      key: `assignee:${login}`,
      label: login,
      avatarUrl: avatars.get(login) ?? null,
      items: buckets.get(login) ?? [],
    }))

  // The unassigned rows are the list's leftovers, so they sit after the named
  // sections rather than jostling for a place among them.
  if (unassigned.length > 0) {
    groups.push({ key: 'assignee:__none__', label: UNASSIGNED_LABEL, avatarUrl: null, items: unassigned })
  }

  return groups
}

/**
 * Flattens the pinned and unpinned rows into the single list of headers and
 * items the scroller draws.
 *
 * Without a grouping the rows pass straight through, pinned ones first and
 * headerless, exactly as an ungrouped list has always looked. With one, the
 * pinned rows keep their place at the top under a `Pinned` header of their
 * own, and the rest fall into their sections below — a pinned row is never
 * also drawn among them.
 */
export function buildRows(
  pinned: SearchItem[],
  rest: SearchItem[],
  groupBy: GroupBy,
): ListRow[] {
  if (groupBy === 'none') {
    return [...pinned, ...rest].map((item) => ({ type: 'item', key: item.id, groupKey: null, item }))
  }

  const rows: ListRow[] = []

  if (pinned.length > 0) {
    rows.push({ type: 'header', key: 'header:pinned', groupKey: 'pinned', label: 'Pinned', avatarUrl: null, count: pinned.length })
    for (const item of pinned) rows.push({ type: 'item', key: `pinned:${item.id}`, groupKey: 'pinned', item })
  }

  for (const group of groupItems(rest, groupBy)) {
    rows.push({
      type: 'header',
      key: `header:${group.key}`,
      groupKey: group.key,
      label: group.label,
      avatarUrl: group.avatarUrl,
      count: group.items.length,
    })
    for (const item of group.items) {
      rows.push({ type: 'item', key: `${group.key}:${item.id}`, groupKey: group.key, item })
    }
  }

  return rows
}

/**
 * Drops the rows under any collapsed group, keeping every header so a folded
 * section can still be found and reopened, and its count still read. Ungrouped
 * rows carry no group key, so they are never folded away.
 */
export function collapseRows(rows: ListRow[], collapsed: ReadonlySet<string>): ListRow[] {
  if (collapsed.size === 0) return rows
  return rows.filter(
    (row) => row.type === 'header' || row.groupKey === null || !collapsed.has(row.groupKey),
  )
}

/**
 * Every group the rows are broken into, in the order their headers appear.
 * Empty when the list is flat, which is how "fold everything" knows there is
 * nothing to fold.
 */
export function groupKeysOf(rows: ListRow[]): string[] {
  return rows.flatMap((row) => (row.type === 'header' ? [row.groupKey] : []))
}
