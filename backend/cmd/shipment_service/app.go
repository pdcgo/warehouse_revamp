package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"
)

// shutdownGrace is how long in-flight requests get after SIGTERM. Cloud Run allows 10 s before it kills the
// container, and a label check — the slowest call here — is milliseconds on a real label.
const shutdownGrace = 10 * time.Second

type App struct {
	server *http.Server
	cfg    *Config
}

func NewApp(server *http.Server, cfg *Config) *App {
	return &App{server: server, cfg: cfg}
}

// Run serves until ctx is cancelled, then drains in-flight requests before returning.
func (a *App) Run(ctx context.Context) error {
	serveErr := make(chan error, 1)

	go func() {
		if a.cfg.CloudRunService != "" {
			log.Printf("shipment_service listening on %s (Cloud Run service %s)", a.server.Addr, a.cfg.CloudRunService)
		} else {
			log.Printf("shipment_service listening on %s", a.server.Addr)
		}

		err := a.server.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			serveErr <- nil

			return
		}

		serveErr <- err
	}()

	select {
	case err := <-serveErr:
		return err

	case <-ctx.Done():
		log.Println("shutting down")

		// A fresh context: the one we were handed is already cancelled, and Shutdown needs a live deadline.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()

		return a.server.Shutdown(shutdownCtx)
	}
}
