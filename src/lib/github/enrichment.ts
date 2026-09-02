import type { ItemEnrichment, SearchItem, SearchPage } from './types'

/**
 * Merging the two halves of a row.
 *
 * Kept apart from the GitHub client, and free of any import that runs, because
 * both the service worker and the panel do this: the worker to keep its cache
 * whole, the panel to update rows already on screen.
 */

/** What the second request answered, for a batch of rows. */
export interface ArrivedEnrichment {
  enrichments: readonly ItemEnrichment[]
  /** Rows GitHub would not answer for, so they can stop waiting. */
  failedIds: readonly string[]
}

/**
 * Merges the costly half into a row, field by field.
 *
 * By field rather than by swapping the whole row: the row this was asked for
 * may have been refreshed by a poll or by the reader in the seconds it took to
 * answer, and replacing it wholesale would put the older title, comment count
 * and head commit back on screen.
 */
export function applyEnrichment(item: SearchItem, enrichment: ItemEnrichment): SearchItem {
  return {
    ...item,
    reviewDecision: enrichment.reviewDecision,
    checkState: enrichment.checkState,
    failingChecks: enrichment.failingChecks,
    checkCount: enrichment.checkCount,
    checksRead: enrichment.checksRead,
    // `mergeable` reached the row with the search and may already have found a
    // conflict; this is the fuller answer and replaces it outright.
    mergeState: enrichment.mergeState,
    stack: enrichment.stack,
    enrichment: 'ready',
  }
}

/**
 * Applies a batch to whichever copy of each row a page is holding. Returns
 * null where the page held none of them, so callers can skip a write.
 */
export function mergeEnrichments(
  page: SearchPage,
  { enrichments, failedIds }: ArrivedEnrichment,
): SearchPage | null {
  const arrived = new Map(enrichments.map((entry) => [entry.id, entry]))
  const failed = new Set(failedIds)
  let touched = false

  const items = page.items.map((item) => {
    const enrichment = arrived.get(item.id)
    if (enrichment) {
      touched = true
      return applyEnrichment(item, enrichment)
    }
    // Marked unreadable whatever it held before, but its marks are left where
    // they are. `failed` says "this could not be read *this time*", not "there
    // is nothing to show": a row keeps the last answer anyone got for it while
    // the panel says out loud that it is no longer being told. Downgrading a
    // row that already had marks is the only way a repeated failure — a
    // repository the token has lost access to — is ever visible at all.
    if (failed.has(item.id) && item.enrichment !== 'failed') {
      touched = true
      return { ...item, enrichment: 'failed' as const }
    }
    return item
  })

  return touched ? { ...page, items } : null
}

/** The fields a row's second request fills in, and nothing else. */
function costlyHalf(item: SearchItem): ItemEnrichment {
  return {
    id: item.id,
    reviewDecision: item.reviewDecision,
    checkState: item.checkState,
    failingChecks: item.failingChecks,
    checkCount: item.checkCount,
    checksRead: item.checksRead,
    mergeState: item.mergeState,
    stack: item.stack,
  }
}

/**
 * Carries the costly half of every row a freshly fetched page has in common
 * with the copy it replaces.
 *
 * Without this a poll would blank the review, check and merge marks on every
 * row for as long as the second request takes, and put them straight back — a
 * list that flinches once a minute, saying nothing that was not already true.
 * The carried values are the previous answer, so the page is enriched again
 * regardless; this only decides what is on screen while that happens.
 */
export function carryEnrichment(fresh: SearchPage, previous: SearchPage | undefined): SearchPage {
  if (!previous) return fresh

  // A row that failed last time is carried too, marks and status both: it has
  // the last answer anyone got, and it is still not being told, so the notice
  // above the list has to survive the refresh that found the same thing again.
  const known = new Map(
    previous.items
      .filter((item) => item.enrichment !== 'pending')
      .map((item) => [item.id, { half: costlyHalf(item), state: item.enrichment }]),
  )
  if (known.size === 0) return fresh

  return {
    ...fresh,
    items: fresh.items.map((item) => {
      const carried = known.get(item.id)
      if (!carried || item.enrichment !== 'pending') return item
      return { ...applyEnrichment(item, carried.half), enrichment: carried.state }
    }),
  }
}
