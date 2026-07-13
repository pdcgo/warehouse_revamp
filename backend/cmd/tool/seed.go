package main

import (
	"context"
	"errors"
	"fmt"
	"log"

	"golang.org/x/crypto/bcrypt"
	"github.com/urfave/cli/v3"
)

func seedCommand() *cli.Command {
	return &cli.Command{
		Name:  "seed",
		Usage: "seed data (development)",
		Commands: []*cli.Command{
			{
				Name:      "root",
				Usage:     "set the root account's password",
				ArgsUsage: " ",
				Description: "The root account (user 1, ROLE_ROOT in team 1) is created by a migration with\n" +
					"an EMPTY password, which bcrypt can never match — so a freshly migrated system\n" +
					"has a root user that cannot log in. This sets its password.\n\n" +
					"A default password in the migration would ship to production. This cannot.",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:     "password",
						Usage:    "the root password to set",
						Sources:  cli.EnvVars("ROOT_PASSWORD"),
						Required: true,
					},
					&cli.StringFlag{
						Name:    "dsn",
						Sources: cli.EnvVars("DATABASE_URL"),
						Usage:   "postgres DSN; skips the Local/Production prompt",
					},
				},
				Action: runSeedRoot,
			},
		},
	}
}

func runSeedRoot(ctx context.Context, cmd *cli.Command) error {
	password := cmd.String("password")
	if len(password) < 8 {
		return errors.New("the root password must be at least 8 characters")
	}

	db, target, err := resolveDatabase(ctx, cmd.String("dsn"))
	if err != nil {
		return err
	}
	defer db.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	result, err := db.ExecContext(ctx,
		`UPDATE users SET password = $1, updated_at = NOW() WHERE id = 1`,
		string(hash),
	)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}

	if rows == 0 {
		return fmt.Errorf("no root user — run `migrate up --service user_service` first")
	}

	log.Printf("root password set (target=%s)", target)

	return nil
}
