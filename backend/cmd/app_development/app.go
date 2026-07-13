package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"
)

const shutdownGrace = 10 * time.Second

type App struct {
	server *http.Server
}

func NewApp(server *http.Server) *App {
	return &App{server: server}
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

		// A fresh context: the one we were handed is already cancelled, and Shutdown needs
		// a live deadline to drain against.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()

		return a.server.Shutdown(shutdownCtx)
	}
}
