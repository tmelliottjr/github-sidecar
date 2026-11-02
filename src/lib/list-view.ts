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

/** What the quick filter narrows the loaded rows by. */
export type Facet = 'review' | 'checks' | 'merge' | 'state' | 'author' | 'assignee'

/** In the order the filter menu lists them. */
export const FACETS: readonly Facet[] = ['review', 'checks', 'merge', 'state', 'author', 'assignee']

/**
 * The values chosen for each facet. A row passes when it has a chosen value in
 * every facet that has any: values within a facet widen the list, and facets
 * narrow each other.
 */
export type QuickFilter = Partial<Record<Facet, readonly string[]>>

/** The assignee value for rows with no assignee. No GitHub login is empty. */
export const UNASSIGNED = ''

/** Every value a status facet can offer, in menu order. People facets offer whoever the rows hold. */
const STATUS_VALUES: Partial<Record<Facet, readonly string[]>> = {
  review: ['REVIEW_REQUIRED', 'APPROVED', 'CHANGES_REQUESTED'],
  checks: ['failing'],
  merge: ['conflicting', 'behind'],
  state: ['draft'],
}

const NO_VALUES: readonly string[] = []
const FAILING: readonly string[] = ['failing']
const DRAFT: readonly string[] = ['draft']
const NOBODY: readonly string[] = [UNASSIGNED]

function facetValues(item: SearchItem, facet: Facet): readonly string[] {
  switch (facet) {
    case 'review':
      return item.reviewDecision ? [item.reviewDecision] : NO_VALUES
    case 'checks':
      // Both are drawn as the same red mark on the row.
      return item.checkState === 'FAILURE' || item.checkState === 'ERROR' ? FAILING : NO_VALUES
    case 'merge':
      return item.mergeState === 'conflicting' || item.mergeState === 'behind'
        ? [item.mergeState]
        : NO_VALUES
    case 'state':
      return item.state === 'draft' ? DRAFT : NO_VALUES
    case 'author':
      return item.authorLogin ? [item.authorLogin] : NO_VALUES
    case 'assignee':
      return item.assignees.length > 0 ? item.assignees.map((assignee) => assignee.login) : NOBODY
  }
}

function choicesOf(filter: QuickFilter): Array<[Facet, ReadonlySet<string>]> {
  return FACETS.flatMap((facet): Array<[Facet, ReadonlySet<string>]> => {
    const values = filter[facet]
    return values && values.length > 0 ? [[facet, new Set(values)]] : []
  })
}

function matchesChoice(item: SearchItem, facet: Facet, values: ReadonlySet<string>): boolean {
  return facetValues(item, facet).some((value) => values.has(value))
}

/** Whether any facet has a value chosen. */
export function isQuickFiltered(filter: QuickFilter): boolean {
  return FACETS.some((facet) => (filter[facet]?.length ?? 0) > 0)
}

/** Adds `value` to the facet, or removes it when it is already chosen. */
export function toggleQuickFilter(filter: QuickFilter, facet: Facet, value: string): QuickFilter {
  const current = filter[facet] ?? []
  const next = current.includes(value)
    ? current.filter((chosen) => chosen !== value)
    : [...current, value]
  return { ...filter, [facet]: next }
}

/** Keeps the rows that pass `filter`. Returns `items` itself when nothing is chosen. */
export function applyQuickFilter(items: SearchItem[], filter: QuickFilter): SearchItem[] {
  const choices = choicesOf(filter)
  if (choices.length === 0) return items
  return items.filter((item) =>
    choices.every(([facet, values]) => matchesChoice(item, facet, values)),
  )
}

/** One value the filter menu offers for a facet. */
export interface QuickFilterOption {
  value: string
  /** How many rows the list would show with this value chosen. */
  count: number
  selected: boolean
  /** The avatar for an author or assignee; null for everything else. */
  avatarUrl: string | null
}

/** The first avatar the rows give each login, as author or assignee. */
export function avatarsOf(items: SearchItem[]): Map<string, string> {
  const avatars = new Map<string, string>()
  for (const item of items) {
    if (item.authorLogin && item.authorAvatarUrl && !avatars.has(item.authorLogin)) {
      avatars.set(item.authorLogin, item.authorAvatarUrl)
    }
    for (const assignee of item.assignees) {
      if (assignee.avatarUrl && !avatars.has(assignee.login)) {
        avatars.set(assignee.login, assignee.avatarUrl)
      }
    }
  }
  return avatars
}

function tallies(): Record<Facet, Map<string, number>> {
  return {
    review: new Map(),
    checks: new Map(),
    merge: new Map(),
    state: new Map(),
    author: new Map(),
    assignee: new Map(),
  }
}

function tally(counts: Map<string, number>, values: readonly string[]) {
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
}

/**
 * The values each facet offers, and how many rows each would show.
 *
 * A value is offered when a row in `rows` has it, or when it is already
 * chosen, so a choice can always be taken back. Offering from `rows` rather
 * than `matching` keeps the menu steady while the reader types.
 *
 * Counts come from `matching`, the rows in `rows` that the typed text
 * matches. Each facet is counted with every other facet applied and its own
 * choices left out, so choosing one value never zeroes the values beside it.
 *
 * Status values keep a fixed order. People are ordered by how many rows they
 * have, then by login, with Unassigned last.
 */
export function quickFilterOptions(
  rows: SearchItem[],
  matching: SearchItem[],
  filter: QuickFilter,
): Record<Facet, QuickFilterOption[]> {
  const offered = tallies()
  for (const item of rows) {
    for (const facet of FACETS) tally(offered[facet], facetValues(item, facet))
  }

  // One pass over the rows: a row that fails no choice counts for every facet,
  // and a row that fails exactly one counts only for that facet.
  const choices = choicesOf(filter)
  const counts = tallies()
  for (const item of matching) {
    let missed: Facet | null = null
    let excluded = false
    for (const [facet, values] of choices) {
      if (matchesChoice(item, facet, values)) continue
      if (missed !== null) {
        excluded = true
        break
      }
      missed = facet
    }
    if (excluded) continue
    for (const facet of missed === null ? FACETS : [missed]) {
      tally(counts[facet], facetValues(item, facet))
    }
  }

  const avatars = avatarsOf(rows)
  const optionsFor = (facet: Facet): QuickFilterOption[] => {
    const total = offered[facet]
    const chosen = new Set(filter[facet] ?? [])
    const statusValues = STATUS_VALUES[facet]
    const values = statusValues
      ? statusValues.filter((value) => total.has(value) || chosen.has(value))
      : [...new Set([...total.keys(), ...chosen])].toSorted(
          (a, b) =>
            Number(a === UNASSIGNED) - Number(b === UNASSIGNED) ||
            (total.get(b) ?? 0) - (total.get(a) ?? 0) ||
            a.localeCompare(b, undefined, { sensitivity: 'base' }),
        )

    return values.map((value) => ({
      value,
      count: counts[facet].get(value) ?? 0,
      selected: chosen.has(value),
      avatarUrl: statusValues ? null : (avatars.get(value) ?? null),
    }))
  }

  return {
    review: optionsFor('review'),
    checks: optionsFor('checks'),
    merge: optionsFor('merge'),
    state: optionsFor('state'),
    author: optionsFor('author'),
    assignee: optionsFor('assignee'),
  }
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
