package main

import (
	"context"
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib" // postgres driver

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_dbtarget"
)

// Which database to act on — and the production confirmation in front of it — lives in
// san_dbtarget, because tools/san needs exactly the same choice and the same guard. This file is
// only what is specific to this CLI: opening a database/sql handle on the chosen DSN.
const (
	targetLocal      = san_dbtarget.Local
	targetProduction = san_dbtarget.Production
)

// localDSN is the docker-compose database, assembled from env with dev defaults.
func localDSN() string {
	return san_dbtarget.LocalDSN()
}

// resolveDatabase asks which database to act on (Local / Production), then connects.
// An explicit --dsn (or DATABASE_URL) bypasses the prompt entirely — that is the
// non-interactive path for CI and scripts.
func resolveDatabase(ctx context.Context, dsnFlag string) (*sql.DB, string, error) {
	dsn, label, err := san_dbtarget.Resolve(dsnFlag)
	if err != nil {
		return nil, "", err
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
