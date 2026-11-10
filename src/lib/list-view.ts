import type { ItemState, SearchItem, Stack, StackLayer } from './github/types'

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
export type GroupBy = 'none' | 'status' | 'author' | 'assignee' | 'repository'

export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'No grouping',
  status: 'By status',
  author: 'By author',
  assignee: 'By assignee',
  repository: 'By repository',
}

/** The label shown for the bucket that holds rows with no assignee. */
export const UNASSIGNED_LABEL = 'Unassigned'

/** The label shown for the bucket that holds rows with no author. */
const UNKNOWN_AUTHOR_LABEL = 'Unknown author'

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
export interface ItemGroup<T = SearchItem> {
  /** Identifies the group within the list; stable across renders. */
  key: string
  label: string
  /** An assignee's avatar, when the group stands for one; null otherwise. */
  avatarUrl: string | null
  items: T[]
}

/** A stack with two or more layers in the list, drawn as one row. */
export interface FoldedStack {
  /** `PullRequestStack` node id. */
  id: string
  /** The loaded layer closest to the base branch, which merges next. Gives the title and the group. */
  lead: SearchItem
  /** Loaded layers, from the base branch up. */
  layers: SearchItem[]
}

/** One row before grouping: a pull request or issue, or a stack standing for its loaded layers. */
export type ListEntry = { type: 'item'; item: SearchItem } | { type: 'stack'; stack: FoldedStack }

/** Where a row sits inside an expanded stack. */
export interface Nesting {
  stackId: string
  /** The layer position. Null for the loading and failure rows. */
  position: number | null
  isFirst: boolean
  isLast: boolean
}

/** What the panel holds for one stack. */
export interface StackView {
  stack: Stack | undefined
  isLoading: boolean
  isFailed: boolean
}

/**
 * One row the list draws: a section header, a pull request or issue, or a
 * stack. An expanded stack is followed by one row per layer. A grouped list is
 * flattened to these so a single virtual scroller can carry them together.
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
      /** Set when the row is a layer inside an expanded stack. */
      nesting: Nesting | null
    }
  | { type: 'stack'; key: string; groupKey: string | null; stack: FoldedStack }
  /** A layer of an expanded stack that is not one of the loaded rows. */
  | { type: 'layer'; key: string; groupKey: string | null; layer: StackLayer; nesting: Nesting }
  /** Stands in for the layers of an expanded stack while it loads, or after it failed to. */
  | {
      type: 'stack-status'
      key: string
      groupKey: string | null
      status: 'loading' | 'failed'
      nesting: Nesting
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
  state: ['open-pull-request', 'open-issue', 'draft', 'queued'],
}

const NO_VALUES: readonly string[] = []
const FAILING: readonly string[] = ['failing']
const OPEN_PULL_REQUEST: readonly string[] = ['open-pull-request']
const OPEN_ISSUE: readonly string[] = ['open-issue']
const DRAFT: readonly string[] = ['draft']
const QUEUED: readonly string[] = ['queued']
const NOBODY: readonly string[] = [UNASSIGNED]

function stateValues(item: SearchItem): readonly string[] {
  switch (item.state) {
    case 'open':
      return item.kind === 'issue' ? OPEN_ISSUE : OPEN_PULL_REQUEST
    case 'draft':
      return DRAFT
    case 'queued':
      return QUEUED
    default:
      return NO_VALUES
  }
}

