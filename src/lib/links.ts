import type { SearchItem, StackInfo } from './github/types'

/**
 * Turning rows into text someone else can read.
 *
 * A link is copied in three ways because it is pasted into three kinds of
 * place: rich text where the title should show and the URL should not, Markdown
 * where the source is the point, and a bare URL where anything else would be
 * noise. None of them is a default the others can be derived from, so each is
 * offered by name.
 */

/**
 * Markdown link text is delimited by brackets, so a title containing them
 * would end the link early — and a backslash would escape whatever followed.
 * Parentheses are left alone: they are only special in the URL half.
 */
function escapeLinkText(title: string): string {
  return title.replace(/([\\[\]])/g, '\\$1')
}

/** A URL with spaces or brackets in it needs wrapping, as Markdown allows. */
function escapeLinkTarget(url: string): string {
  return /[\s()]/.test(url) ? `<${url}>` : url
}

export function markdownLink(title: string, url: string): string {
  return `[${escapeLinkText(title)}](${escapeLinkTarget(url)})`
}

/**
 * Where a pull request sits in its stack, said the way the row says it. Kept
 * with the title rather than in the URL so a list of them reads in order even
 * once the links are followed and forgotten.
 */
export function stackSuffix(position: number, size: number): string {
  return ` <${position}/${size}>`
}

/**
 * One row's link, as Markdown. A stacked pull request carries its layer, since
 * that is the difference between "the fix" and "the third part of the fix".
 */
export function itemMarkdown(item: SearchItem): string {
  const title = item.stack
    ? `${item.title}${stackSuffix(item.stack.position, item.stack.size)}`
    : item.title
  return markdownLink(title, item.url)
}

/**
 * The whole stack, base first, one per line — the order the branches were
 * built in, which is the order anyone reading them will want to review them.
 * The row this was copied from is included: a stack is only legible as a whole.
 */
export function stackUrls(stack: StackInfo): string {
  return stack.entries.map((entry) => entry.url).join('\n')
}

export function stackMarkdown(stack: StackInfo): string {
  return stack.entries
    .map((entry) =>
      markdownLink(`${entry.title}${stackSuffix(entry.position, stack.size)}`, entry.url),
    )
    .join('\n')
}
