// Command san is the UNIFIED DEVELOPMENT AND OPERATIONS CLI for this repository.
//
// One binary covers the whole life of the project's data and the environment around it:
//
//	san migrate    the schema      — goose, per service (HARD RULE 3)
//	san seed       the fixtures    — root, dev, categories
//	san db         the test database
//	san region     reference data
//	san user       operations on real data, through the real services
//	san remote     serve this checkout to a coding agent (Connect RPC + MCP)
//
// # Why one binary and not two
//
// migrate/seed/db/region lived in backend/cmd/tool, split from san on the argument that a
// developer's tool and an operator's tool are used at different moments by different people. That
// is true of the COMMANDS and was never true of the BINARY: the moment matters to whoever is
// typing, and a `--help` line carries it, whereas "which of our two programs owns migrate" is a
// fact every new person has to be told and nothing in the tree reveals. The split also had no seat
// for `deploy`, which belongs to neither half.
//
// What the merge does NOT collapse is the guard rails. Which database a command acts on still goes
// through san_dbtarget, so the "type production to continue" prompt protects every command that
// touches a database rather than one binary's worth of them.
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
			// The schema and the fixtures. These were `backend/cmd/tool` until the unified-tools
			// requirement folded them in — one binary a developer learns once, rather than two
			// whose only difference was which of them happened to own `migrate`.
			migrateCommand(),
			seedCommand(),
			dbCommand(),
			regionCommand(),

			// Operations on real data, and the workspace server.
			userCommand(),
			pubsubCommand(),
			remoteCommand(),
		},
	}

	err := cmd.Run(ctx, os.Args)
	if err != nil {
		log.Fatal(err)
	}
}
