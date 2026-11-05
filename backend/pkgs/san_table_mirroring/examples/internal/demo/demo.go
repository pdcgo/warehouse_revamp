// Package demo is the shared setup of the san_table_mirroring examples: a LOCAL Postgres, an "old"
// schema holding the tables to mirror, and a "new" schema to mirror them into. In a real migration
// those are two databases (the old system's and revamp's); here they are two schemas of one, so the
// examples run on the docker Postgres with nothing else to set up.
//
// It is for the examples only.
package demo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_table_mirroring"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// defaultDSN is the docker Postgres of `go run ./tools/san dev setup` — the same one the dev server uses.
const defaultDSN = "host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable"

const (
	// OldSchema plays the old system's database: the tables being mirrored.
	OldSchema = "stm_example_old"
	// NewSchema plays revamp's database: where the mirror is written.
	NewSchema = "stm_example_new"
)

// User is the row type of <OldSchema>.users and <NewSchema>.users.
type User struct {
	ID        uint64
	Name      string
	Username  string
	DeletedAt *time.Time
}

// Open connects to the local Postgres: EXAMPLE_DATABASE_URL, else the docker default. It REFUSES any
// host but this machine, because the examples create and drop schemas.
func Open() (*gorm.DB, error) {
	dsn := os.Getenv("EXAMPLE_DATABASE_URL")
	if dsn == "" {
		dsn = defaultDSN
	}

	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("EXAMPLE_DATABASE_URL: %w", err)
	}

	switch cfg.Host {
	case "localhost", "127.0.0.1", "::1":
	default:
		return nil, fmt.Errorf("the examples create and drop schemas, so they only run against this machine, not %q", cfg.Host)
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, err
	}

	err = db.Exec(`SELECT 1`).Error
	if err != nil {
		return nil, fmt.Errorf("no local Postgres (run: docker compose up -d): %w", err)
	}

	return db, nil
}

// Start opens the database and builds a clean <OldSchema>.users with n users and an empty
// <NewSchema>.users. The returned cleanup drops both schemas and the track schema the package
// created — unless keep is set, to look at them afterwards.
func Start(n int, keep bool) (*gorm.DB, func() error, error) {
	db, err := Open()
	if err != nil {
		return nil, nil, err
	}

	err = drop(db)
	if err != nil {
		return nil, nil, err
	}

	err = Exec(db,
		`CREATE SCHEMA `+OldSchema,
		`CREATE SCHEMA `+NewSchema,
		`CREATE TABLE `+OldSchema+`.users (id bigint PRIMARY KEY, name text NOT NULL, username text NOT NULL, deleted_at timestamptz)`,
		`CREATE TABLE `+NewSchema+`.users (id bigint PRIMARY KEY, name text NOT NULL, username text NOT NULL, deleted_at timestamptz)`,
	)
	if err != nil {
		return nil, nil, err
	}

	err = AddUsers(db, 1, n)
	if err != nil {
		return nil, nil, err
	}

	cleanup := func() error {
		if keep {
			fmt.Printf("\nkept: schemas %s, %s_track and %s\n", OldSchema, OldSchema, NewSchema)

			return nil
		}

		return drop(db)
	}

	return db, cleanup, nil
}

func drop(db *gorm.DB) error {
	return Exec(db,
		`DROP SCHEMA IF EXISTS `+OldSchema+` CASCADE`,
		`DROP SCHEMA IF EXISTS `+OldSchema+`_track CASCADE`,
		`DROP SCHEMA IF EXISTS `+NewSchema+` CASCADE`,
	)
}

// AddUsers inserts users from..to into the OLD schema.
func AddUsers(db *gorm.DB, from, to int) error {
	if to < from {
		return nil
	}

	return db.
		Exec(`INSERT INTO `+OldSchema+`.users (id, name, username) SELECT g, 'User '||g, 'user'||g FROM generate_series(?::bigint, ?::bigint) AS g`, from, to).
		Error
}

// Exec runs each statement in turn and stops at the first error.
func Exec(db *gorm.DB, statements ...string) error {
	for _, s := range statements {
		err := db.
			Exec(s).
			Error
		if err != nil {
			return fmt.Errorf("%s: %w", s, err)
		}
	}

	return nil
}

// Count returns the number of rows of a table.
func Count(db *gorm.DB, table string) (int64, error) {
	var n int64

	err := db.
		Raw(`SELECT count(*) FROM ` + table).
		Scan(&n).
		Error

	return n, err
}

// ApplyUser writes one change of <OldSchema>.users into <NewSchema>.users. Both writes are safe to
// repeat — an upsert by ID, a delete by ID — because delivery is at least once: a change whose Ack
// never landed comes again on the next run.
func ApplyUser(ctx context.Context, newDB *gorm.DB, change san_table_mirroring.Change[*User]) error {
	switch change.Change {
	case san_table_mirroring.ChangeTypeNew, san_table_mirroring.ChangeTypeModified:
		u := change.Data

		return newDB.
			WithContext(ctx).
			Exec(
				`INSERT INTO `+NewSchema+`.users (id, name, username, deleted_at) VALUES (?, ?, ?, ?)
				ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, deleted_at = EXCLUDED.deleted_at`,
				u.ID,
				u.Name,
				u.Username,
				u.DeletedAt,
			).
			Error
	case san_table_mirroring.ChangeTypeDeleted:
		// Data is empty for a deleted row — the row is gone from the old database. The ID is all there is.
		return newDB.
			WithContext(ctx).
			Exec(`DELETE FROM `+NewSchema+`.users WHERE id = ?`, change.ID).
			Error
	default:
		return errors.New("unknown change type " + string(change.Change))
	}
}
