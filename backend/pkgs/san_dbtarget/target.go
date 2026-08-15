// Package san_dbtarget picks WHICH database a command-line tool acts on.
//
// It exists because more than one CLI needs that choice — the migrator (cmd/tool) and the
// operations tool (tools/san) — and because the guard in front of Production must not exist in
// two copies. A confirmation prompt that is duplicated is one careless edit away from protecting
// only one of the tools that needs it.
//
// The contract is deliberately narrow: it resolves a DSN and a human label, and it never opens a
// connection. Each tool opens its own handle (database/sql for the migrator, GORM for san), so
// this package has no opinion about the driver.
package san_dbtarget

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/manifoldco/promptui"
)

// The human labels for the two targets. They are the prompt's items and the string a tool prints
// in its log line, so a command's output always says which database it touched.
const (
	Local      = "Database Local"
	Production = "Database Production"
)

// LabelExplicit is the label used when the operator supplied a DSN, so the log line never claims
// a target that was not chosen from the prompt.
const LabelExplicit = "explicit --dsn"

func getEnv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

// LocalDSN is assembled from env with dev-friendly defaults, so a fresh checkout works with no
// configuration.
func LocalDSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		getEnv("POSTGRES_HOST", "localhost"),
		getEnv("POSTGRES_PORT", "5433"), // docker-compose maps us to 5433 — 5432 is taken

		getEnv("POSTGRES_USER", "user"),
		getEnv("POSTGRES_PASSWORD", "password"),
		getEnv("POSTGRES_DB", "postgres"),
	)
}

// ProductionDSN has NO default on purpose — production must be configured explicitly.
func ProductionDSN() (string, error) {
	dsn := os.Getenv("PRODUCTION_DATABASE_URL")
	if dsn == "" {
		return "", errors.New("PRODUCTION_DATABASE_URL is not set")
	}

	return dsn, nil
}

// ConfirmProduction makes the operator type the word. Anything that reaches production — a
// `migrate down`, a password reset on a live account — must not be one arrow-key away from the
// local equivalent.
func ConfirmProduction() error {
	prompt := promptui.Prompt{
		Label: `You are about to act on PRODUCTION. Type "production" to continue`,
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

// Resolve asks which database to act on (Local / Production) and returns its DSN plus a human
// label.
//
// An explicit dsnFlag (or DATABASE_URL, which the tools read into it) bypasses the prompt
// entirely — that is the non-interactive path for CI and scripts.
func Resolve(dsnFlag string) (string, string, error) {
	if dsnFlag != "" {
		return dsnFlag, LabelExplicit, nil
	}

	targets := []string{Local, Production}

	prompt := promptui.Select{
		Label: "Database",
		Items: targets,
	}

	index, _, err := prompt.Run()
	if err != nil {
		return "", "", errors.New("no database selected (use --dsn to run non-interactively)")
	}

	label := targets[index]

	if label == Production {
		err = ConfirmProduction()
		if err != nil {
			return "", "", err
		}

		dsn, perr := ProductionDSN()
		if perr != nil {
			return "", "", perr
		}

		return dsn, label, nil
	}

	return LocalDSN(), label, nil
}
