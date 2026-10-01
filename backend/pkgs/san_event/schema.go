package san_event

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// ValidateSchema refuses to boot on a dedup table the default EventDedup cannot use.
//
// Same pattern as user_service's ValidateDescriptors(): failing on deploy beats failing on the first
// insert of the night. Because the service writes the migration by hand, this is the only thing standing
// between a typo and a silent runtime failure.
//
// What it requires: event_id, occurred_at_unix, and a UNIQUE index on event_id alone — the conflict
// target Claim names. What it does not touch: every other column. Retention, partitioning, typed
// payloads are the service's.
//
// ⚠ IT BINDS THE DEFAULT IMPLEMENTATION, NOT THE INTERFACE. A service that substitutes its own
// EventDedup is not validated, and should not be — it has its own shape by definition. What it gets
// instead is the primitive rather than the policy: RequireColumns, callable with its own list. The
// accepted trade is that a substituting service has no boot-time protection at all, so a typo in its
// migration surfaces at the first insert. It opted into owning its shape.
//
// ⚠ REQUIREMENTS STAY ADDITIVE. Adding a required column here makes a library bump a boot failure for
// every service that has not migrated — a coordinated deploy. Add OPTIONAL columns instead, so a service
// that has not caught up loses a capability rather than the ability to start.
func ValidateSchema(db *gorm.DB, table string) error {
	if !validTableName.MatchString(table) {
		return fmt.Errorf("san_event: %q is not a valid table name", table)
	}

	err := RequireColumns(db, table, "event_id", "occurred_at_unix")
	if err != nil {
		return err
	}

	err = requireUniqueIndexOn(db, table, "event_id")
	if err != nil {
		return err
	}

	return nil
}

// RequireColumns reports every named column that table is missing, in one error rather than one per run.
//
// Exported because it is the useful half of ValidateSchema for a service that substitutes its own
// EventDedup: it gets the same check against its own column list, without the library having to know
// that list or forcing every implementation to describe its schema declaratively.
func RequireColumns(db *gorm.DB, table string, columns ...string) error {
	found := []string{}

	err := db.
		Raw(`SELECT column_name FROM information_schema.columns
		     WHERE table_name = ? AND table_schema = current_schema()`, table).
		Scan(&found).
		Error
	if err != nil {
		return fmt.Errorf("san_event: cannot read the schema of %s: %w", table, err)
	}

	if len(found) == 0 {
		return fmt.Errorf("san_event: table %s does not exist", table)
	}

	present := map[string]bool{}
	for _, column := range found {
		present[column] = true
	}

	missing := []string{}

	for _, column := range columns {
		if !present[column] {
			missing = append(missing, column)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("san_event: table %s is missing column(s): %s", table, strings.Join(missing, ", "))
	}

	return nil
}

// requireUniqueIndexOn checks for a unique index on exactly one column — which is what makes Claim's
// ON CONFLICT (event_id) resolvable. A unique index on (event_id, something_else) would not serve as
// that conflict target, so indnatts = 1 is the point of the query rather than an accident of it.
func requireUniqueIndexOn(db *gorm.DB, table string, column string) error {
	count := int64(0)

	err := db.
		Raw(`SELECT count(*) FROM pg_index i
		     JOIN pg_class c ON c.oid = i.indrelid
		     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
		     WHERE c.relname = ? AND i.indisunique AND i.indnatts = 1 AND a.attname = ?`, table, column).
		Scan(&count).
		Error
	if err != nil {
		return fmt.Errorf("san_event: cannot read the indexes of %s: %w", table, err)
	}

	if count == 0 {
		return fmt.Errorf(
			"san_event: table %s has no UNIQUE index on %s alone — Claim's ON CONFLICT (%s) has no conflict target, so every event would insert as new",
			table, column, column,
		)
	}

	return nil
}
