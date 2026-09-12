package san_event_test

import (
	"context"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// createDedupTable makes the minimal shape the default EventDedup expects. It is DDL inside the test's
// transaction, so it rolls back with everything else.
func createDedupTable(t *testing.T, db *gorm.DB, table string) {
	t.Helper()

	err := db.Exec(`CREATE TABLE ` + table + ` (
		event_id         text PRIMARY KEY,
		occurred_at_unix bigint NOT NULL,
		received_at      timestamptz NOT NULL DEFAULT now()
	)`).Error
	if err != nil {
		t.Fatalf("create %s: %v", table, err)
	}
}

func TestClaimIsNewOnceThenNeverAgain(t *testing.T) {
	db := san_testdb.DB(t)
	createDedupTable(t, db, "dedup_claim_test")

	dedup, err := san_event.NewDedup("dedup_claim_test")
	if err != nil {
		t.Fatalf("new dedup: %v", err)
	}

	ctx := context.Background()
	event := validEvent()

	isNew, err := dedup.Claim(ctx, db, event)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}

	if !isNew {
		t.Fatal("the first claim of an event must be new")
	}

	// A redelivery, a replay, and a republish all look like this.
	isNew, err = dedup.Claim(ctx, db, event)
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}

	if isNew {
		t.Fatal("a second claim of the same event_id must not be new — ON CONFLICT DO NOTHING did not suppress it")
	}
}

// The dedup key is the LOGICAL id. Two different facts are two claims even though everything else about
// them matches.
func TestClaimSeparatesDifferentEventIds(t *testing.T) {
	db := san_testdb.DB(t)
	createDedupTable(t, db, "dedup_distinct_test")

	dedup, err := san_event.NewDedup("dedup_distinct_test")
	if err != nil {
		t.Fatalf("new dedup: %v", err)
	}

	ctx := context.Background()

	first := validEvent()

	second := validEvent()
	second.EventId = "order-placed:8242"

	isNew, err := dedup.Claim(ctx, db, first)
	if err != nil || !isNew {
		t.Fatalf("first: isNew=%v err=%v", isNew, err)
	}

	isNew, err = dedup.Claim(ctx, db, second)
	if err != nil {
		t.Fatalf("second: %v", err)
	}

	if !isNew {
		t.Fatal("a different event_id must claim as new")
	}
}

func TestNewDedupRejectsATableNameItCannotSafelyInterpolate(t *testing.T) {
	for _, table := range []string{"", "events; DROP TABLE users", "Events", "public.events", "1events"} {
		_, err := san_event.NewDedup(table)
		if err == nil {
			t.Fatalf("%q must be refused — the name is interpolated into SQL", table)
		}
	}
}

func TestValidateSchemaAcceptsTheMinimalShape(t *testing.T) {
	db := san_testdb.DB(t)
	createDedupTable(t, db, "dedup_schema_ok_test")

	err := san_event.ValidateSchema(db, "dedup_schema_ok_test")
	if err != nil {
		t.Fatalf("the minimal shape must validate: %v", err)
	}
}

func TestValidateSchemaRefusesAMissingTable(t *testing.T) {
	db := san_testdb.DB(t)

	err := san_event.ValidateSchema(db, "dedup_absent_test")
	if err == nil {
		t.Fatal("a missing table must refuse the boot, not fail at the first insert of the night")
	}
}

func TestValidateSchemaRefusesAMissingColumn(t *testing.T) {
	db := san_testdb.DB(t)

	err := db.Exec(`CREATE TABLE dedup_thin_test (event_id text PRIMARY KEY)`).Error
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = san_event.ValidateSchema(db, "dedup_thin_test")
	if err == nil {
		t.Fatal("a missing occurred_at_unix must refuse the boot")
	}
}

// The sharpest one: WITHOUT a unique index there is no conflict target, so ON CONFLICT resolves against
// nothing and every event inserts as new. Dedup silently stops deduping.
func TestValidateSchemaRefusesATableWithNoUniqueIndex(t *testing.T) {
	db := san_testdb.DB(t)

	err := db.Exec(`CREATE TABLE dedup_unindexed_test (
		event_id         text NOT NULL,
		occurred_at_unix bigint NOT NULL
	)`).Error
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = san_event.ValidateSchema(db, "dedup_unindexed_test")
	if err == nil {
		t.Fatal("no unique index on event_id must refuse the boot — dedup would silently never dedup")
	}
}

// A unique index on (event_id, something_else) is NOT a conflict target for ON CONFLICT (event_id), so
// it must not be mistaken for one.
func TestValidateSchemaRefusesACompositeUniqueIndex(t *testing.T) {
	db := san_testdb.DB(t)

	err := db.Exec(`CREATE TABLE dedup_composite_test (
		event_id         text NOT NULL,
		occurred_at_unix bigint NOT NULL,
		UNIQUE (event_id, occurred_at_unix)
	)`).Error
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = san_event.ValidateSchema(db, "dedup_composite_test")
	if err == nil {
		t.Fatal("a composite unique index is not a conflict target for ON CONFLICT (event_id)")
	}
}

func TestRequireColumnsNamesEveryMissingColumnAtOnce(t *testing.T) {
	db := san_testdb.DB(t)

	err := db.Exec(`CREATE TABLE dedup_custom_test (event_id text PRIMARY KEY)`).Error
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = san_event.RequireColumns(db, "dedup_custom_test", "event_id", "warehouse_id", "occurred_on")
	if err == nil {
		t.Fatal("want an error naming the missing columns")
	}

	message := err.Error()
	for _, want := range []string{"warehouse_id", "occurred_on"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error must name %q so one run fixes them all, got: %s", want, message)
		}
	}
}
