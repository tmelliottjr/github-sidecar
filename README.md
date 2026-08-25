# GitHub Sidecar

GitHub Sidecar is a browser extension that keeps a small, draggable sidebar on
every github.com page, showing the issues and pull requests you actually care
about.

It runs on Chrome, Firefox, and Safari. See [Browser support](#browser-support)
for the two places they differ.

## Features

- **There when you want it.** A new tab starts closed behind a launcher button
  and costs nothing until you open it. Once open it is a floating window that
  can be dragged, resized from any edge or corner, locked in place, or collapsed
  to its header.
- **Or docked into the page.** One click drops the window into the empty gutter
  github.com leaves to the left of its content, hanging below the site header
  so it reads as part of the page rather than on top of it. On a viewport with
  no gutter to spare, the page body is moved across to make room instead of
  being covered, while the header goes on spanning the window. Collapse it to a
  rail down the edge when you want the room back — it keeps counting.
- **Saved queries.** Any number of named GitHub search queries, switchable from
  the header menu, in the same advanced syntax github.com's own search uses —
  `AND`, `OR`, and parentheses included.
- **Live status.** Open/closed/merged/draft state, queued-to-merge, CI check
  rollup, and review decision for every row, refreshed on a configurable
  interval. Right-click any row to refresh just that one on demand.
- **Knows where you are.** Open a tracked issue or pull request on github.com
  and its row marks itself, so the list says whether what you are reading is
  one of the things you are following.
- **Says what changed.** Rows report what has moved since you last looked at
  them — a review, a red check, new comments, a push, a merge — and clear
  themselves once you have read them. The toolbar icon counts them, and can
  raise a notification when one moves.
- **Says why it cannot merge.** Conflicts and branches that have fallen behind
  their base are marked on the row, and the checks mark counts what is red and
  opens the list of failing checks under the row, each one a link to the run.
- **Remind me about this.** Ask for a row again in an hour, this evening,
  tomorrow, next week, or whenever it next changes. The row stays exactly where
  it is; the reminder is what speaks up.
- **Hide what you do not want to see.** Hidden rows leave the list without
  leaving your records: the footer counts them and brings them back.
- **Manage what you put aside.** The settings page gathers everything you have
  set apart — the rows you hid, the reminders you set, the rows you pinned — so
  you can bring a hidden row back, move a reminder to a different time or drop
  it, and reorder or lift a pin, all from one place.
- **Filter, reorder, and drive it from the keyboard.** Narrow the rows already
  loaded without asking GitHub for anything, order them by what has waited
  longest, and move through the list with `j`/`k`.
- **All of it optional.** Every feature above has a switch on the settings
  page, and the list reads the same with all of them off. Notifications have a
  section of their own: what may interrupt you, for reminders or changes
  separately, and what it sounds like.
- **Cached across tabs.** Results are stored in IndexedDB in the service worker
  and shared by every github.com tab, so opening tabs costs no API calls.
- **Fast lists.** Cursor-paginated infinite scroll with windowed virtualisation,
  so only the visible rows are ever in the DOM.
- **Opens in a new tab.** Clicking a row opens the item in a tab; switch to a
  popped-out window in settings, and ⌘/Ctrl-click always opens a tab.

## Install

The extension is not published, so it is built from source and loaded by hand.
Loading it is different in each browser, so each has its own guide:

- **[Chrome](docs/chrome/README.md)** — and Edge, Brave, Arc, or any Chromium
  browser
- **[Firefox](docs/firefox/README.md)**
- **[Safari](docs/safari/README.md)** — needs Xcode, since Safari cannot load a
  directory

**Prerequisites**

- **Node.js 22.18+** (or 23.6+). The build and dev scripts are TypeScript files
  run directly by Node, so they need a version with type stripping enabled by
  default. Check with `node -v`.
- **npm 10+** (ships with the Node versions above).
- The browser you intend to load it in. Chrome is also required for the browser
  test suite.

**Build it**

```bash
git clone https://github.com/tmelliottjr/github-sidecar.git
cd github-sidecar
npm install
npm run build            # all three
npm run build:chrome     # or just the one you want
npm run build:firefox
npm run build:safari
```

Each browser gets its own unpacked extension under `dist/chrome/`,
`dist/firefox/`, and `dist/safari/`, because no two of them accept the same
manifest. Neither `dist/` nor `node_modules/` is committed, so a fresh clone
must be built before it can be loaded.

Whichever browser you use, the settings page opens on first install — paste a
GitHub personal access token and click **Verify**. A classic token needs `repo`
and `read:org` scope to see private repositories. The token is stored in
extension storage and is only ever sent to `api.github.com`.

## Browser support

Everything the panel does — the list, queries, reminders, change marks, hiding,
pinning, stacks, filtering, grouping, the keyboard, and the count on the toolbar
icon — works the same in all three. The differences are entirely in what each
browser will let an extension do when the panel is *not* on screen.

| | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| The panel, and everything in it | Yes | Yes | Yes |
| Count on the toolbar icon | Yes | Yes | Yes |
| Desktop notifications | Yes | Plain | Not offered |
| Buttons on a notification | Yes | No | — |
| Several at once as one grouped list | Yes | Written into the body | — |
| The author's face as the icon | Yes | Extension icon only | — |
| Notification sounds | Yes | Yes | Not offered |

Safari gives web extensions no notifications API at all, so the settings page
says so where those switches would otherwise be rather than offering a switch
that does nothing. Firefox has notifications but shows only a title, a body, and
an icon that ships with the extension, so what Chrome puts in the dim third line
is folded into the body instead of being dropped.

The sound is made differently in each: Chrome's background is a service worker
and cannot play audio, so it borrows an offscreen document; Firefox's background
is an event page with a DOM of its own and needs nothing borrowed; Safari has
neither, and no notification to play a sound alongside.

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
| See a stack           | The `layer/size` badge on a stacked row, or right-click → **Show the stack** |
| Shut a stack          | The chevron at the top of the slide-out, or the badge again      |
| Copy a link           | Right-click a row → **Copy** → **Link** (rich text, titled; the URL as plain text) |
| Copy it as Markdown   | **Copy** → **Link as Markdown**                  |
| Copy a title          | **Copy** → **Title**                             |
| Copy a branch         | **Copy** → **Branch** (pull requests)            |
| Copy a whole stack    | **Copy** → **Stack links**, or **Stack links as Markdown** |
| Clear a change mark   | Open the row, be on its page, or right-click → **Mark as seen** |
| Clear all of them     | Query menu → **Mark all as seen**                |
| See the failing checks| Click the red checks mark on the row             |
| Ask for a row again   | Right-click it → **Remind me…** (`r` for when it changes) |
| Cancel that           | Right-click it → **Clear the reminder**          |
| Hide a row            | Right-click it → **Hide this row** (`h`)         |
| Review what is hidden | The count in the footer, then right-click → **Show it again** |
| Manage all of it      | Settings → **Hidden rows** / **Reminders** / **Pinned rows** |
| Filter the loaded rows| The funnel in the header, or `/`                 |
| Reorder them          | The sort control in the filter bar               |
| Group them            | The grouping control in the filter bar (remembered per query) |
| Move through the list | `j` and `k`, then Enter or `o` to open, `p` to pin |
| Spot the page you are on | Its row is washed, and a rule on the panel's outer edge points out at it |
| Hear about it            | Settings → **Notifications** → **Desktop notifications** |
| Hear about only one kind | The same section: **Reminders you set** / **Rows that changed** |
| Change what one sounds like | The **Sound** row under that kind; **Silent** to mute it |

## Architecture

```
src/
  background/   Background worker: GitHub API proxy, IndexedDB cache, the
                notification sound, dev reload
  content/      Shadow-DOM mount, page font/colour-mode sync, page metrics,
                keyboard isolation, current-page tracking
  offscreen/    Chrome only: the document the sound is played in, since a
                service worker cannot play audio
  components/   Window chrome, list, rows, and shadcn-style primitives
  hooks/        Storage sync, window geometry, dock layout, search, cache
                updates, current page
  lib/          GitHub GraphQL client, message protocol, storage schema,
                change detection, list filtering, the extension API and what
                each browser can be asked to do
  options/      Settings page
scripts/        Dev watch server, per-browser build, manifest generation
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
- **Key events stop at the shadow boundary.** github.com binds single-letter
  shortcuts on `document` — `l` opens the label picker, `/` focuses search —
  and skips them when the keystroke came from a form field. That check reads
  `event.target`, which for anything in a shadow root is retargeted to the
  host, so every keystroke the panel receives looks to the page like it came
  from an anonymous `<div>`: typing a query name here would open the label
  picker underneath. `src/content/keyboard.ts` stops key events on the shadow
  root, after React and Radix have seen them and before the page does.
- **A partial answer is not a failure.** GitHub replies to a query spanning an
  organisation the token cannot reach with the rows it *could* read plus one
  error per row it could not. Those results are kept and the refusal is shown
  as a dismissible banner above the list; only an answer with no usable data
  becomes an error state. GitHub's own wording for a refused token is written
  for an API client, so `src/lib/github/api.ts` rewrites the recognised cases
  into the step that fixes them and dedupes the repeats. The classification
  keys off what the token cannot do, never off the identity provider enforcing
  it, and the panel offers the settings page instead of a retry that would fail
  identically.
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

## Docked mode

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

## Open state is per tab

Whether the panel is showing belongs to the tab, not the user, so it is the one
piece of state that is not in `storage.local`. Sharing it would mean
opening the panel once opened it in every tab from then on, which is the
opposite of a new tab starting out of the way.

Instead the service worker keeps a flag in `storage.session` against the
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

## Row states

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

The marks under the title say what is being asked of whom: the check rollup,
the review decision, comments, labels, and — for a pull request that cannot go
in — why not.

| Mark                    | Meaning                                        |
| ----------------------- | ---------------------------------------------- |
| Red triangle            | Conflicts with the base branch                 |
| Amber sync              | Behind the base branch                         |
| Red cross, then a count | How many checks are red; click it to list them |
| Bell                    | A reminder waiting on this row                 |
| Filled amber bell       | A reminder that has come round                 |

Merge state is flattened from two GitHub fields. `mergeable` is the older one
and only knows about conflicts; `mergeStateStatus` knows why a mergeable branch
still cannot go in, and is a schema preview, so the request opts into it with
`Accept: application/vnd.github.merge-info-preview+json`. A host that refuses
the preview fields costs the panel its merge marks and stack badges, not its
list — the first refusal drops them and everything after asks the smaller
question.

Only conflicts and a stale branch are drawn. GitHub's other answers — blocked,
unstable — are its words for a missing review or a red check, and both of those
already have a mark of their own on the same line.

## Refreshing a single row

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

## Copying a row

A row's context menu gathers every way of copying it under one entry, because
they are the same verb on the same row: its link, that link as Markdown, its
title, a pull request's branch, and — where the row belongs to a stack — every
link in the stack, plainly or as Markdown.

A link goes on the clipboard twice: as rich text, so it pastes as the item's
title wherever that is understood, and as the bare URL underneath, so it pastes
as something navigable in an editor or a terminal. Pasting a title into a text
file would lose the only part that can be followed back.

Markdown is offered beside it rather than derived from it. It is what a pull
request description, an issue comment and half the world's notes are written
in, and no amount of rich text pastes as its source. A stacked row carries its
layer in the link text — `[Rework the cache <2/3>](…)` — which is the
difference between "the fix" and "the second part of the fix"; the whole stack
copies base-first, in the order anyone reading it would want to review it. Link
text is escaped, so a title with brackets in it cannot end the link early.

The panel is a guest on github.com's page, so the async clipboard API can be
refused there — an unfocused document, or a host that withholds the permission.
A `copy` command over a throwaway field is the fallback, and it is the only
other route that still carries both flavours at once.

## The row you are on

The panel is on every page of github.com, so the item being read is usually
somewhere in the list already. Its row says so: a faint wash, a rule level with
the row on the panel's outer edge that comes to a point just past it, out over
github.com itself, and `aria-current="page"` for anything reading rather than
looking. It answers a question the list otherwise leaves open — is this
one of the things I am tracking? — and it is a property of the tab, so two tabs
on two pull requests each mark their own row.

Rows are matched on repository and number rather than on the URL. Every tab of
a pull request is still that pull request, and GitHub redirects `/issues/34` to
`/pull/34` freely, since the two share one sequence of numbers per repository.

The point is cut over about twenty pixels rather than the row's whole height:
a taper of a couple of degrees is a shape anti-aliasing rounds off into a blob,
and an arrow that does not come to a point is not an arrow.

That rule cannot be part of the row. The panel clips its children to its own
rounded corners, and the scrolling list can show nothing horizontally beyond
its box, so anything crossing the edge is cut off there. It is drawn out in the
shadow root instead and placed against the row's measured rectangle — clipped
to the band the row and the list have in common, so a row scrolling out of the
list takes its marker with it rather than leaving one pointing at whatever
arrived next.

Nothing it depends on moves under React's eye: the list scrolls, the page
scrolls beneath a docked panel, and dragging the window writes a transform
straight to the DOM. Each of those schedules the same measure-and-place on the
next frame, so one mechanism covers movement the panel never renders for.

Knowing when the page changed is the harder half. github.com navigates without
reloading, and the panel runs in an isolated world where patching `pushState`
would only see its own calls. Four routes are watched at once — the Navigation
API where it is exposed, Turbo and pjax's own events, `popstate` for the back
button, and the document title being swapped as a last net — and each of them
does nothing more than compare `location.href` with the last one seen, so
hearing about the same navigation four times costs one comparison.

## What changed since you looked

A list that only reports state answers "what is true". The reader has to
remember what was true last time to know whether anything needs them, which is
the part a panel can do for them.

Every row carries a signature: its state, review decision, check rollup,
comment count and head commit. What the reader has seen is stored per row and
shared across their tabs, and the difference between the two is what the row
reports — "3 new comments", "Checks failed", "Merged" — loudest change first.

`updatedAt` is deliberately not part of it. GitHub bumps that timestamp when a
label moves or a description is edited, and a list that lit up for those would
soon be ignored. A deleted comment is not news either, so the comment count is
only read upwards.

Rows are seeded as seen the first time they are laid eyes on, so a fresh
install does not mark everything at once. The seeding is what the toolbar count
and the notifications are measured against too, so it goes on happening while
either of those is switched on, whether or not the marks themselves are. A mark clears when the row is opened,
when the tab is on that row's page, or on demand from the row's own menu; the
query menu clears the lot.

## Asking for a row again

A row that has been dealt with but cannot be closed — waiting on someone else,
or on a check — needs picking up again later. "Later" has two honest meanings,
so a reminder has two kinds: a time (in an hour, this evening, tomorrow, next
week) and the row itself, which is what "later" means whenever it really means
"once something happens". A change reminder is judged by exactly the same
signature as everything else here, so it cannot miss the very thing it was set
for.

The row does not move and does not hide. It carries a bell while the reminder
waits, and an amber one once it has come round — at which point it also counts
on the toolbar and, where **desktop notifications** are switched on, says so out
loud. That switch is off by default and needs Chrome's permission, so a
reminder is a mark and a count until it is granted, not a popup. Reading the
row retires a reminder that has come round, because it has done its job; one
still waiting stays, because this is not the time that was asked for.

A timed reminder comes round with no request behind it, so the worker keeps a
single `alarms` alarm set for the soonest one, and the panel keeps one
timer for the same moment — otherwise a panel that only redraws when GitHub
answers would go on saying "waiting" until the next poll. Change reminders need
neither: they can only come due when new results arrive, which redraws the
panel and wakes the worker anyway.

## Hiding a row

Hiding is the other half of the same problem, and deliberately not the same
thing: a hidden row is one the reader does not want to see, rather than one
they want back later. It leaves the list and stops counting, but not the
records — the footer says how many are hidden and shows them on request, marked
and dimmed, one menu entry away from coming back.

That count is of hidden rows *this view holds*, worked out after the filter
rather than before it: an offer to reveal rows the current view would not show
either way is an offer of nothing. Revealing them is a look rather than a
setting, so it switches itself off once the last hidden row has come back —
otherwise the next row the reader hid would stay on screen, and a Hide that
does not hide is worse than no Hide at all. A row hidden months ago comes
back as a fresh look rather than covered in marks for everything that happened
meanwhile.

## Failing checks

The checks mark counts what is red, and opens the failing checks under the row
in the same kind of drawer a stack uses — because a row has one line for its
marks, and a list of check names is not one line. Each entry links to the run
that failed, which is the trip the reader would otherwise make through the pull
request and its Checks tab. The list scrolls rather than growing, and only the
first fifty checks of a rollup are read, so a repository with more than that is
told the truth: "and 10 more checks not read" — counted against how many checks
were read, not against how many of them were red.

A red rollup can still have nothing to name: GitHub reports the rollup as
failing for a check the query never read, or for one it does not class as red
at all. Rather than draw the same mark twice and behave differently, the count
and the drawer appear only when there is something to list, and the mark itself
says which case it is. Cancelled and stale checks are counted as failing, since
GitHub's own rollup fails for them and they were the common reason a red row
could not name a single red check; neutral and skipped are not, because the
rollup does not fail for those and naming them would be inventing a problem.

## Filtering, reordering, and the keyboard

The filter narrows the rows already loaded across everything they show — title,
repository, author, number, labels — with each word narrowing further. It is
not a GitHub `sort:` or search qualifier: nothing is sent, so it answers as
fast as it can be typed, it cannot lose the reader's place, and it costs no
rate limit. It also stops the list pulling in further pages while it is on,
because a filter matching little enough would otherwise page through the whole
result set looking for matches nobody asked it to fetch. The order can be changed to what has waited longest, which is what
a review queue loses first, or grouped by repository. A grouping is remembered
with the query it was chosen on, so each saved query keeps its own way of being
read while sharing the one filter box.

`j` and `k` move through the list by moving the browser's own focus onto a
row's button, so Enter opens it without a handler of the panel's own and a
screen reader is told where it landed. `o` opens, `p` pins, `h` hides, `r` asks
to be reminded when the row changes, `/` opens the filter, and Escape gives the
focus back. The other reminder times are a choice, and a choice belongs in the
menu that lists them.

## What is waiting

The count on the toolbar icon and the notification that something moved — or
that a reminder has come round — are both worked out in the service worker, because both have to be right in a
browser with no github.com tab open at all — which is exactly when the panel is
not running. The worker reads the same cached pages the panel does and the same
record of what the reader has seen.

A notification has three pieces of text of decreasing weight, and using them
carelessly leads to a title reading `acme/app #34` — the one thing the reader
already knows, since they are the one tracking it. So the item's own title
leads, what happened comes next, and where it lives goes in the dim line
underneath: **Cache the search results** / *Checks failed · 3 new comments* /
`acme/app #34 · by octocat`. The author's face is the icon where the browser
will fetch it, because a notification is recognised before it is read.

Each one carries the answer the reader would otherwise give by hand: **Mark as
seen** for a change, **Remind me in an hour** for a reminder. Both write to the
same record the panel reads, so the row and the count agree with the button
without anything being adjusted twice. Clicking the notification itself opens
the row.

Firefox shows only a title, a body, and an icon that ships with the extension.
There the third line is folded into the body rather than dropped — a
notification naming a row without saying which repository it is in has to be
clicked to be understood — and there are no buttons, so clicking the body to
open the row is the whole of it. Safari has no notifications at all; see
[Browser support](#browser-support).

A reminder was asked for by name, so it may interrupt: full priority, a sound,
and it stays until it is dealt with. A change was not, so it is quieter and
ordinary. More than two at once stop being news and become a flood, so they
arrive as one list — five rows named, the rest counted, clicking through to the
search that produced them. Where there is no list type the same rows are written
into the body, which says the same thing with less ceremony.

A change is announced once. The row's signature is remembered per notification,
along with why it was announced, so a row that changes again is announced
again, and a reminder coming round on a row that had already been announced for
a change is announced in its own right — while a row that is merely still
waiting stays quiet — otherwise every poll would repeat itself until the
reader happened to read it.

Notifications need the browser's `notifications` permission, which the extension
is not installed with. The switch on the settings page asks for it from the
click that turned it on, and hands it back when the switch goes off.

Everything about being interrupted sits in one section of the settings page, in
the order it is decided: whether to speak at all, what to speak about, and what
each of those sounds like. Each answer is nested inside the one it depends on,
drawn with a rule rather than hidden, so a reader can see what saying yes would
get them and stop reading the moment they have said no.

Reminders and changes are switched separately, and each carries its own sound —
the sound belongs to the kind, not to notifications as a whole, because a chime
for the reminders you set and nothing at all for everything else is a perfectly
ordinary thing to want. A row left out this way is still counted on the toolbar:
it is the speaking that was declined, not the knowing.

There is no separate switch for sound, because "no sound" is one of the sounds:
choosing **Silent** for a kind is how it is silenced, and choosing it for both
is how the browser is left to make whatever noise the operating system allows
it. One volume serves both, and is shown only while something would use it.

### Making a noise

A browser's `silent: false` is a request, not an instruction. Whether a
notification makes a sound is a matter for the operating system — on macOS it
is a per-application setting under **System Settings → Notifications**, off for
many people and unreachable from an extension.

So the sound is the panel's own, made by whichever route the browser leaves
open. Chrome's background is a service worker, which cannot play audio at all,
so the sound is played in an offscreen document borrowed for the purpose.
Firefox's background is an event page with a DOM of its own, so it plays the
sound directly. Safari has neither, and no notification to play a sound
alongside.

Neither asks its audio context whether it may start before scheduling the
notes. A context the browser will not let start does not refuse — it holds the
question open until a click that a background page will never see — so waiting
for an answer would wait for ever and take the notification down with it. The
notes are scheduled either way: where audio is allowed they play, and where the
reader has told the browser to block it they do not, which is what they asked
for. The notification arrives regardless.

There are five of them — chime, ping, bell, knock, marimba — plus silence,
chosen under the kind of notification they belong to: the default pair is a
two-note chime for what was asked for and a softer single note for what merely
happened. Volume is the reader's, and every control on the settings page plays
what it is about the moment it is touched, because a list of names for noises is
not a choice anyone can make by reading it.

Each sound is a handful of numbers — frequency, start, length — turned into
sine or triangle notes with a short fade at both ends, since a square-edged
note clicks and the click is the difference between a chime and a fault.
Synthesised rather than shipped, because a few lines of Web Audio weigh
nothing and can be read in a diff, which an audio file cannot. The same
definitions are used by the settings page and by the notification, so what is
heard while choosing is what will arrive.

When the panel is making the sound it asks the browser to keep quiet, so there
is exactly one either way; switching the sound off hands the question back to
the browser and the system.

## Developer mode

Reminders are the hardest part of this to work on, because the good ones take
until tomorrow morning to happen. The settings page therefore carries a
developer section — deliberately apart from the feature switches, which are
choices about how the panel behaves rather than ways of making it behave wrongly
on purpose. Switched on, it gives each named reminder a length in seconds
instead of a place on the clock, and the menu says so: **In an hour · 30s**. The
choice that waits on the row is left alone, having no clock to override.

It also sends a test notification, which answers the question that brings most
people here — whether nothing appeared because nothing fired, or because the
browser was never given permission to show it. On Safari there is nothing to
test, so the button is not shown.

A browser will not wake an extension more often than every 30 seconds, so a
reminder set for less than that is marked due in the panel straight away while
the toolbar count and any notification arrive on the browser's own schedule.

## Stacked pull requests

A stack is a chain of pull requests where each one targets the branch of the
one below it. GitHub exposes membership directly: `PullRequest.stackEntry`
gives this pull request's position, and `PullRequest.stack` gives the stack's
number, size, base branch, and entries. Nothing is inferred from branch names.

A stacked row carries a `layer/size` badge, and that badge is the control: it
slides open a list of the whole stack, read from the base branch up. The row it
was expanded from stays in that list and is marked with a chevron instead of
being filtered out, because a stack is only legible as a whole. A chevron along
the top edge of the slide-out shuts it again, since by then the badge that
opened it may be several layers up the panel. Expansion is
deliberately not on the row itself: clicking a row still means "open this pull
request".

`stack` and `stackEntry` are a public preview. A host that has not been given
the fields rejects the whole query rather than returning null, which would take
the list down with it, so the first such failure drops the stack fields and
every request after it asks the smaller question. Losing the badges is an
acceptable outcome; losing the list is not.

Only the first 20 layers of a stack are read per row, but `size` comes from
GitHub, so a deeper stack still reports its real size and says how many layers
it is not showing.

### Pinned rows

Pins are stored as node ids under `pinnedIds`, apart from the queries that
surface them, so a pinned row keeps its place whichever query it turns up in.
Only rows already loaded can be lifted, so a pin on an item further down a
result set surfaces once its page arrives.

### Managing what is set aside

Hiding a row, setting a reminder and pinning a row all leave the same kind of
trace: a node id in `itemMemory` or `pinnedIds`, apart from the row it stands
for. The settings page gathers those three back into one panel — hidden rows,
reminders, pinned rows — so what was set apart one row at a time can be
reviewed and undone in one place.

The panel holds only ids, so it asks the worker to resolve them against the
shared cache and shows each row's title, repository and link from whatever the
cache still holds. A row the cache has since dropped is listed by its id
instead and stays fully actionable: bringing it back, moving or dropping its
reminder, and lifting its pin each need only the id. Every action writes to the
same `itemMemory` or `pinnedIds` the sidebar and worker already watch, so the
count on the toolbar, the alarm for the next timed reminder and every open tab
follow along without the panel telling any of them directly.

### Collapsing a dock

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

## Caching

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
- **A background refresh says so.** Serving the cached copy resolves the tab's
  own request immediately, so the network call that follows it happens with
  nothing in flight locally to report. The page carries a `revalidating` flag
  instead, and a green hairline along the header's bottom border pulses — with
  a lighter crest running left to right across it — until the broadcast lands.
  It is held briefly so a fast refresh does not flicker, and capped so a
  refresh that failed cannot leave the panel looking busy forever.
- **The refresh window follows your setting.** The refresh interval you choose is
  exactly how long a cached page is served for, with a 15s floor so a short
  interval cannot flood the API. With polling off, cached pages last 5 minutes.
- **The refresh button always wins.** It drops the cached pages for that query
  first, so it is a true forced refresh. Entries older than a day are pruned on
  startup.

The cache holds a *shape* as well as a value. A row written before a field
existed is not a hit for a panel that expects it — it is a row that will crash
the list — so the database version is bumped whenever a cached row gains a
field, and the store is rebuilt rather than migrated. Every entry in it is one
request away from coming back.

## Development

```bash
npm run dev              # watch + auto-reload for Chrome (see below)
npm run dev firefox      # or safari
node scripts/make-icons.ts  # redraw public/icon-*.png
npm run build            # production build, all three browsers
npm run build:chrome     # or build:firefox / build:safari
npm run typecheck
npm run lint
npm test                 # unit tests + headless browser tests
npm run test:unit        # unit tests only (no browser needed)
```

Each browser is built separately into `dist/<browser>/`. The manifest is
generated per browser by `scripts/manifest.ts` rather than committed, since the
three do not accept the same one — most of all the `background` key, where
Chrome and Safari run a service worker and Firefox runs an event page. Both Vite
configs are given a `__BROWSER__` constant, so the branches meant for the other
two browsers are dropped from the bundle rather than shipped and never taken.

`src/lib/browser.ts` is the single door onto the extension API. It takes
`browser` where the browser provides it and `chrome` where it does not, so every
call can be awaited without a polyfill, and it states plainly in one table what
each browser can be asked to do. Nothing else in `src/` touches a global
namespace.

### Watch mode

```bash
npm run dev              # chrome
npm run dev firefox
npm run dev safari
```

One browser at a time, because watching all three would triple the rebuild for
two copies nobody has loaded. Load `dist/<browser>` once — it is named **GitHub
Sidecar (dev)** so you can tell it apart from an installed copy — and from then
on, saving a file rebuilds, reloads the extension, and refreshes your open
github.com tabs automatically. Safari is the exception: it will not let an
extension reload itself, so each change still needs a rebuild in Xcode.

This is live reload, not hot module replacement. Two things rule HMR out: no
browser picks up content script edits without reloading the whole extension, and
github.com's CSP governs content script fetches, so the socket an HMR client
needs would be blocked. In practice the difference is small — window position,
saved queries, and settings all live in extension storage, so they survive the
reload.

How it works: `scripts/dev.ts` runs both Vite builds in watch mode and serves a
long-poll endpoint on `127.0.0.1:5599`. The background worker (which is *not*
subject to page CSP) holds a request open against it; when a rebuild lands the
request resolves and the worker calls `runtime.reload()`, then refreshes
github.com tabs once it restarts. Because the pages and content bundles come
from two independent watchers, the worker also records which build it reloaded
for and reloads again if the other bundle landed late.

The dev-only code is behind `import.meta.env.MODE === 'development'` and is
tree-shaken out of production builds, as is the extra localhost host permission.
Set `DEV_RELOAD_PORT` to use a different port.

### Tests

The browser tests load the real `dist/chrome/content.js` into a headless Chrome
with a stubbed extension API, and cover mounting, styling, virtualisation,
dragging, locking, and collapsing. Docked mode is exercised against a stand-in
for a github.com page — full-width chrome above a centred column — at a viewport
wide enough for the gutter to hold the panel and at one that is not. The options
page is tested against a served copy of `dist/chrome/`, and the IndexedDB store
is exercised against real IndexedDB. Cache policy (freshness, coalescing,
active-tab gating) is unit tested against an in-memory store. How a notification
degrades where the browser shows less than Chrome does is unit tested directly.
Browser suites skip automatically when no Chrome binary is found. Run
`npm run build:chrome` before `npm test`.

Firefox and Safari are not driven by the test suite. Puppeteer can drive Firefox
but cannot install an extension into it without a prepared profile, and Safari
has no headless mode that can load one at all — so both are checked by hand
against the guides in `docs/`.

### A note on `.npmrc`

The committed `.npmrc` sets `replace-registry-host=never`. Without it, npm
rewrites every tarball URL to a mirror that 404s for some packages (notably
`@types/estree`, a transitive dependency of Vite). Remove it if your registry
does not have that problem.
