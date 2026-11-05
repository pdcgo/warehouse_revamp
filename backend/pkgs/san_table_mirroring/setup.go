package san_table_mirroring

import (
	"context"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"
)

const (
	trackSuffix = "_track"

	// Postgres silently CUTS identifiers at 63 bytes, so "<name>_track" past that would land on a
	// truncated name another table could share. Such a name is refused instead.
	maxIdentifierLength = 63

	configurationsTable = "configurations"
	trackedTablesTable  = "tracked_tables"

	maxDeletePercentName    = "max_delete_percent"
	defaultMaxDeletePercent = 10.0

	// lockSpace is the first key of every advisory lock the package takes, so its locks cannot meet
	// another package's single-key locks (san_testdb's migration lock, for one).
	lockSpaceSetup = "san_table_mirroring/setup"
	lockSpaceRun   = "san_table_mirroring/run"
)

// table is one tracked table and every name the package derives from it, already quoted.
type table struct {
	schema string // public
	name   string // users
	label  string // public.users — for errors and the run lock

	pk    string // id — the source's primary key column, unquoted
	src   string // "public"."users"
	pkCol string // "id"

	trackSchema string // "public_track"
	track       string // "public_track"."users_track"
	configs     string // "public_track"."configurations"
	tracked     string // "public_track"."tracked_tables"
}

type foundTable struct {
	SchemaName string `gorm:"column:schema_name"`
	TableName  string `gorm:"column:table_name"`
}

type keyColumn struct {
	Name string `gorm:"column:name"`
	Type string `gorm:"column:type"`
}

// resolveTable finds the table (a bare "users" follows the connection's search_path; "public.users"
// names the schema) and refuses it unless its primary key is ONE integer column
// (only-single-column-keys-are-supported). It creates nothing.
func resolveTable(db *gorm.DB, tablename string) (*table, error) {
	var found []foundTable

	err := db.
		Raw(
			`SELECT n.nspname::text AS schema_name, c.relname::text AS table_name
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.oid = to_regclass(?)`,
			tablename,
		).
		Scan(&found).
		Error
	if err != nil {
		return nil, fmt.Errorf("san_table_mirroring: resolve %q: %w", tablename, err)
	}

	if len(found) == 0 {
		return nil, fmt.Errorf("%w: %q", ErrTableNotFound, tablename)
	}

	schema := found[0].SchemaName
	name := found[0].TableName
	label := schema + "." + name

	var keys []keyColumn

	err = db.
		Raw(
			`SELECT a.attname::text AS name, a.atttypid::regtype::text AS type
			FROM pg_index i
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
			WHERE i.indrelid = to_regclass(?) AND i.indisprimary
			ORDER BY a.attnum`,
			pgx.Identifier{schema, name}.Sanitize(),
		).
		Scan(&keys).
		Error
	if err != nil {
		return nil, fmt.Errorf("san_table_mirroring: primary key of %s: %w", label, err)
	}

	switch {
	case len(keys) == 0:
		return nil, fmt.Errorf("%w: %s has no primary key", ErrUnsupportedTable, label)
	case len(keys) > 1:
		names := make([]string, 0, len(keys))
		for _, k := range keys {
			names = append(names, k.Name)
		}

		return nil, fmt.Errorf("%w: %s's primary key is (%s); only a one-column integer key is supported", ErrUnsupportedTable, label, strings.Join(names, ", "))
	}

	switch keys[0].Type {
	case "smallint", "integer", "bigint":
	default:
		return nil, fmt.Errorf("%w: %s's primary key %s is %s, not an integer", ErrUnsupportedTable, label, keys[0].Name, keys[0].Type)
	}

	if len(schema)+len(trackSuffix) > maxIdentifierLength {
		return nil, fmt.Errorf("%w: schema %q is too long for a track schema named %q (Postgres cuts names at %d bytes)", ErrUnsupportedTable, schema, schema+trackSuffix, maxIdentifierLength)
	}

	if len(name)+len(trackSuffix) > maxIdentifierLength {
		return nil, fmt.Errorf("%w: table %q is too long for a track table named %q (Postgres cuts names at %d bytes)", ErrUnsupportedTable, name, name+trackSuffix, maxIdentifierLength)
	}

	trackSchema := schema + trackSuffix

	return &table{
		schema:      schema,
		name:        name,
		label:       label,
		pk:          keys[0].Name,
		src:         pgx.Identifier{schema, name}.Sanitize(),
		pkCol:       pgx.Identifier{keys[0].Name}.Sanitize(),
		trackSchema: pgx.Identifier{trackSchema}.Sanitize(),
		track:       pgx.Identifier{trackSchema, name + trackSuffix}.Sanitize(),
		configs:     pgx.Identifier{trackSchema, configurationsTable}.Sanitize(),
		tracked:     pgx.Identifier{trackSchema, trackedTablesTable}.Sanitize(),
	}, nil
}

