/**
 * The extension API, under whichever name the browser running this happens to
 * give it, and a plain statement of what that browser can be asked to do.
 *
 * Firefox and Safari have always exposed the standard, promise-returning
 * `browser`; Chrome answers to `chrome` and grew promises later. Taking
 * whichever is present means every call in the rest of the extension can be
 * awaited, with no polyfill and no callbacks — the two namespaces are the same
 * shape, so one name for it is enough.
 */
export const browser: typeof chrome =
  (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome

export type BrowserTarget = 'chrome' | 'firefox' | 'safari'

/**
 * Which browser this bundle was built for. Fixed at build time rather than
 * sniffed at runtime, because each browser gets its own build and its own
 * manifest anyway — and because a constant lets the branches meant for the
 * other two be dropped from the bundle instead of shipped and never taken.
 *
 * The fallback is for the unit tests, which import these modules straight into
 * Node with no bundler to substitute anything.
 */
export const target: BrowserTarget =
  typeof __BROWSER__ === 'undefined' ? 'chrome' : __BROWSER__

/**
 * What this browser will actually do, as opposed to what the code could ask
 * for. Every entry here is a real difference that changes behaviour, so each
 * is answered honestly: a browser that cannot do something is told to the
 * reader rather than quietly given a switch that does nothing.
 */
export interface Capabilities {
  /**
   * Chrome's offscreen documents. A service worker cannot play audio, and this
   * is the only way it is allowed to borrow a document that can.
   */
  offscreenAudio: boolean
  /**
   * The background context is a page with a DOM, so it can hold an
   * `AudioContext` and make the sound itself. True only on Firefox, whose MV3
   * background is an event page rather than a service worker.
   */
  backgroundAudio: boolean
  /** Desktop notifications through the extension API at all. */
  notifications: boolean
  /**
   * Notifications beyond a title, a message and an icon that ships with the
   * extension. Chrome takes buttons, a list, a dimmed third line, a timestamp
   * and a remote icon; Firefox takes none of them.
   */
  richNotifications: boolean
}

const CAPABILITIES: Record<BrowserTarget, Capabilities> = {
  chrome: {
    offscreenAudio: true,
    backgroundAudio: false,
    notifications: true,
    richNotifications: true,
  },
  firefox: {
    offscreenAudio: false,
    backgroundAudio: true,
    notifications: true,
    richNotifications: false,
  },
  // Safari has no notifications API in a web extension and no offscreen
  // documents, and its background is a service worker with no DOM to play a
  // sound in. The panel says as much in settings rather than pretending.
  safari: {
    offscreenAudio: false,
    backgroundAudio: false,
    notifications: false,
    richNotifications: false,
  },
}

export const can: Capabilities = CAPABILITIES[target]

/** How the browser is named to the reader, for anything they will read. */
const BROWSER_LABEL: Record<BrowserTarget, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
}

export const browserName: string = BROWSER_LABEL[target]
