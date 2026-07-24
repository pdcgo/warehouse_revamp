package main

import (
	"context"
	"database/sql"
	"errors"
	"log"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/urfave/cli/v3"
)

// testDBName is the database every automated test runs against — a SEPARATE database from the
// development one ("postgres") that the owner reviews on, so tests never read or write review data.
// It lives on the same Postgres instance; only the database differs.
const testDBName = "warehouse_test"

func dbCommand() *cli.Command {
	// NOTE: this flag deliberately does NOT read DATABASE_URL — that env is the TEST database
	// (warehouse_test), but these commands need a connection to a DIFFERENT (maintenance) database
	// to drop/create the test one. Default to the local Postgres (dbname=postgres); --dsn overrides.
	dsnFlag := &cli.StringFlag{
		Name:  "dsn",
		Usage: "admin DSN on a database OTHER than the test one (e.g. dbname=postgres); defaults to the local Postgres",
	}

	return &cli.Command{
		Name:  "db",
		Usage: "manage the test database (" + testDBName + ")",
		Commands: []*cli.Command{
			{
				Name:   "ensure-test",
				Usage:  "create " + testDBName + " if it does not exist (no drop)",
				Flags:  []cli.Flag{dsnFlag},
				Action: runEnsureTest,
			},
			{
				Name:   "reset-test",
				Usage:  "drop and recreate an empty " + testDBName,
				Flags:  []cli.Flag{dsnFlag},
				Action: runResetTest,
			},
			{
				Name:   "drop-test",
				Usage:  "drop " + testDBName + " (cleanup after a run)",
				Flags:  []cli.Flag{dsnFlag},
				Action: runDropTest,
			},
		},
	}
}

// runEnsureTest creates the test database only if it is absent — it never drops. The e2e backend
// runs this before it starts, so gorm.Open always finds the database no matter whether Playwright
// launches the web server before or after global-setup.
func runEnsureTest(ctx context.Context, cmd *cli.Command) error {
	db, err := adminConn(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `CREATE DATABASE "`+testDBName+`"`)
	if err != nil {
		// Already there (possibly created by a concurrent process) is success, not an error.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P04" { // duplicate_database
			log.Printf("test database already present: %s", testDBName)

			return nil
		}

		return err
	}

	log.Printf("test database created: %s", testDBName)

	return nil
}

// adminConn connects to the MAINTENANCE database (never the test one), which is what lets it create
// or drop the test database. Defaults to the local Postgres; --dsn overrides for CI.
func adminConn(ctx context.Context, dsnFlag string) (*sql.DB, error) {
	dsn := dsnFlag
	if dsn == "" {
		dsn = localDSN()
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}

	err = db.PingContext(ctx)
	if err != nil {
		db.Close()

		return nil, err
	}

	return db, nil
}

func runResetTest(ctx context.Context, cmd *cli.Command) error {
	db, err := adminConn(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	// WITH (FORCE) terminates any lingering connection so the drop can't be blocked (Postgres 13+).
	_, err = db.ExecContext(ctx, `DROP DATABASE IF EXISTS "`+testDBName+`" WITH (FORCE)`)
	if err != nil {
		return err
	}

	_, err = db.ExecContext(ctx, `CREATE DATABASE "`+testDBName+`"`)
	if err != nil {
		return err
	}

	log.Printf("test database reset: %s (empty)", testDBName)

	return nil
}

func runDropTest(ctx context.Context, cmd *cli.Command) error {
	db, err := adminConn(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `DROP DATABASE IF EXISTS "`+testDBName+`" WITH (FORCE)`)
	if err != nil {
		return err
	}

	log.Printf("test database dropped: %s", testDBName)

	return nil
}
