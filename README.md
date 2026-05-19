# Recent iOS App Store Reviews Viewer

Polls Apple's App Store RSS feed for one or more iOS apps and displays recent
reviews.

- **Backend** — Node.js + TypeScript + Fastify. Polls every 5 min, persists to
  per-app JSON files, exposes a REST API.
- **Frontend** — Vite + React + TypeScript + Tailwind + shadcn/ui. Lists
  reviews from the last 48h (or 7d / 30d), polls the backend on the same
  cadence so new reviews surface without a manual refresh.

---

## Quick start

### Option A — Docker (recommended)

Requires Docker. From the repo root:

```bash
docker compose up
```

Backend on `:3001`, frontend on `:5173`. Reviews persist in a named volume.

Open http://localhost:5173.

Stop with `docker compose down` (`-v` to also wipe persisted reviews).
After source changes, add `--build` to rebuild images.

### Option B — Local

Requires Node 20+ and **pnpm**.

```bash
# 1. Backend
cd backend && pnpm install && pnpm dev    # → http://localhost:3001

# 2. Frontend (in another terminal)
cd frontend && pnpm install && pnpm dev   # → http://localhost:5173
```

### Other commands

```bash
# Backend
pnpm test             # vitest run (26 tests)
pnpm lint             # eslint
pnpm format           # prettier --write

# Frontend
pnpm build            # tsc -b && vite build
pnpm lint             # eslint
```

### Configuration

`backend/config.json`:

```json
{
  "port": 3001,
  "pollIntervalMs": 300000,
  "dataDir": "./data",
  "apps": [{ "id": "595068606", "name": "Headspace", "country": "us" }]
}
```

App ID = the numeric segment in any App Store URL. Append to `apps` and
restart the backend.

> ℹ️ Apple's RSS is often sparse on recent reviews. If 48h returns nothing,
> switch the **Window** selector to 7d or 30d.

---

## Architecture

### Repo layout

```
runway/
├── backend/
│   ├── src/
│   │   ├── domain/      # types (Review, AppConfig, Config)
│   │   ├── infra/       # I/O (rss, store, config)
│   │   ├── app/         # orchestration (poller)
│   │   ├── http/        # Fastify routes (server)
│   │   ├── lib/         # cross-cutting (Result type)
│   │   └── index.ts     # entrypoint + graceful shutdown
│   ├── tests/           # vitest — rss + store coverage
│   ├── data/            # runtime per-app review JSON (gitignored)
│   └── config.json
└── frontend/
    ├── src/
    │   ├── components/ui/   # shadcn primitives
    │   ├── components/      # app components (ReviewList)
    │   ├── lib/             # cn() utility
    │   ├── api.ts           # SWR fetchers
    │   ├── App.tsx          # orchestration
    │   ├── types.ts         # mirrors backend types
    │   └── index.css        # Tailwind v4 + shadcn tokens
    └── vite.config.ts       # /api/* → :3001 proxy
```

### Backend design

Closure-based factories, not classes:

- **`rss.ts`** — walks Apple's pages until a known ID or page cap. Boundary
  cast at `res.json()`, per-row validation in `toReview()` so one bad row
  doesn't poison the page.
- **`store.ts`** — per-app JSON, atomic write (`tmp` + `rename`), dedupes by
  ID, sorts newest-first on every merge.
- **`poller.ts`** — recursive `setTimeout` (overlap-proof), sequential per
  app (gentle on Apple), errors per app log + continue.
- **`server.ts`** — Fastify: `GET /health`, `/apps`, `/apps/:id/reviews?windowHours=`.
- **`index.ts`** — graceful SIGINT/SIGTERM: stops the poller first (so it
  doesn't write during shutdown), then closes the server.

### Frontend design

- **State** — [SWR](https://swr.vercel.app). Tuple key `["reviews", appId, windowHours]`
  gives each combo its own cache slot. `refreshInterval` matches
  `pollIntervalMs` so new reviews surface within a cycle.
- **UI** — shadcn/ui on Tailwind v4. No custom CSS file — utility classes only.
- **Proxy** — Vite forwards `/api/*` to `:3001` in dev. In Docker, nginx does
  the same job.

### Key decisions

| Decision                                      | Why                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Fastify** over stdlib `http`                | Idiomatic Node — typed routes, JSON parsing, CORS for one dep                                        |
| **Per-app JSON file**                         | Spec allows external files; per-app gives natural isolation and easy debugging. Production = real DB |
| **`Result<T,E>`** at HTTP boundaries          | Status codes are meaningful for upstream failures. Filesystem errors throw — Node idiomatic          |
| **Atomic write via `rename`**                 | `rename` is atomic on same-FS; a crash never corrupts the canonical file                             |
| **Recursive `setTimeout`** over `setInterval` | A slow poll can't overlap itself; next tick scheduled only after current finishes                    |
| **SWR** for client data                       | Industry standard, ~5KB. Caching, dedup, revalidation, polling for free                              |
| **shadcn/ui**                                 | Components live in `src/components/ui/` — editable like any code, no opaque vendor styles            |
| **Vite proxy** for `/api/*`                   | No CORS dance; frontend code stays environment-agnostic                                              |
| **Backend tests only**                        | RSS parsing, store, filter — the meaty logic. UI is a thin shell over those                          |

---

## Future improvements

- **Add-app UI** — `Dialog` + `POST /apps` + a small `configStore` with
  atomic writes. Planned for a separate branch.
- **Dynamic config validation** with Zod. Trusted via cast today — fine for a
  single file we control.
- **Server unit tests via `fastify.inject()`** — needs a small refactor to
  expose `registerRoutes` separately.
- **Virtualized list** once the window grows to months and crosses ~200
  entries.
- **Shared types package** between backend and frontend. A 2-package monorepo
  doesn't justify the setup tax; 3+ would.
- **`pino-pretty`** in dev for human-readable Fastify logs.
- **Go branch** — Go branch — an extra backend implementation in Go, included to show how I would ramp up on Runway’s backend stack.

---

## Testing

```bash
cd backend && pnpm test
```

26 tests, ~300ms:

- **`tests/rss.test.ts`** (13) — Apple's labeled shape, filters bad rows
  (no rating, non-integer, out of range), `Result.fail` on HTTP / network /
  JSON failures, pagination walks and breaks on known IDs / `maxPages`.
- **`tests/store.test.ts`** (13) — ENOENT → `[]`, dedupe by ID, newest-first
  sort, per-appId isolation, **survives leftover `.tmp`**, persists across
  `createStore` instances (the restart-survival contract).
