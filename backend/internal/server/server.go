package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"runway/backend/internal/domain"
	"runway/backend/internal/store"
)

type Config struct {
	Port  int
	Store *store.Store
	Apps  []domain.AppConfig
}

// New builds an *http.Server with three routes:
//
//	GET /health                              → {"ok": true}
//	GET /apps                                → []AppConfig
//	GET /apps/:appId/reviews?windowHours=48  → []Review (last N hours, newest first)
func New(cfg Config) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/apps", handleApps(cfg.Apps))
	mux.HandleFunc("/apps/", handleAppReviews(cfg))

	return &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", cfg.Port),
		Handler:           cors(mux),
		ReadHeaderTimeout: 5 * time.Second,
	}
}

// cors mirrors the Node backend's open CORS policy — fine for dev, tighten
// for production.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleApps(apps []domain.AppConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, apps)
	}
}

func handleAppReviews(cfg Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Expected path: /apps/{appId}/reviews
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) != 3 || parts[0] != "apps" || parts[2] != "reviews" {
			http.NotFound(w, r)
			return
		}
		appID := parts[1]

		var app *domain.AppConfig
		for i := range cfg.Apps {
			if cfg.Apps[i].ID == appID {
				app = &cfg.Apps[i]
				break
			}
		}
		if app == nil {
			writeError(w, http.StatusNotFound, fmt.Sprintf("Unknown appId: %s", appID))
			return
		}

		windowHoursStr := r.URL.Query().Get("windowHours")
		if windowHoursStr == "" {
			windowHoursStr = "48"
		}
		windowHours, err := strconv.Atoi(windowHoursStr)
		if err != nil || windowHours <= 0 {
			writeError(w, http.StatusBadRequest, "windowHours must be a positive number")
			return
		}

		all, err := cfg.Store.Read(appID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		cutoff := time.Now().Add(-time.Duration(windowHours) * time.Hour)
		filtered := make([]domain.Review, 0)
		for _, r := range all {
			t, err := time.Parse(time.RFC3339, r.SubmittedAt)
			if err != nil {
				continue
			}
			if !t.Before(cutoff) {
				filtered = append(filtered, r)
			}
		}
		writeJSON(w, http.StatusOK, filtered)
	}
}
