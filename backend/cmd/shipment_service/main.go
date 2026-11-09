// Command shipment_service serves shipment_service ALONE — the courier catalogue (ShipmentChannelService) and
// the label check (ReceiptService) — as the first service `san deploy` ships to Cloud Run.
//
// The dev server (backend/cmd/app_development) still mounts every service, shipment included; this binary is the
// same register.go behind the same interceptor chain, with only the dependencies shipment needs.
//
//	go run ./backend/cmd/shipment_service            # locally, on :8090, against the docker-compose database
//	go run ./tools/san deploy --service shipment_service
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
	// Cloud Run sends SIGTERM before it stops an instance; cancelling here lets the server drain.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := &cli.Command{
		Name:           "shipment_service",
		Usage:          "warehouse_revamp shipment_service — the courier catalogue and the label check",
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
