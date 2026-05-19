# Backend: Node + pnpm, runs the review poller and HTTP API.
FROM node:24-alpine

WORKDIR /app

# pnpm via corepack (bundled with Node 24).
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Install deps first for layer caching.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App source.
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY config.json ./config.json

# The store writes here at runtime; declared as a volume so reviews survive
# `docker compose down` (when bound to a named volume in compose).
VOLUME ["/app/data"]

EXPOSE 3001

CMD ["pnpm", "start"]
