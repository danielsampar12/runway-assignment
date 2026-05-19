# Recent iOS App Store Reviews Viewer

Polls Apple's App Store RSS feed for one or more iOS apps and displays recent
reviews.

> 📌 **Branch:** `go-backend` — the backend is rewritten in Go.
> The Node.js + Fastify variant lives on `main`. Both speak the same on-disk
> JSON format and the same HTTP API, so the frontend works against either.

- **Backend** — Go (stdlib `net/http` + `encoding/json`). Polls every 5 min,
  persists to per-app JSON files, exposes a REST API.
- **Frontend** — Vite + React + TypeScript + Tailwind + shadcn/ui. Lists
  reviews from the last 48h (or 7d / 30d), polls the backend on the same
  cadence so new reviews surface without a manual refresh.

---

## Quick start

### Option A — Docker (recommended)

Requires Docker Desktop. From the repo root:

```bash
docker compose up
```

Backend on `:3001`, frontend on `:5173`. Reviews persist in a named volume.

Open http://localhost:5173.

Stop with `docker compose down` (`-v` to also wipe persisted reviews).
After source changes, add `--build` to rebuild images.

### Option B — Local

Requires **Go 1.23+** for the backend and Node 20+ / **pnpm** for the
frontend.

> ⚠️ Go 1.22 + macOS 26 (Sequoia) has a known LC_UUID linker bug that prevents
> the binary from launching. Go 1.23+ resolves it, or you can just use Docker.

```bash
# 1. Backend
cd backend && go run .                     # → http://localhost:3001

# 2. Frontend (in another terminal)
cd frontend && pnpm install && pnpm dev    # → http://localhost:5173
```

### Other commands

```bash
# Backend
go test ./...        # 24 tests (rss + store)
go vet ./...
gofmt -d .           # check formatting; -w to apply

# Frontend
pnpm build           # tsc -b && vite build
pnpm lint            # eslint
```

If your local Go is < 1.23, run the tests inside a container:

```bash
docker run --rm -v "$(pwd):/src" -w /src golang:1.23-alpine go test ./...
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
│   ├── main.go                      # entrypoint + wiring + graceful shutdown
│   ├── go.mod
│   ├── internal/
│   │   ├── domain/types.go          # Review, AppConfig, Config structs
│   │   ├── config/config.go         # config.json loader
│   │   ├── rss/                     # Apple RSS fetch + parse
│   │   │   ├── rss.go
│   │   │   └── rss_test.go
│   │   ├── store/                   # per-app JSON, atomic write, dedupe
│   │   │   ├── store.go
│   │   │   └── store_test.go
│   │   ├── poller/poller.go         # interval loop, sequential per app
│   │   └── server/server.go         # net/http handlers
│   ├── data/                        # runtime per-app review JSON (gitignored)
│   └── config.json
└── frontend/
    ├── src/
    │   ├── components/ui/           # shadcn primitives
    │   ├── components/              # app components (ReviewList)
    │   ├── lib/                     # cn() utility
    │   ├── api.ts                   # SWR fetchers
    │   ├── App.tsx                  # orchestration
    │   ├── types.ts                 # mirrors backend types
    │   └── index.css                # Tailwind v4 + shadcn tokens
    └── vite.config.ts               # /api/* → :3001 proxy
```

### Backend design

Conventional Go layout — small package per concern under `internal/`:

- **`rss`** — `FetchAllNewReviews` walks Apple's pages until a known ID or
  page cap. JSON unmarshalled into private `rawEntry` / `rawFeed` types,
  `toReview()` validates each row (rating in 1-5, required fields present)
  so one malformed entry doesn't poison the page. Handles Apple's
  array-or-single `entry` quirk via `normalizeEntries`.
- **`store`** — per-app JSON file at `data/<appId>.json`. Atomic write via
  `os.WriteFile(tmp)` + `os.Rename(tmp, target)`. Per-store `sync.Mutex`
  serializes concurrent merges; reads don't need locking because rename is
  atomic.
