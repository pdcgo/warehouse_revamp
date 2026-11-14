package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"regexp"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/urfave/cli/v3"
)

// testDBName is the database every automated test runs against — a SEPARATE database from the
// development one ("postgres") that the owner reviews on, so tests never read or write review data.
// It lives on the same Postgres instance; only the database differs.
const testDBName = "warehouse_test"

// testDBNameRe is every name `san db` may create or drop: warehouse_test itself, a parallel e2e worker's own
// (warehouse_test_w1) and the template they are cloned from (warehouse_test_tpl) — `san test full --workers N`,
// backlog #51. Nothing else: the development database (postgres) can never be named here.
var testDBNameRe = regexp.MustCompile(`^warehouse_test(_[a-z0-9]+)*$`)

// testDBFlagName reads a database-name flag and refuses anything outside the test family.
func testDBFlagName(cmd *cli.Command, flag string) (string, error) {
	name := cmd.String(flag)
	if !testDBNameRe.MatchString(name) {
		return "", fmt.Errorf("--%s %q: san db only creates and drops test databases — warehouse_test, or "+
			"warehouse_test_<suffix> (a parallel e2e worker's, or the template)", flag, name)
	}

	return name, nil
}

func dbCommand() *cli.Command {
	// ⚠ NAMED --admin-dsn, not --dsn, and that is not cosmetic.
	//
	// These commands need a connection to a database OTHER than the one they are acting on: you
	// cannot drop the database you are connected to. Every other san command's --dsn is the
	// database being worked on, and the root flag also reads DATABASE_URL — which in a test run
	// points at warehouse_test, the exact database `reset-test` is about to drop.
	//
	// While these lived in their own binary the name could safely be --dsn, because there was no
	// root flag to inherit from. Folding the two CLIs into one removed that safety, so the flag is
	// renamed rather than left to collide silently.
	adminDSNFlag := &cli.StringFlag{
		Name:  "admin-dsn",
		Usage: "admin DSN on a database OTHER than the test one (e.g. dbname=postgres); defaults to the local Postgres",
	}

	// --name picks which test database — warehouse_test unless a parallel e2e worker names its own.
	nameFlag := &cli.StringFlag{
		Name:  "name",
		Value: testDBName,
		Usage: "the test database: " + testDBName + ", or warehouse_test_<suffix> (a parallel e2e worker's own)",
	}

	return &cli.Command{
		Name:  "db",
		Usage: "manage the test database (" + testDBName + ")",
		Commands: []*cli.Command{
			{
				Name:   "ensure-test",
				Usage:  "create " + testDBName + " (or --name) if it does not exist (no drop)",
				Flags:  []cli.Flag{adminDSNFlag, nameFlag},
				Action: runEnsureTest,
			},
			{
				Name:  "reset-test",
				Usage: "drop and recreate an empty " + testDBName + " (or --name); --template makes it a copy of another",
				Flags: []cli.Flag{adminDSNFlag, nameFlag, &cli.StringFlag{
					Name: "template",
					Usage: "create it as a COPY of this database (CREATE DATABASE … TEMPLATE …) — a parallel e2e worker " +
						"clones the template `san test full --workers N` migrated and seeded once",
				}},
				Action: runResetTest,
			},
			{
				Name:   "drop-test",
				Usage:  "drop " + testDBName + " (or --name) — cleanup after a run",
				Flags:  []cli.Flag{adminDSNFlag, nameFlag},
				Action: runDropTest,
			},
		},
	}
}

// runEnsureTest creates the test database only if it is absent — it never drops. The e2e backend
// runs this before it starts, so gorm.Open always finds the database no matter whether Playwright
// launches the web server before or after global-setup.
func runEnsureTest(ctx context.Context, cmd *cli.Command) error {
	name, err := testDBFlagName(cmd, "name")
	if err != nil {
		return err
	}

	db, err := adminConn(ctx, cmd.String("admin-dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `CREATE DATABASE "`+name+`"`)
	if err != nil {
		// Already there (possibly created by a concurrent process) is success, not an error.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P04" { // duplicate_database
			log.Printf("test database already present: %s", name)

			return nil
		}

		return err
	}

	log.Printf("test database created: %s", name)

	return nil
}

// adminConn connects to the MAINTENANCE database (never the test one), which is what lets it create
// or drop the test database. Defaults to the local Postgres; --admin-dsn overrides for CI.
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
	name, err := testDBFlagName(cmd, "name")
	if err != nil {
		return err
	}

	template := ""
	if cmd.String("template") != "" {
		template, err = testDBFlagName(cmd, "template")
		if err != nil {
			return err
		}

		if template == name {
			return fmt.Errorf("--template %q is the database being reset", template)
		}
	}

	db, err := adminConn(ctx, cmd.String("admin-dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	// WITH (FORCE) terminates any lingering connection so the drop can't be blocked (Postgres 13+).
	_, err = db.ExecContext(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	if err != nil {
		return err
	}

	if template == "" {
		_, err = db.ExecContext(ctx, `CREATE DATABASE "`+name+`"`)
		if err != nil {
			return err
		}

		log.Printf("test database reset: %s (empty)", name)

		return nil
	}

	// A copy of the template, file by file inside Postgres — about a second, against the minute of migrations it
	// stands for. Postgres refuses while anything is connected to the template; nothing should be.
	_, err = db.ExecContext(ctx, `CREATE DATABASE "`+name+`" TEMPLATE "`+template+`"`)
	if err != nil {
		return fmt.Errorf("cloning %s from the template %s: %w", name, template, err)
	}

	log.Printf("test database reset: %s (a copy of %s)", name, template)

	return nil
}

func runDropTest(ctx context.Context, cmd *cli.Command) error {
	name, err := testDBFlagName(cmd, "name")
	if err != nil {
		return err
	}

	db, err := adminConn(ctx, cmd.String("admin-dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	if err != nil {
		return err
	}

	log.Printf("test database dropped: %s", name)

	return nil
}
