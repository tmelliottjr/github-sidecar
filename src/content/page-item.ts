/**
 * What page of github.com the tab is on, watched rather than read once.
 *
 * The panel is present on every page of the site, so the row for whatever the
 * reader is currently looking at is usually somewhere in the list. Saying which
 * row that is costs nothing and answers a question the list otherwise leaves
 * open: is the thing I am reading one of the things I am tracking?
 */

/** An issue or pull request, as identified by its page's path. */
export interface PageItem {
  /** `owner/name`, exactly as GitHub spells it in the path. */
  repository: string
  number: number
}

/**
 * `/owner/name/pull/34/files` and `/owner/name/issues/34` both name the same
 * kind of thing. The tail is left unread: every tab of a pull request — files,
 * checks, a single commit — is still that pull request.
 *
 * Kind is not captured because it is not needed to match: issues and pull
 * requests share one sequence of numbers within a repository, and GitHub
 * redirects between the two paths freely.
 */
const ITEM_PATH = /^\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)(?:[/?#]|$)/

export function parsePageItem(pathname: string): PageItem | null {
  const match = ITEM_PATH.exec(pathname)
  if (!match) return null
  return { repository: match[1], number: Number(match[2]) }
}

export function samePageItem(a: PageItem | null, b: PageItem | null): boolean {
  if (!a || !b) return a === b
  return a.number === b.number && a.repository === b.repository
}

/**
 * Calls back whenever the tab's location changes, including the same-document
 * navigations that make up most of github.com's browsing.
 *
 * Several routes are watched at once because no single one covers the site.
 * The Navigation API sees every same-document navigation, but the panel runs
 * in an isolated world, where it may not be exposed; Turbo and pjax announce
 * their own; `popstate` covers the back button; and a title swap is the last
 * net under a `pushState` that announced nothing at all. Every route funnels
 * through the same check, so hearing about one navigation four times is
 * indistinguishable from hearing about it once.
 */
export function watchLocation(onChange: (href: string) => void): () => void {
  let last = location.href

  const check = () => {
    if (location.href === last) return
    last = location.href
    onChange(last)
  }

  const documentEvents = ['turbo:load', 'turbo:render', 'pjax:end'] as const
  const windowEvents = ['popstate', 'hashchange'] as const
  for (const event of documentEvents) document.addEventListener(event, check)
  for (const event of windowEvents) window.addEventListener(event, check)

  const navigation = (window as { navigation?: EventTarget }).navigation
  navigation?.addEventListener('currententrychange', check)

  // Turbo replaces the title element's text on every navigation, which makes
  // it a reliable stand-in where the events above are not fired.
  const title = document.querySelector('title')
  const observer = title ? new MutationObserver(check) : null
  observer?.observe(title as Node, { childList: true, characterData: true, subtree: true })

  return () => {
    for (const event of documentEvents) document.removeEventListener(event, check)
    for (const event of windowEvents) window.removeEventListener(event, check)
    navigation?.removeEventListener('currententrychange', check)
    observer?.disconnect()
  }
}
