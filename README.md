# GitHub Sidecar

A Chrome extension that puts your GitHub issues, pull requests, and review requests right in your browser's side panel — so you can keep an eye on what matters without ever leaving the page you're on.

## What is this?

If you're tired of constantly switching tabs to check on your GitHub work, Sidecar is for you. Click the extension icon and a side panel slides open with a fast, filterable view of everything on your plate: issues you're assigned to, PRs you've opened, code reviews waiting on you.

You can create **saved views** — think of them as bookmarked searches — with custom filters for state, repo, sort order, and more. Power users can drop in raw GitHub search syntax for full control. Items show CI status, merge conflicts, labels, and you can hover to preview the latest comments without clicking through.

## Features

- **Saved views** — Create tabs for the searches you care about (e.g. "My Open PRs", "Needs Review")
- **Live CI status** — See check run results and merge conflict warnings inline
- **Comment previews** — Hover over any item to read the latest comments with full Markdown rendering
- **Infinite scroll** — Virtualized list that handles large result sets smoothly
- **Review badge** — Know at a glance how many reviews are waiting for you
- **Advanced search** — Supports GitHub's full search query syntax for power users

## Getting started

You'll need [Node.js](https://nodejs.org/) (v18+) and a [GitHub Personal Access Token](https://github.com/settings/tokens) with `repo` scope (for private repos — no scopes needed for public repos only).

### Build

```bash
npm install
npm run build
```

This outputs a production build to the `dist/` folder.

### Install as an unpacked Chrome extension

1. Run `npm run build` to generate the `dist/` folder
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked** and select the `dist/` folder from this project
5. The GitHub Sidecar icon will appear in your extensions toolbar — click it to open the side panel
6. Paste in your GitHub Personal Access Token when prompted, and you're good to go

> **Tip:** After making code changes, run `npm run build` again, then go back to `chrome://extensions` and click the refresh icon (↻) on the Sidecar card to pick up the new build.

### Development

For local development with hot reload:

```bash
npm run dev
```

## Tech stack

React · TypeScript · Vite · TanStack Query · TanStack Virtual · Chrome Manifest V3
