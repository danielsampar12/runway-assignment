# Frontend: multi-stage. Stage 1 builds the Vite bundle; stage 2 serves the
# static output with nginx and proxies /api/* to the backend service.

# ---- Build stage ----
FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Serve stage ----
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
