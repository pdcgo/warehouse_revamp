// Package san_testdb gives handler tests a real Postgres with per-test isolation.
//
// Each test gets a *gorm.DB that is already inside a transaction; everything it writes is rolled
// back when the test ends. A handler's own `tx.Transaction(...)` becomes a SAVEPOINT under it, so
// real transactional behaviour is exercised without any test leaking rows into the next.
//
// If no test database is reachable, tests SKIP rather than fail — so `go test ./...` stays green
// on a machine with no Postgres, while CI and local-with-docker run the real thing.
package san_testdb

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Tests run against a SEPARATE database (`warehouse_test`), never the development database
// ("postgres") the owner reviews on — same Postgres instance, different database. It is created on
// demand (see ensureTestDatabase), and per-test transactions roll back, so it self-cleans.
const defaultDSN = "host=localhost port=5433 user=user password=password dbname=warehouse_test sslmode=disable"

// The advisory-lock key every test process takes before migrating (see connect). The value is
// arbitrary — its only job is to be the SAME in every process, so that they queue behind each other
// instead of all migrating at once.
const migrationLockKey = 8748301

// migrationServices is the apply ORDER — team_service seeds team 1 before user_service seeds the
// root user that references it. There is no cross-service FK to enforce it, so order matters here
// exactly as it does in production. Independent services (shipping_service) can go anywhere.
// region_service is migrated for its SCHEMA only — the 91.599-row seed is NOT loaded here. A test
// that needs regions inserts the handful it actually asserts on; making every test database pay for
// the whole country would be slow and would couple unit tests to upstream reference data.
var migrationServices = []string{"team_service", "user_service", "shipping_service", "product_service", "selling_service", "category_service", "document_service", "inventory_service", "region_service"}

var (
	once    sync.Once
	shared  *gorm.DB
	initErr error
)

func dsn() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}

	return defaultDSN
}

// repoRoot walks up from this source file to the directory holding go.mod, so migration paths
// resolve no matter which package's tests are running.
func repoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Dir(file)

	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return dir
		}

		dir = parent
	}
}

// ensureTestDatabase creates the target database if it does not exist, connecting to the
// maintenance database ("postgres") to do so. Postgres will not auto-create `warehouse_test`, so
// this is what makes a fresh checkout — and CI, where only "postgres" exists — work with no manual
// `createdb`.
func ensureTestDatabase(testDSN string) error {
	cfg, err := pgx.ParseConfig(testDSN)
	if err != nil {
		return err
	}

	// Nothing to create if the DSN already points at the maintenance database.
	if cfg.Database == "" || cfg.Database == "postgres" {
		return nil
	}

	adminCfg := cfg.Copy()
	adminCfg.Database = "postgres"

	admin, err := sql.Open("pgx", stdlib.RegisterConnConfig(adminCfg))
	if err != nil {
		return err
	}
	defer admin.Close()

	_, err = admin.Exec(`CREATE DATABASE "` + cfg.Database + `"`)
	if err != nil {
		// A parallel test package may have created it between our check and this CREATE — success.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P04" { // duplicate_database
			return nil
		}

		return err
	}

	return nil
}

// errMigration marks "the database is there, its migrations are broken" — as opposed to "there is no
// database", which is the only thing DB() is allowed to skip on.
type errMigration struct {
	svc string
	err error
}

func (e errMigration) Error() string {
	return "migrating " + e.svc + ": " + e.err.Error()
}

func (e errMigration) Unwrap() error {
	return e.err
}

func connect() (*gorm.DB, error) {
	err := ensureTestDatabase(dsn())
	if err != nil {
		return nil, err
	}

	raw, err := sql.Open("pgx", dsn())
	if err != nil {
		return nil, err
	}

	err = raw.Ping()
	if err != nil {
		return nil, err
	}

	// Serialise the migration across PROCESSES, not just goroutines.
	//
	// `once` guards one process; `go test ./...` runs one process PER PACKAGE, in parallel, all against
	// this same database. goose has no cross-process lock of its own, so without this every process
	// reads the version table, every one sees a new migration as unapplied, and every one runs it: the
	// winner records it and the losers die on whatever their own statement already created ("column
	// ... already exists").
	//
	// It only bites when a migration is NEW — against an up-to-date database goose.Up is a no-op and
	// the race has nothing to race over. That is exactly why it hid for so long locally, and exactly
	// why CI would meet it EVERY run: a fresh Postgres service container plus `go test ./...` means
	// every migration is new.
	//
	// The lock is taken on a PINNED connection, not on the pool: pg_advisory_lock is SESSION-scoped, so
	// a lock and an unlock issued through *sql.DB could land on two different connections — leaving the
	// lock held by an idle session forever and every later process waiting on it.
	lockConn, err := raw.Conn(context.Background())
	if err != nil {
		return nil, err
	}

	defer func() {
		_, _ = lockConn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, migrationLockKey)
		_ = lockConn.Close()
	}()

	_, err = lockConn.ExecContext(context.Background(), `SELECT pg_advisory_lock($1)`, migrationLockKey)
	if err != nil {
		return nil, err
	}

	// Apply every service's migrations (idempotent — a no-op once current). Each service tracks
	// its own <service>_version table, exactly like the real migrator.
	root := repoRoot()

	err = goose.SetDialect("postgres")
	if err != nil {
		return nil, err
	}

	for _, svc := range migrationServices {
		goose.SetTableName(svc + "_version")

		dir := filepath.Join(root, "services", svc, "db_migrations")

		err = goose.Up(raw, dir)
		if err != nil {
			// A BROKEN MIGRATION IS NOT A MISSING DATABASE. Both used to come back as one error, and
			// DB() skips on any error — so a migration with a syntax error skipped the whole suite
			// while `go test` printed "ok", under a message blaming an absent database. A green run
			// that ran nothing is worse than a red one.
			return nil, errMigration{svc: svc, err: err}
		}
	}

	return gorm.Open(postgres.New(postgres.Config{Conn: raw}), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Silent),
	})
}

// DB returns a transaction-scoped *gorm.DB for one test. Rolled back automatically at test end.
//
// The seeded root team (id 1) and root user (id 1) are present — they come from the migrations
// and survive the rollback, so every test starts from the same baseline the real system boots
// with.
func DB(t *testing.T) *gorm.DB {
	t.Helper()

	once.Do(func() {
		shared, initErr = connect()
	})

	if initErr != nil {
		// Skipping is for "there is no database here" — a developer without Postgres running, which is
		// not their test's fault. A BROKEN MIGRATION is this repo's fault and must be loud: skipping it
		// turns `go test` green while running nothing at all.
		var migErr errMigration
		if errors.As(initErr, &migErr) {
			t.Fatalf("san_testdb: %v", migErr)
		}

		t.Skipf("san_testdb: no test database (%v) — set TEST_DATABASE_URL or run docker compose up -d", initErr)
	}

	tx := shared.Begin()
	if tx.Error != nil {
		t.Fatalf("san_testdb: begin: %v", tx.Error)
	}

	t.Cleanup(func() {
		tx.Rollback()
	})

	return tx
}