// ensureTrack creates the track schema, its configurations and tracked_tables, and this table's
// _track table, on the first call for the table (the-package-creates-its-track-schema). A later call
// finds the _track table and returns at once.
//
// It runs in its OWN short transaction, committed before the run starts: the handler's Ack usually
// writes on another connection, which could not see a track table created inside the run's open
// transaction. Two first calls racing are serialised by an advisory lock per track schema, because
// concurrent CREATE ... IF NOT EXISTS can still collide in Postgres.
func ensureTrack(db *gorm.DB, tb *table) error {
	var exists bool

	err := db.
		Raw(`SELECT to_regclass(?) IS NOT NULL`, tb.track).
		Scan(&exists).
		Error
	if err != nil {
		return fmt.Errorf("san_table_mirroring: look for %s: %w", tb.track, err)
	}

	if exists {
		return nil
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		err := tx.
			Exec(`SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))`, lockSpaceSetup, tb.schema+trackSuffix).
			Error
		if err != nil {
			return err
		}

		statements := []struct {
			sql  string
			args []any
		}{
			{sql: `CREATE SCHEMA IF NOT EXISTS ` + tb.trackSchema},
			{sql: `CREATE TABLE IF NOT EXISTS ` + tb.configs + ` (
				id bigserial PRIMARY KEY,
				name text NOT NULL UNIQUE,
				value text NOT NULL
			)`},
			{
				sql:  `INSERT INTO ` + tb.configs + ` (name, value) VALUES (?, ?) ON CONFLICT (name) DO NOTHING`,
				args: []any{maxDeletePercentName, strconv.FormatFloat(defaultMaxDeletePercent, 'f', -1, 64)},
			},
			{sql: `CREATE TABLE IF NOT EXISTS ` + tb.tracked + ` (
				id bigserial PRIMARY KEY,
				table_name text NOT NULL UNIQUE
			)`},
			{sql: `CREATE TABLE IF NOT EXISTS ` + tb.track + ` (
				id bigint PRIMARY KEY,
				last_hash integer NOT NULL,
				last_change timestamptz NOT NULL
			)`},
			{
				sql:  `INSERT INTO ` + tb.tracked + ` (table_name) VALUES (?) ON CONFLICT (table_name) DO NOTHING`,
				args: []any{tb.name},
			},
		}

		for _, s := range statements {
			err = tx.
				Exec(s.sql, s.args...).
				Error
			if err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return fmt.Errorf("san_table_mirroring: create the track tables of %s: %w", tb.label, err)
	}

	return nil
}

// idReader returns a function that reads the primary key out of a T, through the GORM field mapped to
// the source's key column. T must be a struct or a pointer to one, with a field for that column.
func idReader[T any](db *gorm.DB, column string) (func(T) (int64, error), error) {
	var zero T

	typ := reflect.TypeOf(zero)
	if typ == nil {
		return nil, fmt.Errorf("san_table_mirroring: T must be a struct or a pointer to one")
	}

	elem := typ
	if elem.Kind() == reflect.Pointer {
		elem = elem.Elem()
	}

	if elem.Kind() != reflect.Struct {
		return nil, fmt.Errorf("san_table_mirroring: T must be a struct or a pointer to one, not %s", typ)
	}

	stmt := &gorm.Statement{DB: db}

	err := stmt.Parse(reflect.New(elem).Interface())
	if err != nil {
		return nil, fmt.Errorf("san_table_mirroring: read %s: %w", elem, err)
	}

	field := stmt.Schema.LookUpField(column)
	if field == nil {
		return nil, fmt.Errorf("san_table_mirroring: %s has no field for the primary key column %q", elem, column)
	}

	return func(row T) (int64, error) {
		rv := reflect.ValueOf(&row).Elem()
		if rv.Kind() == reflect.Pointer && rv.IsNil() {
			return 0, fmt.Errorf("san_table_mirroring: a nil %s was scanned", typ)
		}

		value, _ := field.ValueOf(context.Background(), rv)

		return toInt64(value)
	}, nil
}

func toInt64(value any) (int64, error) {
	rv := reflect.ValueOf(value)
	for rv.IsValid() && rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return 0, fmt.Errorf("san_table_mirroring: the primary key field is nil")
		}

		rv = rv.Elem()
	}

	switch rv.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return rv.Int(), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return int64(rv.Uint()), nil
	default:
		return 0, fmt.Errorf("san_table_mirroring: the primary key field holds %v, not an integer", value)
	}
}
