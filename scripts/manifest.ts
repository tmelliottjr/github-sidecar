import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'

/**
 * One description of the extension, and the three manifests the browsers will
 * accept it under.
 *
 * A single shared `manifest.json` is nearly possible — all three engines
 * ignore keys they do not know — but the `background` key is a real fork
 * rather than an extra field: Chrome and Safari run a service worker, and
 * Firefox has no service worker to give and runs an event page instead. Once
 * one key has to differ per browser, saying so plainly here is clearer than a
 * manifest carrying every browser's answer at once and trusting each to look
 * away from the other two.
 */
export type BrowserTarget = 'chrome' | 'firefox' | 'safari'

export const BROWSER_TARGETS: BrowserTarget[] = ['chrome', 'firefox', 'safari']

export function isBrowserTarget(value: string): value is BrowserTarget {
  return (BROWSER_TARGETS as string[]).includes(value)
}

/**
 * Firefox needs a stable id of its own: without one it invents a fresh id on
 * every install, and storage is keyed by it, so settings and saved queries
 * would be lost each time. Chrome and Safari ignore the whole key.
 */
const GECKO_ID = 'github-sidecar@tmelliottjr.github.io'

/**
 * Firefox 140 is the oldest release that has everything the panel needs and
 * everything the manifest says: `storage.session` (109), a `type` on the
 * background key (112), host permissions granted at install rather than asked
 * for afterwards (127), and the data collection declaration below (140). It is
 * also the current ESR, so nothing usable is left out by naming it.
 */
const GECKO_MIN_VERSION = '140.0'

/** The oldest Chrome the panel is built for. */
const MINIMUM_CHROME_VERSION = '114'

const ICONS = {
  '16': 'icon-16.png',
  '32': 'icon-32.png',
  '48': 'icon-48.png',
  '128': 'icon-128.png',
}

interface PackageJson {
  version: string
  description: string
}

async function packageJson(): Promise<PackageJson> {
  const path = fileURLToPath(new URL('../package.json', import.meta.url))
  return JSON.parse(await readFile(path, 'utf8')) as PackageJson
}

export interface ManifestOptions {
  /** Adds the reload server's origin and marks the name, for `npm run dev`. */
  dev?: boolean
  /** The reload server's origin, needed only in development. */
  devOrigin?: string
}

export async function manifestFor(
  target: BrowserTarget,
  { dev = false, devOrigin }: ManifestOptions = {},
): Promise<Record<string, unknown>> {
  const { version } = await packageJson()

  const hostPermissions = [
    'https://api.github.com/*',
    'https://github.com/*',
    ...(dev && devOrigin ? [`${devOrigin}/*`] : []),
  ]

  return {
    manifest_version: 3,
    name: dev ? 'GitHub Sidecar (dev)' : 'GitHub Sidecar',
    version,
    description:
      'GitHub Sidecar — an omni-present, draggable sidebar for tracking the GitHub issues and pull requests you care about.',
    ...(target === 'chrome' ? { minimum_chrome_version: MINIMUM_CHROME_VERSION } : {}),
    ...(target === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: GECKO_ID,
              strict_min_version: GECKO_MIN_VERSION,
              // Nothing is collected: the token is stored locally and sent
              // only to api.github.com, and nothing reaches the author at all.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
    permissions: [
      'storage',
      'alarms',
      // Chrome's offscreen documents are the only way its service worker is
      // allowed to make a sound. No other browser has them to ask for.
      ...(target === 'chrome' ? ['offscreen'] : []),
    ],
    // Safari has no notifications API in a web extension, so there is nothing
    // for the reader to be asked for and nothing that granting it would buy.
    ...(target === 'safari' ? {} : { optional_permissions: ['notifications'] }),
    icons: ICONS,
    host_permissions: hostPermissions,
    background:
      target === 'firefox'
        ? // Firefox MV3 has no extension service worker. Its background is a
          // non-persistent event page, which is also why Firefox is the one
          // browser that can play the notification sound without borrowing a
          // document from somewhere else.
          { scripts: ['background.js'], type: 'module' }
        : { service_worker: 'background.js', type: 'module' },
    content_scripts: [
      {
        matches: ['https://github.com/*'],
        js: ['content.js'],
        run_at: 'document_idle',
        all_frames: false,
      },
    ],
    action: {
      default_title: 'Toggle GitHub Sidecar',
      default_icon: ICONS,
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  }
}
