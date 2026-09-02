import { useEffect, useState } from 'react'

import { type PageItem, parsePageItem, samePageItem, watchLocation } from '@/content/page-item'

/**
 * The issue or pull request this tab is showing, or null anywhere else on the
 * site. The value keeps its identity while the page keeps its item, so moving
 * between a pull request's own tabs does not re-render the list.
 */
export function useCurrentPageItem(): PageItem | null {
  const [item, setItem] = useState<PageItem | null>(() =>
    typeof location === 'undefined' ? null : parsePageItem(location.pathname),
  )

  useEffect(
    () =>
      watchLocation((href) => {
        const next = parsePageItem(new URL(href).pathname)
        setItem((current) => (samePageItem(current, next) ? current : next))
      }),
    [],
  )

  return item
}
