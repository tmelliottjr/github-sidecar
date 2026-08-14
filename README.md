# GitHub Sidecar

GitHub Sidecar is a Chrome extension that keeps a small, draggable sidebar on
every github.com page, showing the issues and pull requests you actually care
about.

## Features

<details>
<summary><strong>There when you want it</strong> — a new tab starts closed and costs nothing until you open it.</summary>

Once open it is a floating window that can be dragged, resized from any edge or
corner, locked in place, or collapsed to its header.

#### Open state is per tab

Whether the panel is showing belongs to the tab, not the user, so it is the one
piece of state that is not in `chrome.storage.local`. Sharing it would mean
opening the panel once opened it in every tab from then on, which is the
opposite of a new tab starting out of the way.

Instead the service worker keeps a flag in `chrome.storage.session` against the
tab's id. That gives each tab its own answer, survives reloads and navigation
within a tab, is cleared when the browser closes, and — unlike `sessionStorage`
— writes nothing to github.com's own storage. Tab ids get reused, so the flag is
dropped on `tabs.onRemoved`; otherwise the next tab to take that id would
inherit a panel nobody opened.

Out of the way is not the same as gone, though, so a tab that has not been
asked still leaves something to ask with: floating, a launcher in the corner;
docked, the rail, exactly where the panel would have been. Neither costs a
request — a rail is not an open panel — but neither sends anyone to the
browser's extensions menu to find a panel that is meant to be part of the page.

Opening a panel for the first time does not mean going to the network. The
request goes to the worker like any other, which answers from its shared
IndexedDB cache and only refreshes if what it has has aged out.

Everything else about the window — size, position, docked, collapsed, locked —
stays shared, because those are preferences rather than per-tab facts.

</details>

<details>
<summary><strong>Or docked into the page</strong> — one click drops it into the gutter github.com leaves empty, so nothing is covered.</summary>

It hangs below the site header so it reads as part of the page rather than on
top of it. On a viewport with no gutter to spare, the page body is moved across
to make room instead of being covered, while the header goes on spanning the
window. Collapse it to a rail down the edge when you want the room back — it
keeps counting.

#### Finding the gutter

github.com centres its pages in a max-width column, which on a wide display
leaves a wide empty gutter down the left. Docked mode puts the panel there, so
nothing is covered and the page needs no cooperation from us.

Finding that gutter means measuring a page we do not control. Reading it off a
selector would break the first time github.com reorganised its markup, so
`src/content/page-layout.ts` hit-tests the rendered result instead:

- **Where content starts.** Probing a few rows down the middle of the viewport
  and walking each hit stack outwards finds the widest box that is inset from
  where the page lays out. That is the centred column, and its inset is the
  gutter. Insets are measured from body's content box rather than the viewport
  edge, so a page we have already moved is not mistaken for one that was
  centred that way to begin with.
- **Where the page begins vertically.** The panel starts below github.com's
  header, always — beside it is where an overlay would sit, and the point is to
  read as part of the page. That is the lower of the bars currently pinned to
  the top of the viewport, found by hit-testing for sticky and fixed boxes, and
  the header and nav rows in normal flow, which are not pinned yet at the top
  of a page. Remeasured on scroll, so the panel follows the header as it pins
  and unpins. Pinned bars stack — a pull request pins a mini header beneath the
  global one — so they are found by walking down from the top of the viewport
  for as long as each step is still covered, rather than by looking for one bar
  flush at the top. A bar also only has to be as wide as the page column, since
  the mini header is not full-bleed.

#### Making room when there is none

When the gutter is too narrow, the page is moved across by padding `<body>` —
the one element Turbo navigation never replaces, so the reservation survives
navigation without being reapplied. The full width is reserved rather than just
the shortfall: padding moves every box by exactly that much, so anything less
would leave the centred column's own inset absorbing part of it and the page
still starting underneath us.

The chrome at the top is then handed that space straight back. The header and
the nav rows are tagged with an attribute while the page is measured bare — the
outermost box of each nested stack, and nothing taken out of flow, so nothing
moves twice or is moved that body's padding never touched — and a single rule
pulls them back out with a negative margin and an `auto` width. They go on
spanning the window as github.com drew them, and only the page body beneath is
inset. A header stopping short of the window is the one thing that would give
away that the page has been moved at all, and it is the part of github.com a
reader is most likely to know by sight.

#### Collapsing a dock

