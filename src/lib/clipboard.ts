/**
 * Writing to the clipboard from a content script, where the panel is a guest
 * on github.com's page rather than an extension page of its own.
 *
 * A link is written in two flavours at once: rich text for anywhere that
 * understands it — an issue comment, a chat message, a doc — and the bare URL
 * for everywhere that does not, such as an editor or a terminal. Pasting the
 * title into a text file would be worse than useless, since it loses the one
 * part that can be navigated back to.
 */

interface Flavours {
  'text/plain': string
  'text/html'?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The rich half of a copied link: the title, pointing at the URL. */
export function linkHtml(url: string, title: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`
}

/** Copies plain text, such as a title or a branch name. */
export function copyText(text: string): Promise<void> {
  return write({ 'text/plain': text })
}

/**
 * Copies a link that pastes as its title where rich text is accepted, and as
 * the URL where it is not.
 */
export function copyLink(url: string, title: string): Promise<void> {
  return write({ 'text/plain': url, 'text/html': linkHtml(url, title) })
}

async function write(flavours: Flavours): Promise<void> {
  if (typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
    try {
      const items = Object.fromEntries(
        Object.entries(flavours).map(([type, data]) => [type, new Blob([data], { type })]),
      )
      await navigator.clipboard.write([new ClipboardItem(items)])
      return
    } catch {
      // The async API is refused where the document is not focused, and by
      // hosts that withhold the permission; the command below still works.
    }
  }

  if (!writeWithCommand(flavours)) {
    throw new Error('Could not copy to the clipboard.')
  }
}

/**
 * The older, synchronous route. `execCommand` copies the *selection*, so it
 * needs something selected to copy — hence the throwaway field — and a `copy`
 * listener to replace what lands on the clipboard with both flavours.
 */
function writeWithCommand(flavours: Flavours): boolean {
  if (typeof document.execCommand !== 'function') return false

  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    for (const [type, data] of Object.entries(flavours)) {
      event.clipboardData?.setData(type, data)
    }
  }

  // Focus moves to the carrier and has to go back, or dismissing the menu
  // would leave the reader's place in the panel behind.
  const previous = document.activeElement
  const carrier = document.createElement('textarea')
  carrier.value = flavours['text/plain']
  carrier.setAttribute('aria-hidden', 'true')
  carrier.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none'
  document.body.append(carrier)

  document.addEventListener('copy', onCopy, true)
  try {
    carrier.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.removeEventListener('copy', onCopy, true)
    carrier.remove()
    if (previous instanceof HTMLElement) previous.focus()
  }
}
