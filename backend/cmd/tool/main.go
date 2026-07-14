package main

import (
	"context"
	"log"
	"os"

	"github.com/urfave/cli/v3"
)

// tool is the development CLI. Run it from ./backend:
//
//	go run ./cmd/tool migrate up --service user_service
func main() {
	cmd := &cli.Command{
		Name:  "tool",
		Usage: "development tool for warehouse_revamp",
		Commands: []*cli.Command{
			migrateCommand(),
			seedCommand(),
			dbCommand(),
		},
	}

	err := cmd.Run(context.Background(), os.Args)
	if err != nil {
		log.Fatal(err)
	}
}
