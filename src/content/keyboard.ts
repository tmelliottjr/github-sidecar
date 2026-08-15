/**
 * Keeps the panel's keystrokes out of github.com's shortcut handlers.
 *
 * GitHub binds single-letter shortcuts on `document` — `l` opens the label
 * picker on an issue or pull request, `/` focuses search, and so on — and
 * skips them when the keystroke came from a form field. That check reads
 * `event.target`, which for anything inside a shadow root is *retargeted to
 * the host element*: from the page's point of view every keystroke the panel
 * receives appears to come from an anonymous `<div>`, never from an input. So
 * typing a query name here silently opens the label picker underneath.
 *
 * Nothing typed into the panel is meant for the page, so every key event that
 * originates inside the shadow root is stopped at its boundary. Key events the
 * panel never sees are untouched, which leaves github.com's own shortcuts
 * working everywhere else.
 */
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const

/**
 * Listening on the shadow root rather than on the host matters: React binds to
 * the container *inside* the root, so it and Radix's menus have already had
 * the event by the time propagation stops. Only the page loses it.
 *
 * Stopping propagation rather than preventing the default matters too — the
 * keystroke still types, still moves the caret, and still reaches the
 * browser's own shortcuts. It simply never arrives at github.com's listeners.
 */
export function isolateKeyboard(root: ShadowRoot): () => void {
  const stop = (event: Event) => event.stopPropagation()

  for (const type of KEY_EVENTS) {
    root.addEventListener(type, stop)
  }

  return () => {
    for (const type of KEY_EVENTS) {
      root.removeEventListener(type, stop)
    }
  }
}