A floating window collapses up into its own header. A docked one has nowhere to
fold, so it collapses sideways into a rail down the edge of the gutter instead.

The rail is deliberately not a hidden edge: something has to stay on screen or
there is nothing left to click to bring the panel back. At 44px it fits in the
gutter of any page, so collapsing hands back whatever room had been taken from
the layout, and the whole height of it is one button. It keeps showing the
result count, which is the reason to leave it on screen rather than hide it.

The same rail stands in for a docked panel that is hidden in this tab, or that
has never been opened in it. Two states, one mark, and a click clears both at
once — expanding out of a rail always ends with the panel, never with the rail
redrawn because the other flag was still set.

Results therefore go on loading while a dock is collapsed — a count that stops
updating is decoration, not status. That is the one place the two collapsed
states differ: a collapsed floating window shows nothing, so it stops asking.
A rail standing in for a hidden panel stops asking too; it is showing that the
panel is there, not what is in it.

</details>

<details>
<summary><strong>Saved queries</strong> — any number of named GitHub searches, switchable from the header menu.</summary>

Written in the same advanced syntax github.com's own search uses — `AND`, `OR`,
and parentheses included.

</details>

<details>
<summary><strong>Live status</strong> — state, merge queue, CI rollup, and review decision on every row.</summary>

Refreshed on a configurable interval. Right-click any row to refresh just that
one on demand.

#### Row states

The leading mark carries both what a row is and where it stands:

| Mark                  | Meaning                                          |
| --------------------- | ------------------------------------------------ |
| Green circle / check  | Issue, open / closed                             |
| Grey slashed circle   | Issue closed as not planned                      |
| Green pull request    | Pull request, open                               |
| **Amber pull request**| **Queued to merge** (`isInMergeQueue`)           |
| Grey pull request     | Draft                                            |
| Purple merge          | Merged                                           |
| Red pull request      | Closed                                           |

A queued pull request is still open, so GitHub reports it as `OPEN` with
`isInMergeQueue` set. It gets its own state because nothing is being asked of
the reader any more — it is on its way in — which is worth telling apart at a
glance from an open pull request that is still waiting on someone.

#### Refreshing a single row

Polling refreshes a whole query on an interval. That is the wrong tool for
watching one pull request's checks go green, so a row's context menu re-reads
just that row through `repository.issueOrPullRequest`, which resolves either an
issue or a pull request from its number.

The refreshed row is written back to the worker's IndexedDB cache before it is
broadcast. Without that, the next poll would serve the stale cached page
straight back over the top and the refresh would appear to undo itself moments
later. The broadcast then reaches every github.com tab, so a row refreshed in
one updates in all of them.

Both the search and the single-row query select fields through the same GraphQL
fragments. A row that arrives on its own has to be indistinguishable from the
same row arriving through a search, or refreshing one would quietly drop a
badge.

</details>

<details>
<summary><strong>Stacked pull requests</strong> — a <code>layer/size</code> badge and the whole chain from its own chevron.</summary>

A stack is a chain of pull requests where each one targets the branch of the
one below it. GitHub exposes membership directly: `PullRequest.stackEntry`
gives this pull request's position, and `PullRequest.stack` gives the stack's
number, size, base branch, and entries. Nothing is inferred from branch names.

A stacked row carries a `layer/size` badge and opens, from its own chevron, a
list of the whole stack read from the base branch up. The row it was expanded
from stays in that list and is marked instead of being filtered out, because a
stack is only legible as a whole. Expansion is deliberately not on the row
itself: clicking a row still means "open this pull request".

`stack` and `stackEntry` are a public preview. A host that has not been given
the fields rejects the whole query rather than returning null, which would take
the list down with it, so the first such failure drops the stack fields and
every request after it asks the smaller question. Losing the badges is an
acceptable outcome; losing the list is not.

Only the first 20 layers of a stack are read per row, but `size` comes from
GitHub, so a deeper stack still reports its real size and says how many layers
it is not showing.

</details>

<details>
<summary><strong>Pinned rows</strong> — lift the rows you are watching to the top, whichever query they turn up in.</summary>

Pins are stored as node ids under `pinnedIds`, apart from the queries that
surface them, so a pinned row keeps its place whichever query it turns up in.
Only rows already loaded can be lifted, so a pin on an item further down a
result set surfaces once its page arrives.

</details>

<details>
<summary><strong>Cached across tabs</strong> — one shared IndexedDB cache in the service worker, so opening tabs costs no API calls.</summary>

