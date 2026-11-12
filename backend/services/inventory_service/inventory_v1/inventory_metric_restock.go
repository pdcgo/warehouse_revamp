package inventory_v1

import (
	"fmt"
	"strings"

	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"
)

// RESTOCK — `metrics/inventory/restock` (the-inventory-metrics-prototype-is-accepted): the good units a restock accept
// put on the racks and their landed value (the batch's price — unit-price-is-line-price-plus-costs-per-unit), on the
// accept's Jakarta day, under the receiving warehouse, the restocking team and the line's supplier; and what its door
// found broken or missing. Read from the accept's `restock` change rows and its `restock` door rows, both written in the
// accept's own transaction. A warehouse reads the units and the door, never the value.

var restockFields = []protoreflect.Name{"accepted_count", "accepted_value", "broken_count", "missing_count"}

func readRestock(db *gorm.DB, q stockQuery) (map[string]figures, error) {
	src, args := doorMovementSource("restock", "accepted_count", "accepted_value", q)

	return readMovement(db, q, src, args, restockFields)
}

// doorMovementSource is a stock-in with a door — a restock's or a return's: its change rows (units and value, one
// change type) beside its door rows (broken, missing) of the same name, each over the window and the scope, as one row
// set aliased by the caller: day, the four dimensions, then <count>, <value>, broken_count, missing_count. `kind` is
// a constant of this file's callers, never a request's.
func doorMovementSource(kind, countColumn, valueColumn string, q stockQuery) (string, []any) {
	changeScope, changeArgs := scopeSQL(reportColumns("c"), q.reader, q.filters)
	doorScope, doorArgs := scopeSQL(reportColumns("d"), q.reader, q.filters)

	sql := fmt.Sprintf(`
SELECT c.day, c.warehouse_id, c.team_id, c.product_id, c.supplier_id,
       c.change_count AS %[1]s, c.change_value AS %[2]s, 0::bigint AS broken_count, 0::bigint AS missing_count
FROM inventory_stock_daily_changes c
WHERE c.change_type = '%[3]s' AND %[4]s AND %[5]s
UNION ALL
SELECT d.day, d.warehouse_id, d.team_id, d.product_id, d.supplier_id,
       0::bigint, 0::float8, d.broken_count, d.missing_count
FROM inventory_door_daily_reports d
WHERE d.source = '%[3]s' AND %[6]s AND %[7]s`,
		countColumn, valueColumn, kind,
		windowSQL("c.day", q.filters), changeScope,
		windowSQL("d.day", q.filters), doorScope)

	return sql, append(changeArgs, doorArgs...)
}

// readMovement sums a movement metric's rows over the window — the headline, or grouped by the query's key (the asked
// keys, or every key for a search). ONE statement.
func readMovement(db *gorm.DB, q stockQuery, src string, args []any, fields []protoreflect.Name) (map[string]figures, error) {
	sums := make([]string, 0, len(fields))
	for _, f := range fields {
		sums = append(sums, fmt.Sprintf("COALESCE(SUM(r.%s), 0)::float8", f))
	}

	if q.summary() {
		return scanFigures(db, false, fields, "SELECT "+strings.Join(sums, ", ")+" FROM ("+src+") AS r", args...)
	}

	where, keyArgs := q.keyFilter()

	sql := "SELECT " + keyText(q.key) + " AS key, " + strings.Join(sums, ", ") +
		" FROM (" + src + ") AS r" + where + " GROUP BY 1"

	return scanFigures(db, true, fields, sql, append(args, keyArgs...)...)
}
