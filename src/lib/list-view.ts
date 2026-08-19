import type { SearchItem } from './github/types'

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