function facetValues(item: SearchItem, facet: Facet): readonly string[] {
  switch (facet) {
    case 'review':
      // Needs review matches only pull requests that are open and ready for review.
      if (item.reviewDecision === 'REVIEW_REQUIRED' && item.state !== 'open') return NO_VALUES
      return item.reviewDecision ? [item.reviewDecision] : NO_VALUES
    case 'checks':
      // Both are drawn as the same red mark on the row.
      return item.checkState === 'FAILURE' || item.checkState === 'ERROR' ? FAILING : NO_VALUES
    case 'merge':
      return item.mergeState === 'conflicting' || item.mergeState === 'behind'
        ? [item.mergeState]
        : NO_VALUES
    case 'state':
      return stateValues(item)
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
 * `Unassigned` section, drawn last. Grouping by author works the same way,
 * with one author per row, and rows with no author fall into an
 * `Unknown author` section.
 */
export function groupItems(items: SearchItem[], groupBy: GroupBy): ItemGroup[] {
  return groupEntries(items, groupBy, (item) => item)
}

interface Person {
  login: string
  avatarUrl: string | null
}

const NO_PEOPLE: readonly Person[] = []

/** Groups any kind of entry by the row `itemOf` picks for it. */
function groupEntries<T>(
  entries: T[],
  groupBy: GroupBy,
  itemOf: (entry: T) => SearchItem,
): Array<ItemGroup<T>> {
  switch (groupBy) {
    case 'status':
      return groupByStatus(entries, itemOf)
    case 'author':
      return groupByPerson(entries, 'author', UNKNOWN_AUTHOR_LABEL, (entry) => {
        const { authorLogin, authorAvatarUrl } = itemOf(entry)
        return authorLogin ? [{ login: authorLogin, avatarUrl: authorAvatarUrl }] : NO_PEOPLE
      })
    case 'assignee':
      return groupByPerson(entries, 'assignee', UNASSIGNED_LABEL, (entry) => itemOf(entry).assignees)
    case 'repository':
      return groupByRepository(entries, itemOf)
    default:
      return []
  }
}

function groupByStatus<T>(entries: T[], itemOf: (entry: T) => SearchItem): Array<ItemGroup<T>> {
  const buckets = new Map<ItemState, T[]>()
  for (const entry of entries) {
    const { state } = itemOf(entry)
    const bucket = buckets.get(state)
    if (bucket) bucket.push(entry)
    else buckets.set(state, [entry])
  }

  return STATUS_ORDER.filter((state) => buckets.has(state)).map((state) => ({
    key: `status:${state}`,
    label: STATUS_LABELS[state],
    avatarUrl: null,
    items: buckets.get(state) ?? [],
  }))
}

function groupByRepository<T>(
  entries: T[],
  itemOf: (entry: T) => SearchItem,
): Array<ItemGroup<T>> {
  const buckets = new Map<string, T[]>()
  for (const entry of entries) {
    const { repository } = itemOf(entry)
    const bucket = buckets.get(repository)
    if (bucket) bucket.push(entry)
    else buckets.set(repository, [entry])
  }

  return [...buckets.keys()].toSorted((a, b) => a.localeCompare(b)).map((repository) => ({
    key: `repository:${repository}`,
    label: repository,
    avatarUrl: null,
    items: buckets.get(repository) ?? [],
  }))
}

/** Lists an entry under each person `peopleOf` gives it, with a section for entries that have nobody. */
function groupByPerson<T>(
  entries: T[],
  keyPrefix: 'author' | 'assignee',
  nobodyLabel: string,
  peopleOf: (entry: T) => readonly Person[],
): Array<ItemGroup<T>> {
  const buckets = new Map<string, T[]>()
  const avatars = new Map<string, string | null>()
  const nobody: T[] = []

  for (const entry of entries) {
    const people = peopleOf(entry)
    if (people.length === 0) {
      nobody.push(entry)
      continue
    }
    for (const person of people) {
      const bucket = buckets.get(person.login)
      if (bucket) bucket.push(entry)
      else buckets.set(person.login, [entry])
      if (!avatars.has(person.login)) avatars.set(person.login, person.avatarUrl)
    }
  }

  const groups: Array<ItemGroup<T>> = [...buckets.keys()]
    .toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((login) => ({
      key: `${keyPrefix}:${login}`,
      label: login,
      avatarUrl: avatars.get(login) ?? null,
      items: buckets.get(login) ?? [],
    }))

  // The rows with nobody are the list's leftovers, so they sit after the named
  // sections rather than jostling for a place among them.
  if (nobody.length > 0) {
    groups.push({ key: `${keyPrefix}:__none__`, label: nobodyLabel, avatarUrl: null, items: nobody })
  }

  return groups
}

/**
 * Folds every stack with two or more loaded layers into one entry, in the
 * slot of its first layer in list order. A stack with one loaded layer stays a
 * plain row.
 *
 * Folds pinned and unpinned rows together, so a layer from a later page or
 * from Pinned joins the same stack and never shows on its own. A stack lands
 * in `pinned` when any loaded layer is pinned, at its earliest pin, since
 * every pinned row comes first.
 */
export function foldStacks(
  pinned: SearchItem[],
  rest: SearchItem[],
): { pinned: ListEntry[]; rest: ListEntry[] } {
  const all = [...pinned, ...rest]
  const loaded = new Map<string, Map<string, SearchItem>>()
  for (const item of all) {
    if (!item.stack) continue
    const layers = loaded.get(item.stack.id) ?? new Map<string, SearchItem>()
    if (!layers.has(item.id)) layers.set(item.id, item)
    loaded.set(item.stack.id, layers)
  }

  const folded: { pinned: ListEntry[]; rest: ListEntry[] } = { pinned: [], rest: [] }
  const placed = new Set<string>()
  all.forEach((item, index) => {
    const target = index < pinned.length ? folded.pinned : folded.rest
    const stackId = item.stack?.id
    const layers = stackId ? loaded.get(stackId) : undefined
    if (!stackId || !layers || layers.size < 2) {
      target.push({ type: 'item', item })
      return
    }
    if (placed.has(stackId)) return
    placed.add(stackId)

    const ordered = [...layers.values()].toSorted(
      (a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0),
    )
    target.push({ type: 'stack', stack: { id: stackId, lead: ordered[0], layers: ordered } })
  })
  return folded
}

/** Each author of the rows once, in row order, with the first avatar any of their rows gives. */
export function authorsOf(items: readonly SearchItem[]): Array<{ login: string; avatarUrl: string | null }> {
  const authors = new Map<string, string | null>()
  for (const item of items) {
    if (item.authorLogin && !authors.get(item.authorLogin)) {
      authors.set(item.authorLogin, item.authorAvatarUrl)
    }
  }
  return [...authors].map(([login, avatarUrl]) => ({ login, avatarUrl }))
}

function leadOf(entry: ListEntry): SearchItem {
  return entry.type === 'item' ? entry.item : entry.stack.lead
}

function entryKey(entry: ListEntry): string {
  return entry.type === 'item' ? entry.item.id : `stack:${entry.stack.id}`
}

function entryRow(entry: ListEntry, key: string, groupKey: string | null): ListRow {
  return entry.type === 'item'
    ? { type: 'item', key, groupKey, item: entry.item, nesting: null }
    : { type: 'stack', key, groupKey, stack: entry.stack }
}

/** How many pull requests and issues the entries stand for. */
function countOf(entries: ListEntry[]): number {
  return entries.reduce(
    (total, entry) => total + (entry.type === 'item' ? 1 : entry.stack.layers.length),
    0,
  )
}

/**
 * Flattens the pinned and unpinned rows into the single list of headers and
 * rows the scroller draws, after folding stacks with `foldStacks`.
 *
 * Without a grouping the rows pass straight through, pinned ones first and
 * headerless, exactly as an ungrouped list has always looked. With one, the
 * pinned rows keep their place at the top under a `Pinned` header of their
 * own, and the rest fall into their sections below — a pinned row is never
 * also drawn among them. A stack joins the section of its lead layer, and a
 * header counts the pull requests and issues under it.
 */
export function buildRows(
  pinned: SearchItem[],
  rest: SearchItem[],
  groupBy: GroupBy,
): ListRow[] {
  const folded = foldStacks(pinned, rest)
  if (groupBy === 'none') {
    return [...folded.pinned, ...folded.rest].map((entry) => entryRow(entry, entryKey(entry), null))
  }

  const rows: ListRow[] = []

  if (folded.pinned.length > 0) {
    rows.push({ type: 'header', key: 'header:pinned', groupKey: 'pinned', label: 'Pinned', avatarUrl: null, count: countOf(folded.pinned) })
    for (const entry of folded.pinned) rows.push(entryRow(entry, `pinned:${entryKey(entry)}`, 'pinned'))
  }

  for (const group of groupEntries(folded.rest, groupBy, leadOf)) {
    rows.push({
      type: 'header',
      key: `header:${group.key}`,
      groupKey: group.key,
      label: group.label,
      avatarUrl: group.avatarUrl,
      count: countOf(group.items),
    })
    for (const entry of group.items) {
      rows.push(entryRow(entry, `${group.key}:${entryKey(entry)}`, group.key))
    }
  }

  return rows
}

/**
 * The rows of one expanded stack, top layer first. Loaded layers are full
 * `item` rows and the rest are compact `layer` rows. Until the whole stack
 * loads only the loaded layers show, followed by a loading or failure row.
 */
function stackRows(
  row: Extract<ListRow, { type: 'stack' }>,
  view: StackView | undefined,
  shown: ReadonlySet<string>,
): ListRow[] {
  const loaded = new Map(row.stack.layers.map((item) => [item.id, item]))
  const taken = new Set(row.stack.layers.map((item) => item.stack?.position))
  const layers: Array<{ position: number; item: SearchItem } | { position: number; layer: StackLayer }> = []
  for (const layer of view?.stack?.layers ?? []) {
    const item = loaded.get(layer.id)
    if (item) {
      layers.push({ position: layer.position, item })
      loaded.delete(layer.id)
      continue
    }
    // An older copy of the stack can list a pull request at a position a loaded
    // row now holds, or one that shows in another row; neither shows twice.
    if (taken.has(layer.position) || shown.has(layer.id)) continue
    layers.push({ position: layer.position, layer })
  }
  // Loaded layers a stale copy of the stack does not list still show, at the
  // position their own row reports.
  for (const item of loaded.values()) layers.push({ position: item.stack?.position ?? 0, item })
  layers.sort((a, b) => b.position - a.position)

  const status = view?.isFailed && !view.isLoading ? 'failed' : view?.stack ? null : 'loading'
  const count = layers.length + (status ? 1 : 0)
  const nesting = (position: number | null, index: number): Nesting => ({
    stackId: row.stack.id,
    position,
    isFirst: index === 0,
    isLast: index === count - 1,
  })

  const rows: ListRow[] = layers.map((entry, index) =>
    'item' in entry
      ? {
          type: 'item',
          key: `${row.key}/${entry.item.id}`,
          groupKey: row.groupKey,
          item: entry.item,
          nesting: nesting(entry.position, index),
        }
      : {
          type: 'layer',
          key: `${row.key}/${entry.layer.id}`,
          groupKey: row.groupKey,
          layer: entry.layer,
          nesting: nesting(entry.position, index),
        },
  )
  if (status) {
    rows.push({
      type: 'stack-status',
      key: `${row.key}/status`,
      groupKey: row.groupKey,
      status,
      nesting: nesting(null, layers.length),
    })
  }
  return rows
}

/** Puts the rows of each expanded stack right after its stack row. */
export function expandStacks(
  rows: ListRow[],
  expanded: ReadonlySet<string>,
  views: ReadonlyMap<string, StackView>,
): ListRow[] {
  if (expanded.size === 0) return rows
  const shown = new Set(
    rows.flatMap((row) =>
      row.type === 'item'
        ? [row.item.id]
        : row.type === 'stack'
          ? row.stack.layers.map((layer) => layer.id)
          : [],
    ),
  )
  return rows.flatMap((row) =>
    row.type === 'stack' && expanded.has(row.stack.id)
      ? [row, ...stackRows(row, views.get(row.stack.id), shown)]
      : [row],
  )
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