Every github.com tab runs its own copy of the UI, so a naive setup would make
one API call per tab. Instead the service worker owns a single IndexedDB cache
that all tabs read through.

IndexedDB has to live in the worker: a content script's `indexedDB` belongs to
github.com's origin, so a cache written there would pollute the host page's
storage and would not be shared between tabs anyway.

What a tab asking for results actually gets:

| Situation                              | Result                                    |
| -------------------------------------- | ----------------------------------------- |
| Cached copy within the refresh window   | Served from IndexedDB, no network          |
| Cached but stale, **active** tab        | Cached copy now, refresh in the background |
| Cached but stale, background tab        | Cached copy, no network                    |
| Nothing cached                          | One fetch, shared by all waiting tabs      |

The pieces that make that work:

- **Closed and hidden tabs ask for nothing.** The query is disabled unless the
  panel is open and the document is visible, so a tab you never open never
  costs a request. Opening one hydrates it from IndexedDB, which is instant.
- **Only the active tab refreshes.** The worker checks that the requesting tab
  is active and its window focused before going to the network. A background tab
  is never a reason to spend a request.
- **Concurrent requests are coalesced.** Ten tabs opening at once produce one
  API call, not ten.
- **Refreshes are pushed, not pulled.** When the active tab triggers a refresh,
  the worker broadcasts the result to every open tab, which update their caches
  without making their own request.
- **The refresh window follows your setting.** The refresh interval you choose is
  exactly how long a cached page is served for, with a 15s floor so a short
  interval cannot flood the API. With polling off, cached pages last 5 minutes.
- **The refresh button always wins.** It drops the cached pages for that query
  first, so it is a true forced refresh. Entries older than a day are pruned on
  startup.

</details>

<details>
<summary><strong>Fast lists</strong> — cursor-paginated infinite scroll with windowed virtualisation.</summary>

Only the visible rows are ever in the DOM.

</details>

<details>
<summary><strong>Opens in a new window</strong> — clicking a row pops the item out.</summary>

⌘/Ctrl-click opens a tab instead.

</details>

## Install

**Prerequisites**

- **Node.js 22.18+** (or 23.6+). The build and dev scripts are TypeScript files
  run directly by Node, so they need a version with type stripping enabled by
  default. Check with `node -v`.
- **npm 10+** (ships with the Node versions above).
- **Google Chrome** (or another Chromium browser) to load the extension. Chrome
  is also required for the browser test suite.

**Build it**

```bash
git clone https://github.com/tmelliottjr/github-sidecar.git
cd github-sidecar
npm install
npm run build
```

`npm run build` writes the unpacked extension to `dist/`. Neither `dist/` nor
`node_modules/` is committed, so a fresh clone must be built before it can be
loaded.

Then load it in Chrome:

1. Visit `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select the `dist/` directory.
3. The options page opens on first install — paste a GitHub personal access
   token and click **Verify**.

A classic token needs `repo` and `read:org` scope to see private repositories.
The token is stored in `chrome.storage.local` and is only ever sent to
`api.github.com`.

## Usage

| Action                | How                                             |
| --------------------- | ----------------------------------------------- |
| Move the window       | Drag the empty strip in the header               |
| Resize                | Drag any edge or corner                          |
| Dock / undock         | Panel button in the header                       |
| Resize while docked   | Drag the panel's inner edge                      |
| Lock / unlock         | Padlock button in the header                     |
| Collapse / expand     | Chevron button in the header                     |
| Collapse a dock       | Panel button in the header, then click the rail  |
| Show / hide this tab  | The corner launcher or rail, the ✕ button, or the toolbar icon |
| Switch queries        | Click the query name in the header               |
| Edit queries          | Query menu → **Manage queries**                  |
| Open an item          | Click a row (⌘/Ctrl-click for a tab)             |
| Refresh one row       | Right-click it → **Refresh this item**           |
| Pin a row to the top  | Right-click it → **Pin item** (again to unpin)   |
| See a stack           | Chevron on a stacked row, or right-click → **Show the stack** |

## Architecture

```
src/
  background/   Service worker: GitHub API proxy, IndexedDB cache, dev reload
  content/      Shadow-DOM mount, font injection, colour-mode sync, page metrics
  components/   Window chrome, list, rows, and shadcn-style primitives
  hooks/        Storage sync, window geometry, dock layout, search, cache updates
  lib/          GitHub GraphQL client, message protocol, storage schema
  options/      Settings page
