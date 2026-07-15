package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"slices"

	"github.com/pressly/goose/v3"
	"github.com/urfave/cli/v3"
)

func migrateCommand() *cli.Command {
	return &cli.Command{
		Name:      "migrate",
		Usage:     "run goose migrations for ONE service (or `up-all` for every service)",
		ArgsUsage: "<up|down|status|create|redo|reset|version|up-to|down-to|up-all> [args...]",
		Description: "Migrations are per-service (HARD RULE 3). Files live in\n" +
			"services/<service>/db_migrations, and applied state is tracked in its own\n" +
			"<service>_version table — so services stay independent.\n\n" +
			"Run interactively and you are asked TWO things: which database\n" +
			"(Local / Production), then which service. Pass --dsn and --service to skip\n" +
			"both prompts (CI / scripts).\n\n" +
			"`up-all` is the shortcut: it migrates EVERY service up, in dependency order\n" +
			"(team_service and user_service first — team 1 must exist before the root role\n" +
			"references it), so a fresh database is fully migrated in one command. It asks\n" +
			"only for the database, not a service.\n\n" +
			"Examples:\n" +
			"  go run ./cmd/tool migrate create add_users --service user_service\n" +
			"  go run ./cmd/tool migrate up\n" +
			"  go run ./cmd/tool migrate up-all\n" +
			"  go run ./cmd/tool migrate status --service user_service",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:    "service",
				Aliases: []string{"s"},
				Usage:   "which service to migrate; prompts when omitted",
			},
			&cli.StringFlag{
				Name:    "dsn",
				Sources: cli.EnvVars("DATABASE_URL"),
				Usage:   "postgres DSN; skips the Local/Production prompt. Not needed for `create`",
			},
		},
		Action: runMigrate,
	}
}

func runMigrate(ctx context.Context, cmd *cli.Command) error {
	args := cmd.Args().Slice()
	if len(args) == 0 {
		return errors.New("a goose command is required (up, down, status, create, ...)")
	}

	gooseCmd, gooseArgs := args[0], args[1:]

	// `create` only writes a file, so it never touches a database — a migration can be
	// authored with no Postgres running. Ask for the service only.
	if gooseCmd == "create" {
		return runCreate(ctx, cmd, gooseArgs)
	}

	// `up-all` is the shortcut: migrate EVERY service up, in dependency order. Asks only for the
	// database (there is no single service to pick).
	if gooseCmd == "up-all" {
		return runMigrateUpAll(ctx, cmd)
	}

	// Prompt order mirrors the operator's mental model: WHICH DATABASE first (the
	// dangerous choice), then which service.
	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	service, err := resolveService(cmd.String("service"))
	if err != nil {
		return err
	}

	dir, err := prepareMigrations(service)
	if err != nil {
		return err
	}

	log.Printf("migrate %s — service=%s target=%s", gooseCmd, service, target)

	return goose.RunContext(ctx, gooseCmd, db, dir, gooseArgs...)
}

func runCreate(ctx context.Context, cmd *cli.Command, gooseArgs []string) error {
	if len(gooseArgs) == 0 {
		return errors.New("create needs a name: migrate create <name> --service <svc>")
	}

	service, err := resolveService(cmd.String("service"))
	if err != nil {
		return err
	}

	dir, err := prepareMigrations(service)
	if err != nil {
		return err
	}

	// Default to SQL migrations; goose would otherwise emit a .go migration.
	if len(gooseArgs) == 1 {
		gooseArgs = append(gooseArgs, "sql")
	}

	return goose.RunContext(ctx, "create", nil, dir, gooseArgs...)
}

// runMigrateUpAll migrates every service up, in dependency order, against one database.
func runMigrateUpAll(ctx context.Context, cmd *cli.Command) error {
	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	services, err := orderedServicesWithMigrations()
	if err != nil {
		return err
	}

	for _, service := range services {
		dir, err := prepareMigrations(service)
		if err != nil {
			return err
		}

		log.Printf("migrate up — service=%s target=%s", service, target)

		err = goose.RunContext(ctx, "up", db, dir)
		if err != nil {
			return fmt.Errorf("migrating %s: %w", service, err)
		}
	}

	log.Printf("all services migrated up (%d services, target=%s)", len(services), target)

	return nil
}

// orderedServicesWithMigrations returns the services that have a db_migrations dir, in the order
// they must be applied: team_service then user_service first (team 1 must exist before user_service
// seeds the root role that references it — there is no cross-service FK to enforce it), then the
// rest (independent) in discovered order.
func orderedServicesWithMigrations() ([]string, error) {
	all, err := discoverServices()
	if err != nil {
		return nil, err
	}

	withMigrations := make([]string, 0, len(all))
	for _, service := range all {
		_, statErr := os.Stat(migrationsDir(service))
		if statErr == nil {
			withMigrations = append(withMigrations, service)
		}
	}

	ordered := make([]string, 0, len(withMigrations))
	seen := map[string]bool{}

	for _, service := range []string{"team_service", "user_service"} {
		if slices.Contains(withMigrations, service) {
			ordered = append(ordered, service)
			seen[service] = true
		}
	}

	for _, service := range withMigrations {
		if !seen[service] {
			ordered = append(ordered, service)
		}
	}

	return ordered, nil
}

// prepareMigrations points goose at THIS service's migration folder and version table.
// Each service tracks its applied migrations in its own <service>_version table — without
// that, services would share one goose history and stop being independently migratable.
func prepareMigrations(service string) (string, error) {
	dir := migrationsDir(service)

	err := os.MkdirAll(dir, 0o755)
	if err != nil {
		return "", err
	}

	goose.SetTableName(fmt.Sprintf("%s_version", service))
	goose.SetSequential(true)

	err = goose.SetDialect("postgres")
	if err != nil {
		return "", err
	}

	return dir, nil
}
