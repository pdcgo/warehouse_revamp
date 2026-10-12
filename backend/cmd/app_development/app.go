package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

const shutdownGrace = 10 * time.Second

type App struct {
	server *http.Server

	// A settlement import runs detached from its request (an-import-finishes-whether-anyone-watches), so
	// the server's own drain cannot see it.
	importer *settlement_importer_v1.Service
}

func NewApp(server *http.Server, importer *settlement_importer_v1.Service) *App {
	return &App{server: server, importer: importer}
}

// Run serves until ctx is cancelled, then drains in-flight requests before returning.
func (a *App) Run(ctx context.Context) error {
	serveErr := make(chan error, 1)

	go func() {
		log.Printf("listening on %s", a.server.Addr)

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

		// IMPORTS FIRST, while the server still serves: an import calls the shop, orders, documents and
		// settlement through this same server, so waiting after Shutdown would only fail its every line.
		// One that outlasts the grace is left running and reads interrupted — the same file again
		// finishes it.
		a.waitForImports(shutdownGrace)

		// A fresh context: the one we were handed is already cancelled, and Shutdown needs
		// a live deadline to drain against.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()

		return a.server.Shutdown(shutdownCtx)
	}
}

func (a *App) waitForImports(grace time.Duration) {
	finished := make(chan struct{})

	go func() {
		a.importer.Wait()
		close(finished)
	}()

	select {
	case <-finished:
	case <-time.After(grace):
		log.Println("settlement imports still running at shutdown — they will read interrupted")
	}
}