scripts/        Font copying, dev watch server
```

A few decisions worth knowing:

- **All GitHub requests go through the background worker.** github.com's
  Content-Security-Policy applies to `fetch` from a content script, so calls
  made there would be blocked. The worker also keeps the token out of page
  context.
- **One GraphQL search per refresh.** The REST search API returns no CI or
  review data, which would mean an extra request per row. A single
  `search(type: ISSUE_ADVANCED)` GraphQL query returns state,
  `statusCheckRollup`, and `reviewDecision` for every result, so polling costs
  one request.
- **`ISSUE_ADVANCED`, not `ISSUE`.** `ISSUE` is still the legacy query parser,
  which does not understand advanced syntax and does not complain about it — it
  matches nothing instead, so `(label:a OR label:b)` comes back empty rather
  than failing. The two agree on everything the legacy parser did understand,
  with one exception worth knowing: a space between `repo:`, `org:`, or `user:`
  qualifiers now means AND where it used to mean OR, so a saved query like
  `repo:acme/api repo:acme/web` has to be written
  `repo:acme/api OR repo:acme/web`.
- **The UI lives in a shadow root** with its stylesheet adopted at runtime, so
  GitHub's CSS cannot reach it and vice versa. Because the shadow host carries
  `all: initial`, base typography is applied to the container inside the shadow
  tree, where it wins over that inline style.
- **Geometry is written straight to the DOM** during a drag and only committed
  to storage on release, so dragging never re-renders the list. The window's
  `style` prop is frozen at mount for the same reason: recomputing it would let
  an unrelated re-render snap the window back mid-gesture.
- **`@property` does not work inside a shadow root.** Tailwind registers its
  internal custom properties that way, so in the shadow tree they have no
  initial value and every declaration built on one — `box-shadow`,
  `border-style`, the transform stack — computes to nothing. Tailwind emits the
  same values as plain declarations behind an `@supports` test for engines
  without `@property` at all, which Chrome fails, so the stylesheet is rewritten
  at mount to drop that guard. Without it the panel has no border and no shadow.

## Development

```bash
npm run dev        # watch + auto-reload (see below)
npm run build      # production build
npm run typecheck
npm run lint
npm test           # unit tests + headless browser tests
npm run test:unit  # unit tests only (no browser needed)
```

### Watch mode

```bash
npm run dev
```

Then load `dist/` unpacked once (it is named **GitHub Sidecar (dev)** so you can
tell it apart from an installed copy). From then on, saving a file rebuilds,
reloads the extension, and refreshes your open github.com tabs automatically.

This is live reload, not hot module replacement. Two things rule HMR out:
Chrome will not pick up content script edits without reloading the whole
extension, and github.com's CSP governs content script fetches, so the socket an
HMR client needs would be blocked. In practice the difference is small — window
position, saved queries, and settings all live in `chrome.storage`, so they
survive the reload.

How it works: `scripts/dev.ts` runs both Vite builds in watch mode and serves a
long-poll endpoint on `127.0.0.1:5599`. The service worker (which is *not*
subject to page CSP) holds a request open against it; when a rebuild lands the
request resolves and the worker calls `chrome.runtime.reload()`, then refreshes
github.com tabs once it restarts. Because the pages and content bundles come
from two independent watchers, the worker also records which build it reloaded
for and reloads again if the other bundle landed late.

The dev-only code is behind `import.meta.env.MODE === 'development'` and is
tree-shaken out of production builds, as is the extra localhost host permission.
Set `DEV_RELOAD_PORT` to use a different port.

### Tests

The browser tests load the real `dist/content.js` into a headless Chrome with a
stubbed `chrome` API, and cover mounting, styling, virtualisation, dragging,
locking, and collapsing. Docked mode is exercised against a stand-in for a
github.com page — full-width chrome above a centred column — at a viewport wide
enough for the gutter to hold the panel and at one that is not. The options page is tested against a served copy of
`dist/`, and the IndexedDB store is exercised against real IndexedDB. Cache
policy (freshness, coalescing, active-tab gating) is unit tested against an
in-memory store. Browser suites skip automatically when no Chrome binary is
found. Run `npm run build` before `npm test`.

### A note on `.npmrc`

The committed `.npmrc` sets `replace-registry-host=never`. Without it, npm
rewrites every tarball URL to a mirror that 404s for some packages (notably
`@types/estree`, a transitive dependency of Vite). Remove it if your registry
does not have that problem.
