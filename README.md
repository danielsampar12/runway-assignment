# Recent iOS App Store Reviews Viewer

A small backend service that polls Apple's App Store RSS feed for one or more
iOS apps and a React frontend that displays the recent reviews.

- **Backend** — Node.js + TypeScript + Fastify. Polls Apple every 5 minutes,
  persists reviews to per-app JSON files, exposes a REST API.
- **Frontend** — Vite + React + TypeScript + Tailwind + shadcn/ui. Lists
  reviews from the last 48 hours (configurable to 7d / 30d), polls the backend
  on the same cadence so new reviews surface without a manual refresh.

---

## Quick start

### Option A — Docker (recommended for reviewers)

Requires Docker Desktop (or Docker Engine + Compose). From the repo root:

```bash
docker compose up --build
```

That builds both images, starts the backend on **:3001** and the frontend on
**:5173**, persists reviews in a named volume (`backend-data`), and waits for
the backend's `/health` endpoint before starting the frontend.

Then open http://localhost:5173.

To stop: `docker compose down`. To wipe persisted reviews:
`docker compose down -v`.

### Option B — Local (pnpm)

Requires Node 20+ and pnpm.

```bash
# 1. Backend
cd backend
pnpm install
pnpm dev              # tsx watch → http://localhost:3001

# 2. Frontend (in another terminal)
cd frontend
pnpm install
pnpm dev              # vite → http://localhost:5173
```

Then open http://localhost:5173.

### Other useful commands

```bash
# Backend
pnpm test             # vitest run (26 unit tests)
pnpm lint             # eslint
pnpm format           # prettier --write

# Frontend
pnpm build            # tsc -b && vite build
pnpm lint             # eslint
```

### Configuration

`backend/config.json` controls polled apps, poll interval, port, and where
reviews are persisted:

```json
{
  "port": 3001,
  "pollIntervalMs": 300000,
  "dataDir": "./data",
  "apps": [
    { "id": "595068606", "name": "Headspace", "country": "us" }
  ]
}
```

Add more apps by appending objects to the `apps` array and restarting the
backend. The App Store ID is the numeric segment in any App Store URL
(`apps.apple.com/us/app/<name>/id<this-number>`).

> ℹ️ Apple's RSS is sometimes sparse on recent reviews. If the 48-hour window
> returns nothing, switch the **Window** selector in the UI to 7d or 30d.

---

## Architecture

### Repo layout

```
runway/
├── backend/                       # API server + poller
│   ├── src/
│   │   ├── domain/                # types (Review, AppConfig, Config)
│   │   ├── infra/                 # I/O boundaries (rss, store, config)
│   │   ├── app/                   # orchestration (poller)
│   │   ├── http/                  # Fastify routes (server)
│   │   ├── lib/                   # cross-cutting utilities (Result type)
│   │   └── index.ts               # entrypoint + graceful shutdown
│   ├── tests/                     # vitest — rss + store coverage
│   ├── data/                      # runtime: per-app review JSON (gitignored)
│   └── config.json                # apps, port, interval, data dir
└── frontend/
    ├── src/
    │   ├── components/ui/         # shadcn components (Select, Card, etc.)
    │   ├── components/            # app-specific components (ReviewList)
    │   ├── lib/                   # cn() utility
    │   ├── api.ts                 # fetch helpers (used as SWR fetchers)
    │   ├── App.tsx                # orchestration + SWR usage
    │   ├── types.ts               # mirrors backend Review / AppInfo shapes
    │   └── index.css              # Tailwind v4 + shadcn theme tokens
    └── vite.config.ts             # /api/* proxied to backend on :3001
```

### Backend design

Layered, closure-based factories instead of classes:

- `rss.ts` — fetches Apple's RSS, parses the labeled JSON shape into `Review`,
  walks pages until it hits a known review ID or the page cap. The boundary
  cast (`as RawFeed`) is a single unsafe line; per-row validation in
  `toReview()` keeps malformed entries from leaking through.
- `store.ts` — per-app JSON file at `data/<appId>.json`. Atomic write via
  `writeFile(tmp)` + `rename(tmp, target)` — a crash mid-write leaves the old
  file intact, and any leftover `.tmp` is overwritten next merge.
  Dedupes by review ID and sorts newest-first on each merge.
- `poller.ts` — recursive `setTimeout` loop (not `setInterval`) so a slow
  poll never overlaps itself. Sequential per-app: gentler on Apple, easier to
  reason about for "any number of apps". One app's failure logs and continues
  to the next.
