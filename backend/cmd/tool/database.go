package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib" // postgres driver
	"github.com/manifoldco/promptui"
)

const (
	targetLocal      = "Database Local"
	targetProduction = "Database Production"
)

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

// localDSN is assembled from env with dev-friendly defaults, so a fresh checkout can
// migrate a local Postgres without configuring anything.
func localDSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getEnv("POSTGRES_HOST", "localhost"),
		getEnv("POSTGRES_PORT", "5433"), // docker-compose maps us to 5433 — 5432 is taken

		getEnv("POSTGRES_USER", "user"),
		getEnv("POSTGRES_PASSWORD", "password"),
		getEnv("POSTGRES_DB", "postgres"),
	)
}

// productionDSN has NO default on purpose — production must be configured explicitly.
func productionDSN() (string, error) {
	dsn := os.Getenv("PRODUCTION_DATABASE_URL")
	if dsn == "" {
		return "", errors.New("PRODUCTION_DATABASE_URL is not set")
	}

	return dsn, nil
}

// confirmProduction makes the operator type the word. A destructive migration (down, reset)
// against production must not be one arrow-key away from a local one.
func confirmProduction() error {
	prompt := promptui.Prompt{
		Label: `You are about to migrate PRODUCTION. Type "production" to continue`,
	}

	answer, err := prompt.Run()
	if err != nil {
		return errors.New("aborted")
	}

	if strings.TrimSpace(answer) != "production" {
		return errors.New("aborted — confirmation did not match")
	}

	return nil
}

// resolveDatabase asks which database to act on (Local / Production), then connects.
// An explicit --dsn (or DATABASE_URL) bypasses the prompt entirely — that is the
// non-interactive path for CI and scripts.
func resolveDatabase(ctx context.Context, dsnFlag string) (*sql.DB, string, error) {
	dsn := dsnFlag
	label := "explicit --dsn"

	if dsn == "" {
		targets := []string{targetLocal, targetProduction}

		prompt := promptui.Select{
			Label: "Database",
			Items: targets,
		}

		index, _, err := prompt.Run()
		if err != nil {
			return nil, "", errors.New("no database selected (use --dsn to run non-interactively)")
		}

		label = targets[index]

		switch label {
		case targetLocal:
			dsn = localDSN()

		case targetProduction:
			err = confirmProduction()
			if err != nil {
				return nil, "", err
			}

			dsn, err = productionDSN()
			if err != nil {
				return nil, "", err
			}
		}
	}

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, "", err
	}

	err = db.PingContext(ctx)
	if err != nil {
		db.Close()

		return nil, "", fmt.Errorf("connecting to %s: %w", label, err)
	}

	return db, label, nil
}
