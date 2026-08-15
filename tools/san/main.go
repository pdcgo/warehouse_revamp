// Command san is the OPERATIONS CLI — the tool an operator reaches for when something has to be
// done to real data by hand.
//
// It is not the migrator: cmd/tool owns the schema and the dev fixtures. san owns the actions a
// human performs against a running system, the first of them being "this person cannot log in,
// set their password".
//
// # It drives the SERVICES, never the tables
//
// Every command builds the real service through Wire and calls the real handler, so a reset done
// from here and a reset done from the admin UI are the same code. A hand-written UPDATE would be
// shorter and wrong: setting a password is not one statement — it also stamps last_password_reset
// (which kills tokens minted before it) and drops the user's cached roles. A second copy of that
// sequence is a copy that will fall behind the first.
//
// It is a TOP-LEVEL tool of the repository, not a backend one — run it from the repo root:
//
//	go run ./tools/san user reset-password --username ani
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
	// Cancel the root context on Ctrl-C / SIGTERM, so an interrupted command stops at the next
	// query instead of being killed mid-write.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cmd := &cli.Command{
		Name:  "san",
		Usage: "warehouse_revamp operations tool",
		Flags: []cli.Flag{
			// Persistent (urfave/cli v3's default for a root flag), so it reads the same either
			// side of the subcommand: `san --dsn=… user reset-password` or
			// `san user reset-password --dsn=…`.
			&cli.StringFlag{
				Name:    "dsn",
				Sources: cli.EnvVars("DATABASE_URL"),
				Usage:   "postgres DSN; skips the Local/Production prompt",
			},
		},
		Commands: []*cli.Command{
			userCommand(),
		},
	}

	err := cmd.Run(ctx, os.Args)
	if err != nil {
		log.Fatal(err)
	}
}
