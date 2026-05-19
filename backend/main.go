package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"runway/backend/internal/config"
	"runway/backend/internal/poller"
	"runway/backend/internal/server"
	"runway/backend/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	st, err := store.New(cfg.DataDir)
	if err != nil {
		log.Fatalf("store: %v", err)
	}

	p := poller.New(cfg.Apps, st, time.Duration(cfg.PollIntervalMs)*time.Millisecond)
	p.Start()

	srv := server.New(server.Config{
		Port:  cfg.Port,
		Store: st,
		Apps:  cfg.Apps,
	})

	go func() {
		log.Printf("Listening on http://localhost:%d", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	// Graceful shutdown: stop the poller first (so it doesn't write during
	// shutdown), then close the HTTP server with a 5s timeout.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	p.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}