- `server.ts` — Fastify, three routes: `GET /health`, `GET /apps`,
  `GET /apps/:appId/reviews?windowHours=48`. CORS enabled for the dev origin.
- `index.ts` — wires the pieces, handles SIGINT/SIGTERM by stopping the
  poller (so we don't write to the store mid-shutdown) then closing the
  server.

### Frontend design

- **State** managed by [SWR](https://swr.vercel.app) — `useSWR("apps")` for
  the app list, and `useSWR(["reviews", appId, windowHours], fetcher, { refreshInterval })`
  for the review list. The tuple key gives SWR a per-combination cache slot.
  `refreshInterval` matches the backend's `pollIntervalMs` so new reviews
  surface within one cycle.
- **UI** built with shadcn/ui (Select, Card, Skeleton, Alert) on Tailwind v4.
  No custom CSS file — just utility classes.
- **Proxy** — Vite's dev server forwards `/api/*` to `http://localhost:3001`.
  Avoids CORS gymnastics during local dev and gives the frontend a stable
  base URL that doesn't depend on environment.

### Key decisions

| Decision | Why |
|---|---|
| **Fastify** over stdlib `http` | Idiomatic Node, gives typed routes, JSON parsing, error handling and CORS for one dep |
| **Per-app JSON file** over SQLite | The spec explicitly allows an external file; per-app file gives natural isolation and easy debuggability. A real production system would use a real DB |
| **Result type** for HTTP boundary failures | Adopted from a Result/Either pattern I use in another project. Used only where status codes are meaningful (the Apple fetch). Internal/filesystem errors throw — Node idiomatic |
| **Atomic write via `rename`** | Standard pattern. `rename` is atomic on POSIX same-filesystem; a crash mid-write never corrupts the canonical file |
| **Recursive `setTimeout`** over `setInterval` | If a poll runs longer than the interval (rate limit, slow upstream), `setInterval` would queue overlapping calls. The recursive pattern guarantees the next tick is scheduled only after the previous finishes |
| **SWR** for client data fetching | Industry standard, ~5KB. Gives caching, deduping, revalidation, polling, and `isLoading` / `error` for free. The hand-rolled `useState`+`useEffect` equivalent is harder to defend |
| **shadcn/ui** | Components live in `src/components/ui/` and can be edited like any other file — no opaque vendor styles. Tailwind v4 keeps the build lean |
| **Vite proxy** for `/api/*` | No CORS dance in dev, frontend code is environment-agnostic |
| **No frontend tests** | The spec's bonus criterion is "well tested"; backend tests cover the meaty logic (RSS parsing, store dedupe/persistence, 48h filter). The UI is a thin shell over those. |

---

## Future improvements

Things I considered but didn't ship:

- **Add-app UI**. A `Dialog` with a form (appId, name, country) calling a new
  `POST /apps` endpoint. Would need a small `configStore` (sibling to the
  review `Store`) with atomic writes to `config.json`, plus a way to signal
  the running poller to start polling the new app immediately. Planned for a
  separate branch.
- **Dynamic config validation** with Zod or similar. Currently the
  `config.json` shape is trusted via cast — fine for a single file we control,
  not fine for anything taking external input.
- **Server unit tests via `fastify.inject()`**. Would need a small refactor to
  expose `registerRoutes` separately from `createServer`. End-to-end coverage
  via curl already verifies the contract.
- **Virtualized review list** (`react-virtuoso` or similar) once the window
  can extend to months and the list crosses ~200 entries.
- **Shared types package** between backend and frontend. Currently
  `frontend/src/types.ts` mirrors `backend/src/domain/types.ts`. A 2-package
  monorepo doesn't justify the setup tax of a workspace shared lib; at 3+
  packages it would.
- **`pino-pretty`** in dev for human-readable Fastify logs.
- **Go branch** — a port of the backend to Go, matching Flow's primary stack.

---

## Testing

```bash
cd backend && pnpm test
```

26 tests, ~300ms:

- `tests/rss.test.ts` (13) — parses Apple's labeled shape, filters entries
  without `im:rating`, rejects non-integer/out-of-range scores, returns
  `Result.fail` with the right HTTP status on HTTP / network / JSON parse
  failures, walks pages and breaks on known IDs, respects `maxPages`, bubbles
  mid-page failures.
- `tests/store.test.ts` (13) — ENOENT returns `[]`, merge dedupes by ID,
  sorts newest-first, isolates by appId, **survives a leftover `.tmp` from a
  prior crash**, and persists across multiple `createStore` instances (the
  restart-survival contract).
