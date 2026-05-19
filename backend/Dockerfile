# Backend (Go): builds a static binary, runs in a minimal alpine image.

# ---- Build stage ----
FROM golang:1.22-alpine AS build

WORKDIR /src

# Cache dependencies separately for faster rebuilds.
COPY go.mod go.sum* ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /runway-backend ./

# ---- Runtime stage ----
FROM alpine:3.20

# ca-certificates is needed for HTTPS calls to itunes.apple.com.
RUN apk --no-cache add ca-certificates

WORKDIR /app
COPY --from=build /runway-backend /usr/local/bin/runway-backend
COPY config.json ./config.json

# The store writes here at runtime; declared as a volume so reviews survive
# `docker compose down` (when bound to a named volume in compose).
VOLUME ["/app/data"]

EXPOSE 3001

CMD ["/usr/local/bin/runway-backend"]
