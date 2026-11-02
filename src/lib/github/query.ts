/**
 * Catching search syntax github.com accepts and the API does not.
 *
 * A query is copied out of the github.com search box and pasted in here, and
 * the two are not the same parser. `repo:a,b` lists both repositories on the
 * website; through `ISSUE_ADVANCED` it matches nothing at all and reports no
 * error, so the panel is empty and the query looks correct. Measured against
 * `repo:github/github-ui`: 661 rows on its own, 0 once a second repository is
 * appended after a comma.
 */

/**
 * Qualifiers verified to silently return zero when handed a comma list.
 *
 * An allowlist rather than a denylist, because the cost is asymmetric: a
 * qualifier missing from here costs advice that was never offered before,
 * while one wrongly added rewrites a query that worked. `label:`, `language:`
 * and `linked:` accept commas; `type:` and `sort:` return rows either way; and
 * a bare `https://host/a,b` in the search terms is not a qualifier at all.
 *
 * Each was measured against `ISSUE_ADVANCED` as `q:a` and `q:b` both non-zero
 * while `q:a,b` is zero.
 */
const SILENTLY_EMPTY = new Set([
  'assignee',
  'author',
  'base',
  'commenter',
  'head',
  'involves',
  'is',
  'mentions',
  'milestone',
  'no',
  'org',
  'repo',
  'review-requested',
  'reviewed-by',
  'state',
  'user',
])

/** Leading `(`, optional `-`, the qualifier, its value, then trailing `)`. */
const QUALIFIER = /^(\(*)(-?)([A-Za-z][A-Za-z0-9_-]*):(.*?)(\)*)$/

export interface QueryAdvice {
  /** Names of the qualifiers given a comma list, in the order they appear. */
  qualifiers: string[]
  /** The same query with each comma list written as an explicit group. */
  suggestion: string
}

/**
 * Splits on whitespace while keeping the runs of whitespace, so a rewritten
 * query reads back with the spacing it was typed with. Double quotes suspend
 * the split; single quotes do not, since an apostrophe in a search term is far
 * commoner than a single-quoted value.
 */
function segment(query: string): string[] {
  const segments: string[] = []
  let current = ''
  let quoted = false
  let spacing = false

  for (const char of query) {
    if (quoted) {
      current += char
      if (char === '"') quoted = false
      continue
    }
    const isSpace = /\s/.test(char)
    if (isSpace !== spacing && current) {
      segments.push(current)
      current = ''
    }
    spacing = isSpace
    if (char === '"') quoted = true
    current += char
  }
  if (current) segments.push(current)
  return segments
}

/** Commas inside a quoted value belong to the value. */
function splitValue(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false

  for (const char of value) {
    if (char === '"') quoted = !quoted
    if (char === ',' && !quoted) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

/**
 * A negated comma list excludes every value, so the group is joined with AND:
 * `-author:a,b` means neither, which is `(-author:a AND -author:b)`.
 */
function expand(negated: string, qualifier: string, values: string[]): string {
  const terms = values.map((value) => `${negated}${qualifier}:${value}`)
  return `(${terms.join(negated ? ' AND ' : ' OR ')})`
}

/**
 * Comma lists in `query` that will match nothing, and the query rewritten
 * without them. Null when there are none.
 */
export function commaListAdvice(query: string): QueryAdvice | null {
  const qualifiers: string[] = []

  const suggestion = segment(query)
    .map((token) => {
      const match = QUALIFIER.exec(token)
      if (!match) return token

      const [, open, negated, qualifier, value, close] = match
      if (!SILENTLY_EMPTY.has(qualifier.toLowerCase())) return token

      const values = splitValue(value).filter((part) => part.length > 0)
      if (values.length < 2) return token

      qualifiers.push(qualifier)
      return `${open}${expand(negated, qualifier, values)}${close}`
    })
    .join('')

  return qualifiers.length > 0 ? { qualifiers, suggestion } : null
}
