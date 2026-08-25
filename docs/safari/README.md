# GitHub Sidecar on Safari

Build and run from source, unpublished.

Safari cannot load an unpacked extension directory. Every Safari web extension
has to be wrapped in a native app and built by Xcode, even for local use. That
wrapping is a one-off; after it, each change is a rebuild.

## Requirements

- macOS with Safari 16.4 or later.
- Xcode 15 or later, plus its command line tools.
- Node.js 22.18+ (or 23.6+). The build scripts are TypeScript run directly by
  Node, so they need a version with type stripping on by default. Check with
  `node -v`.
- npm 10+.

No Apple Developer account is needed to run it locally. One is needed only to
distribute it, which this guide does not cover.

## Build the web extension

```bash
git clone https://github.com/tmelliottjr/github-sidecar.git
cd github-sidecar
npm install
npm run build:safari
```

The extension is written to `dist/safari/`.

## Wrap it in an app

Once, from the repository root:

```bash
xcrun safari-web-extension-converter dist/safari \
  --app-name "GitHub Sidecar" \
  --bundle-identifier com.example.github-sidecar \
  --macos-only \
  --swift \
  --no-prompt
```

Choose a bundle identifier of your own; `com.example.*` is a placeholder.

Without `--copy-resources` the generated project *references* `dist/safari`
rather than copying it, which is what makes rebuilding cheap: `npm run
build:safari` writes to the same place and Xcode picks the new files up. Keep
the generated project outside the repository, or add it to `.gitignore`, so
build output and signing settings are not committed.

The converter prints where it wrote the project and opens it in Xcode.

## Run it

1. In Xcode, select the **GitHub Sidecar** scheme and press ⌘R. The wrapper app
   launches; it exists only to carry the extension.
2. Safari → Settings → **Advanced** → enable **Show features for web
   developers**.
3. Safari → **Develop** → **Allow Unsigned Extensions**. This resets every time
   Safari quits, so it has to be enabled again after each restart.
4. Safari → Settings → **Extensions** → enable **GitHub Sidecar**.
5. Beside the extension, set permission for `github.com` to **Allow** (or
   **Always Allow on Every Website**). Nothing appears until this is granted.
6. Open the settings page from the extension's toolbar icon, paste a GitHub
   personal access token, and click **Verify**.

A classic token needs `repo` and `read:org` scope to see private repositories.
The token is stored in extension storage and is only ever sent to
`api.github.com`.

## Update

```bash
npm run build:safari
```

Then rebuild in Xcode (⌘R). Open github.com tabs need a refresh to pick up a new
content script. If Safari has restarted since the last run, enable **Allow
Unsigned Extensions** again first.

## Watch mode

```bash
npm run dev safari
```

The rebuild is automatic; the Xcode build is not. Safari does not let an
extension reload itself, so each change still needs ⌘R in Xcode and a refresh of
the github.com tab. For iterating on the panel itself, Chrome or Firefox is a
faster loop.

## What differs from Chrome

Safari gives web extensions no notifications API at all. Desktop notifications,
the sounds that go with them, and the test button in developer mode are
therefore absent rather than switchable, and the settings page says so where the
notification switches would otherwise be.

Nothing is lost from the panel itself. Rows that need attention are still
counted on the toolbar icon and marked in the list, reminders still come due and
still mark their row, and hiding, pinning, filtering, grouping, stacks, and the
keyboard all behave the same. What Safari cannot do is interrupt you when the
panel is not on screen.

| | Chrome | Safari |
| --- | --- | --- |
| Panel, queries, reminders, pins, keyboard | Yes | Yes |
| Count on the toolbar icon | Yes | Yes |
| Desktop notifications | Yes | Not offered |
| Notification sounds | Yes | Not offered |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Extension missing from Safari → Settings → Extensions | The wrapper app has not been run since it was built. Press ⌘R in Xcode. |
| Extension disabled itself after restarting Safari | **Allow Unsigned Extensions** resets on quit. Enable it again under the Develop menu. |
| Develop menu missing | Safari → Settings → Advanced → **Show features for web developers**. |
| Panel does not appear on github.com | The extension has no permission for the site. Set it to **Allow** in Safari → Settings → Extensions. |
| Changes to the code do nothing | `npm run build:safari` writes the files, but Xcode still has to rebuild the app. |
| Cannot inspect the background worker | Safari's Develop → **Web Extension Background Content** is where it lives, and it is less complete than Chrome's. |
