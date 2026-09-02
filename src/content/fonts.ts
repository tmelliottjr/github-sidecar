/**
 * The panel borrows github.com's font rather than shipping one of its own.
 *
 * Primer publishes the page's stack as a custom property on <html>, so it is
 * read from there instead of copied into our CSS: when GitHub changes the
 * stack — as it did when Mona Sans went to the front of it — the sidebar
 * follows on the next page load rather than on our next release.
 *
 * Borrowing the list is enough on its own because @font-face rules are scoped
 * to the document, not to a tree: whatever the page loads for its own text is
 * already available inside our shadow root, under the same family names. That
 * includes faces we could never ship ourselves, such as GitHub's patched
 * "Noto Sans Backtick Fix".
 */
const STACK_TOKEN = '--fontStack-sansSerif'

/**
 * Used where the token is missing: the options page, which is not github.com,
 * and any GitHub page old enough to predate the token. This is the stack as
 * github.com ships it today, minus the patched subset that only exists there.
 */
const FALLBACK_FONT_STACK =
  '"Mona Sans VF", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", ' +
  'Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"'

/** The font stack the surrounding page is using, if it publishes one. */
export function resolveFontStack(): string {
  const stack = getComputedStyle(document.documentElement)
    .getPropertyValue(STACK_TOKEN)
    .trim()

  return stack || FALLBACK_FONT_STACK
}
