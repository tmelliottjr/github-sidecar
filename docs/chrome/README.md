# GitHub Sidecar on Chrome

Build and run from source, unpublished. Also applies to Edge, Brave, Arc, and
other Chromium browsers.

## Requirements

- Chrome 114 or later.
- Node.js 22.18+ (or 23.6+). The build scripts are TypeScript run directly by
  Node, so they need a version with type stripping on by default. Check with
  `node -v`.
- npm 10+.

## Build

```bash
git clone https://github.com/tmelliottjr/github-sidecar.git
cd github-sidecar
npm install
npm run build:chrome
```

The unpacked extension is written to `dist/chrome/`. Neither `dist/` nor
`node_modules/` is committed, so a fresh clone must be built before it can be
loaded.

## Load

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the `dist/chrome` directory.
4. The settings page opens on first install. Paste a GitHub personal access
   token and click **Verify**.

A classic token needs `repo` and `read:org` scope to see private repositories.
The token is stored in extension storage and is only ever sent to
`api.github.com`.

## Update

```bash
npm run build:chrome
```

Then click **Reload** on the extension's card in `chrome://extensions`. Open
github.com tabs need a refresh to pick up a new content script.

## Watch mode

```bash
npm run dev chrome
```

Load `dist/chrome` unpacked once. It is named **GitHub Sidecar (dev)** so it can
be told apart from an installed copy. From then on, saving a file rebuilds,
reloads the extension, and refreshes open github.com tabs.

Set `DEV_RELOAD_PORT` to use a port other than 5599.

## What Chrome supports

Everything the panel offers. Chrome is the only browser with offscreen
documents, so it is the only one that plays the notification sound from a
document of the extension's own, and the only one whose notifications carry
buttons, a list, a dim third line, and the author's avatar.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Manifest file is missing or unreadable" | `dist/chrome` was selected before `npm run build:chrome` finished, or `dist/` was selected instead of `dist/chrome`. |
| Panel does not appear on github.com | The content script loads at `document_idle` on `https://github.com/*` only. Refresh the tab after reloading the extension. |
| Notifications never arrive | The `notifications` permission is optional and is asked for when the switch is turned on in settings. macOS can also suppress Chrome's notifications system-wide. |
| No sound | The panel plays its own sound in an offscreen document. Check the volume and the per-kind sound in settings; **Silent** is one of the choices. |
