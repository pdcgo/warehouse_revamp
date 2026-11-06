// Package san_dbsession opens every Postgres handle the system uses — the server's, `san`'s and the tests' — with the
// session settings the system's decisions fix. Today that is one: the calendar.
//
// THE SYSTEM RUNS ON JAKARTA TIME (docs/technical/architecture/context_decision.md#the-system-runs-on-jakarta-time):
// the conversion from an instant to a day happens ONCE, at the database session. With `TimeZone=Asia/Jakarta` on the
// session, `CURRENT_DATE`, `now()::date` and every `timestamptz → date` cast are already the Jakarta day, so no
// handler converts anything — settlement's `posted_on DEFAULT CURRENT_DATE` included.
//
// It is set on the parsed connection config rather than spliced into the DSN text, so it holds for every form a DSN
// arrives in (key=value, a postgres:// URL, a secret read from the environment) and overrides a zone the DSN names: a
// second calendar is never one environment variable away.
package san_dbsession

import (
	"database/sql"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// TimeZone is the system's calendar. WIB has no daylight saving, so a Jakarta day is always 24 hours.
const TimeZone = "Asia/Jakarta"

// Config parses a DSN and pins the session's TimeZone to Jakarta, replacing any zone the DSN set.
func Config(dsn string) (*pgx.ConnConfig, error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}

	// A GUC name is case-insensitive, so a `TimeZone=UTC` and a `timezone=…` would both reach the server.
	for key := range cfg.RuntimeParams {
		if strings.EqualFold(key, "timezone") {
			delete(cfg.RuntimeParams, key)
		}
	}

	cfg.RuntimeParams["timezone"] = TimeZone

	return cfg, nil
}

// OpenSQL is a database/sql handle on the DSN, every connection of it on the Jakarta calendar. Like sql.Open it does
// not connect; the caller pings.
func OpenSQL(dsn string) (*sql.DB, error) {
	cfg, err := Config(dsn)
	if err != nil {
		return nil, err
	}

	return stdlib.OpenDB(*cfg), nil
}

// OpenGORM is a GORM handle on the DSN, through OpenSQL.
func OpenGORM(dsn string, config *gorm.Config) (*gorm.DB, error) {
	db, err := OpenSQL(dsn)
	if err != nil {
		return nil, err
	}

	return gorm.Open(postgres.New(postgres.Config{Conn: db}), config)
}
