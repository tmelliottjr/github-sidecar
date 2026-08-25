# GitHub Sidecar on Firefox

Build and run from source, unpublished.

## Requirements

- Firefox 140 or later.
- Node.js 22.18+ (or 23.6+). The build scripts are TypeScript run directly by
  Node, so they need a version with type stripping on by default. Check with
  `node -v`.
- npm 10+.

## Build

```bash
git clone https://github.com/tmelliottjr/github-sidecar.git
cd github-sidecar
npm install
npm run build:firefox
```

The unpacked extension is written to `dist/firefox/`. Neither `dist/` nor
`node_modules/` is committed, so a fresh clone must be built before it can be
loaded.

## Load, temporarily

Works in every edition of Firefox. The add-on is removed when Firefox quits.

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**.
3. Select `dist/firefox/manifest.json`.
4. The settings page opens on first install. Paste a GitHub personal access
   token and click **Verify**.

A classic token needs `repo` and `read:org` scope to see private repositories.
The token is stored in extension storage and is only ever sent to
`api.github.com`. Settings survive a reload but not a reinstall.

## Load, permanently

Firefox Release and Beta install signed add-ons only, and ignore
`xpinstall.signatures.required`. There are two ways to keep an unpublished copy
installed.

**Use an edition that allows unsigned add-ons.** Developer Edition, Nightly,
ESR, and unbranded builds honour the preference:

1. Open `about:config` and set `xpinstall.signatures.required` to `false`.
2. Package the build:
   ```bash
   cd dist/firefox && zip -r -FS ../github-sidecar-firefox.zip . && cd ../..
   ```
3. Open `about:addons`, then the gear menu → **Install Add-on From File…**, and
   select `dist/github-sidecar-firefox.zip`.

**Or sign it for yourself.** Mozilla signs unlisted add-ons for
self-distribution without publishing them. This needs an
[addons.mozilla.org](https://addons.mozilla.org) account and API credentials,
and produces an `.xpi` that installs in Release and Beta. The extension id is
already set in the manifest, so it stays the same across signed builds.

## Update

```bash
npm run build:firefox
```

Then click **Reload** beside the add-on in `about:debugging`. Open github.com
tabs need a refresh to pick up a new content script.

## Watch mode

```bash
npm run dev firefox
```

Load `dist/firefox/manifest.json` as a temporary add-on once. It is named
**GitHub Sidecar (dev)** so it can be told apart from an installed copy. From
then on, saving a file rebuilds, reloads the extension, and refreshes open
github.com tabs. If the add-on disappears, load it again from
`about:debugging`.

Set `DEV_RELOAD_PORT` to use a port other than 5599.

## What differs from Chrome

Firefox has no extension service worker, so the panel's background runs as an
event page. That page has a DOM, which is what lets Firefox play the
notification sound directly rather than borrowing a document for it.

Notifications are plainer, because Firefox shows only a title, a body, and an
icon that ships with the extension:

| | Chrome | Firefox |
| --- | --- | --- |
| Buttons (**Mark as seen**, **Remind me in an hour**) | Yes | No |
| Several rows as one grouped list | Yes | Written into the body instead |
| Dim third line (`acme/app #34 · by octocat`) | Yes | Folded into the body |
| Author's avatar as the icon | Yes | Extension icon only |
| Reminders that stay until dismissed | Yes | No |

Clicking a notification still opens the row. Everything else — the panel, the
toolbar count, reminders, hiding, pinning, filtering, and the keyboard — behaves
the same.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Add-on gone after restarting Firefox | Temporary add-ons are dropped on quit. See **Load, permanently**. |
| "This add-on could not be installed because it appears to be corrupt" | Release and Beta require a signed add-on. See **Load, permanently**. |
| Zip installs but the id changes each time | The zip was built from the wrong directory. Zip the *contents* of `dist/firefox`, not the directory itself, so `manifest.json` sits at the archive root. |
| No sound | Firefox's autoplay setting can block an audio context that no click asked for. Check **Settings → Privacy & Security → Autoplay**. The notification still appears. |
| Notifications never arrive | The `notifications` permission is optional and is asked for when the switch is turned on in settings. |
