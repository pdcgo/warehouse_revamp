package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/urfave/cli/v3"
)

func main() {
	// Cancel the root context on Ctrl-C / SIGTERM so the server drains instead of dying
	// mid-request.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := &cli.Command{
		Name:           "app_development",
		Usage:          "warehouse_revamp development server",
		DefaultCommand: "serve",
		Commands: []*cli.Command{
			{
				Name:   "serve",
				Usage:  "run the API server",
				Action: runServe,
			},
		},
	}

	err := cmd.Run(ctx, os.Args)
	if err != nil {
		log.Fatal(err)
	}
}

func runServe(ctx context.Context, _ *cli.Command) error {
	app, err := InitializeApp()
	if err != nil {
		return err
	}

	return app.Run(ctx)
}
