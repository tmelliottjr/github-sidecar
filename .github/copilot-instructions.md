# Copilot Instructions — GitHub Sidecar

## What this is

A Chrome extension (Manifest V3) that displays GitHub issues, PRs, and review requests in a browser side panel. Users authenticate with a Personal Access Token stored in `chrome.storage.local`.

## Build & lint

```bash
npm run build    # tsc -b && vite build → outputs to dist/
npm run lint     # eslint (flat config, TS/TSX only)
npm run dev      # vite dev server with HMR for local development
```

No test framework is configured.

After building, load `dist/` as an unpacked Chrome extension at `chrome://extensions`.

## Architecture

The extension has two entry points:

- **`src/background.ts`** — Minimal service worker that enables side panel on action click.
- **`src/sidepanel/`** — The React app rendered in Chrome's side panel. This is where all UI and logic lives.

### Data flow

All GitHub data comes from direct `fetch` calls to the GitHub REST API (v3) inside custom hooks (`src/sidepanel/hooks/`). There is no backend, no GraphQL, and no SDK — just raw `fetch` with `Bearer` token auth and `Accept: application/vnd.github.v3+json`.

TanStack Query manages caching, pagination, and background refetching. The query cache is persisted to `chrome.storage.local` via a custom `AsyncStoragePersister` (configured in `main.tsx`).

### State persistence

Each feature manages its own `chrome.storage` key through its hook:

- `useAuth` → `github_pat` (token + user validation)
- `useSavedViews` → `saved_views` (user-created view tabs)
- `useSavedRepos` → `saved_repos` (bookmarked repositories)
- `useTheme` → `theme_preference` (light/dark/system)
- Scroll positions use `chrome.storage.session` (ephemeral, module-level cache in `ViewList.tsx`)

### Navigation

There is no router. The app uses conditional rendering in `App.tsx` to switch between the main tab view, settings, saved repos, and the view editor.

## Key conventions

### Styling

Tailwind CSS v4 with a class-based dark mode toggle (`.dark` on `<html>`). The color palette is defined as custom theme tokens in `src/sidepanel/styles/index.css` using `@theme` — use semantic names like `bg-primary`, `text-secondary`, `border`, `accent`, `danger`, `state-open`, etc. All component styling is inline Tailwind classes; there are no CSS modules.

### Hooks

Custom hooks in `src/sidepanel/hooks/` own all data fetching, caching, and persistence logic. Components should not call `fetch` or `chrome.storage` directly — go through hooks.

Search hooks (`useRepoSearch`, `useUserSearch`) implement 300ms debouncing internally.

### Types

All shared TypeScript interfaces live in `src/types.ts`. The codebase uses `type` imports (`import type { ... }`) enforced by `verbatimModuleSyntax` in tsconfig.

### Components

- Icons come from `lucide-react`.
- Forms use `@tanstack/react-form` (see `ViewEditor.tsx`).
- Long lists use `@tanstack/react-virtual` for virtualized scrolling (see `ViewList.tsx`).
- Hovercards use a portal-based `Hovercard` component with configurable show/hide delays.

### Chrome extension APIs

The extension uses `chrome.storage.local` for persistent data and `chrome.storage.session` for ephemeral data. The `manifest.json` requests only `sidePanel` and `storage` permissions. Vite builds the extension using `@crxjs/vite-plugin`.