- **`poller`** — `Start()` spawns a goroutine that polls immediately, then
  uses a `time.Timer` driven by a `select` loop with a `done` channel for
  clean shutdown. Sequential per app (gentle on Apple); errors per app are
  logged and skipped, never crash the cycle.
- **`server`** — `net/http` mux with three routes:
  `GET /health`, `/apps`, `/apps/:appId/reviews?windowHours=`. CORS
  middleware wraps the mux. Returns `*http.Server` so `main.go` can call
  `Shutdown(ctx)` directly.
- **`main`** — wires it all together, handles SIGINT/SIGTERM by stopping the
  poller first (so it doesn't write during shutdown), then `Shutdown(ctx)`s
  the server with a 5s timeout.

### Frontend design

- **State** — [SWR](https://swr.vercel.app). Tuple key `["reviews", appId, windowHours]`
  gives each combo its own cache slot. `refreshInterval` matches
  `pollIntervalMs` so new reviews surface within a cycle.
- **UI** — shadcn/ui on Tailwind v4. No custom CSS file — utility classes only.
- **Proxy** — Vite forwards `/api/*` to `:3001` in dev. In Docker, nginx does
  the same job.

### Key decisions

| Decision                                          | Why                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Go stdlib `net/http`**                          | Capable enough — routing, middleware, graceful shutdown all built-in. No framework needed; keeps the implementation lightweight and dependency-minimal |
| **Per-app JSON file**                             | Spec allows external files; per-app gives natural isolation and easy debugging. Production = real DB                                                   |
| **Atomic write via `os.Rename`**                  | Atomic on same-FS; a crash never corrupts the canonical file                                                                                           |
| **`time.Timer` + select loop** over `time.Ticker` | Same overlap-proof reasoning as the Node version's recursive setTimeout — next tick scheduled only after current pollOnce finishes                     |
| **`sync.Mutex` on Merge**                         | Serializes the read-then-write cycle. `Read` is safe without the lock because rename is atomic                                                         |
| **JSON shape matches the Node version**           | Same `data/<id>.json` layout — switch branches without losing reviews                                                                                  |
| **`internal/` package layout**                    | Go convention for non-importable subpackages; signals "implementation details" to anyone consuming the module                                          |
| **SWR** for client data                           | Industry standard, ~5KB. Caching, dedup, revalidation, polling for free                                                                                |
| **shadcn/ui**                                     | Components live in `src/components/ui/` — editable like any code, no opaque vendor styles                                                              |

---

## Future improvements

- **Add-app UI** — Dialog + `POST /apps` + a small config store with atomic
  writes to `config.json`, plus a way to signal the poller to start polling
  the new app immediately. Planned for a separate branch.
- **HTTP integration tests** with `httptest.NewServer` — would require
  injecting a base URL into `rss.go`. Skipped for time; the pure-parsing
  functions (`toReview`, `normalizeEntries`) are unit-tested directly.
- **Structured logging** (`log/slog`) instead of the default `log` package.
- **Graceful shutdown for the poller's in-flight `pollOnce`** — currently the
  `done` channel only stops the loop at iteration boundaries. A context.Context
  threaded through `FetchReviewsPage` would cancel in-flight HTTP requests too.
- **Virtualized list** on the frontend once the window grows to months and
  crosses ~200 entries.

---

## Testing

```bash
cd backend && go test ./...
```

24 tests across 2 packages:

- **`internal/rss/rss_test.go`** (12) — `toReview` validates rating (1-5
  integer), required fields, app-metadata skip. `normalizeEntries` handles
  array, single object, empty, and invalid JSON. `buildFeedURL` smoke test.
- **`internal/store/store_test.go`** (12) — ENOENT → `[]`, dedupe by ID
  (last-write-wins), combines across calls, newest-first sort, per-appId
  isolation, **survives leftover `.tmp` from a crash**, restart survival
  (fresh `Store` reads the previous instance's data), on-disk JSON is valid.

HTTP-level tests are skipped intentionally — the pure parsing functions cover
the meaty logic, and end-to-end coverage via curl proves the wire contract.
