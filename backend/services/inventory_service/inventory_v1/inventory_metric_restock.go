package inventory_v1

import (
	"fmt"
	"strings"

	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"
)

// RESTOCK — `metrics/inventory/restock` (the-inventory-metrics-prototype-is-accepted, widened before the accept by
// the-restock-before-the-accept-prototype-is-accepted):
//
//	ordered        units and their share of the restock's total (goods + shipping), on the create day; an edit's
//	               difference on the edit day; a cancel taking it back on the cancel day
//	               (a-cancelled-restock-takes-its-ordered-back-on-its-day)
//	lost           units and their share of the total given up on the way, on the lost day; taken back on the day a lost
//	               box is signed for as arrived (a-lost-box-that-turns-up-takes-its-lost-back-on-its-day)
//	accepted       the good units a restock accept put on the racks and their landed value (the batch's price —
//	               unit-price-is-line-price-plus-costs-per-unit), on the accept's Jakarta day
//	broken/missing what its door found, on the accept day
//	cod            the courier's charge at the door, Terima's final figure, on the accept day
//
// under the restock's warehouse, the restocking team and the line's supplier. Accepted is read from the accept's
// `restock` change rows; the rest from the `restock` door rows each restock write adds in its own transaction
// (restock_metric_fold.go). A warehouse reads the units and the COD it paid, never a value.
//
// A RECEIVED-COUNT CORRECTION counts on ITS day, signed (a-received-count-correction-counts-on-its-own-day): its
// `restock_correction` change rows move accepted (−2 units and their value for 20 → 18) and its door rows move missing
// (+2) — the accept's day never changes.

var restockFields = []protoreflect.Name{
	"ordered_count", "ordered_value", "lost_count", "lost_value",
	"accepted_count", "accepted_value", "broken_count", "missing_count",
	"cod_amount",
}

// restockDoorFields is what Restock reads off its door rows beyond broken and missing — the facts before (and beside)
// the accept.
var restockDoorFields = []string{"ordered_count", "ordered_value", "lost_count", "lost_value", "cod_amount"}

func readRestock(db *gorm.DB, q stockQuery) (map[string]figures, error) {
	src, args := doorMovementSource("restock", "'restock', 'restock_correction'", "accepted_count", "accepted_value", q,
		restockDoorFields...)

	return readMovement(db, q, src, args, restockFields)
}

// doorMovementSource is a stock-in with a door — a restock's or a return's: its change rows (units and value, one
// change type) beside its door rows (broken, missing) of the same name, each over the window and the scope, as one row
// set aliased by the caller: day, the four dimensions, then <count>, <value>, broken_count, missing_count, and each of
// `doorExtra` — door columns the change rows read as 0 (Restock's ordered, lost and COD). `kind` (the door source),
// `changeTypes` (the change rows' quoted type list) and `doorExtra` are constants of this file's callers, never a
// request's.
func doorMovementSource(kind, changeTypes, countColumn, valueColumn string, q stockQuery, doorExtra ...string) (string, []any) {
	changeScope, changeArgs := scopeSQL(reportColumns("c"), q.reader, q.filters)
	doorScope, doorArgs := scopeSQL(reportColumns("d"), q.reader, q.filters)

	changeExtra, doorExtraCols := "", ""
	for _, col := range doorExtra {
		changeExtra += ", 0 AS " + col
		doorExtraCols += ", d." + col
	}

	sql := fmt.Sprintf(`
SELECT c.day, c.warehouse_id, c.team_id, c.product_id, c.supplier_id,
       c.change_count AS %[1]s, c.change_value AS %[2]s, 0::bigint AS broken_count, 0::bigint AS missing_count%[9]s
FROM inventory_stock_daily_changes c
WHERE c.change_type IN (%[8]s) AND %[4]s AND %[5]s
UNION ALL
SELECT d.day, d.warehouse_id, d.team_id, d.product_id, d.supplier_id,
       0::bigint, 0::float8, d.broken_count, d.missing_count%[10]s
FROM inventory_door_daily_reports d
WHERE d.source = '%[3]s' AND %[6]s AND %[7]s`,
		countColumn, valueColumn, kind,
		windowSQL("c.day", q.filters), changeScope,
		windowSQL("d.day", q.filters), doorScope, changeTypes,
		changeExtra, doorExtraCols)

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
