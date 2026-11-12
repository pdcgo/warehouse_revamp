package inventory_v1

import (
	"fmt"

	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"
)

// READY STOCK — `metrics/inventory/ready` (the-inventory-metrics-prototype-is-accepted,
// ready-stock-is-folded-in-the-stock-changes-own-step): units on hand and their value at the end of a Jakarta day —
// POSITIONS (a-position-is-its-own-stat-type), under the warehouse where they sit, the batch's owner and supplier. Every
// reader reads both, a warehouse included (a-warehouse-sees-ready-value-but-a-shelf-only-units).
//
// READ BACKWARDS FROM TODAY: position(edge, key) = Σ batches now (key) − Σ changes (key, day > edge). A window ending
// today reads the batches alone; a time series is one pass over the changes after its earliest edge. Never forwards
// from the start of time (the-balance-series-is-a-running-sum). Every stock writer folds its change rows in its own
// transaction (inventory_ledgers.StockTransaction), so the subtraction is exact; the migration replayed the ledger's
// changes before the build, so a past edge is exact too.

var readyFields = []protoreflect.Name{"on_hand_count", "on_hand_value"}

func readReady(db *gorm.DB, q stockQuery) (map[string]figures, error) {
	batchScope, batchArgs := scopeSQL(reportColumns("b"), q.reader, q.filters)
	changeScope, changeArgs := scopeSQL(reportColumns("c"), q.reader, q.filters)

	if q.summary() || !q.key.isDay {
		edge := windowEdge(q.filters, q.today)

		// Today's batches with units (an emptied batch is worth exactly 0 — an-emptying-take-takes-all-the-value), less
		// every change after the edge — a key's rows from both sides, summed per key.
		src := fmt.Sprintf(`
SELECT b.warehouse_id, b.team_id, b.product_id, b.supplier_id,
       b.stock_count AS on_hand_count, b.stock_valuation AS on_hand_value
FROM batches b
WHERE b.stock_count > 0 AND %s
UNION ALL
SELECT c.warehouse_id, c.team_id, c.product_id, c.supplier_id, -c.change_count, -c.change_value
FROM inventory_stock_daily_changes c
WHERE c.day > %s AND %s`, batchScope, dayLiteral(edge), changeScope)

		return readMovement(db, q, src, append(batchArgs, changeArgs...), readyFields)
	}

	edges := q.edges()
	if len(edges) == 0 {
		return map[string]figures{}, nil
	}

	first, _ := edgeBounds(edges)

	// One total of today's batches, the day's net changes after the earliest edge, and per period today's total less
	// the changes after its own edge.
	sql := fmt.Sprintf(`
WITH now AS (
    SELECT COALESCE(SUM(b.stock_count), 0)::float8 AS units, COALESCE(SUM(b.stock_valuation), 0)::float8 AS value
    FROM batches b
    WHERE b.stock_count > 0 AND %s
),
ch AS (
    SELECT c.day, SUM(c.change_count)::float8 AS units, SUM(c.change_value)::float8 AS value
    FROM inventory_stock_daily_changes c
    WHERE c.day > %s AND %s
    GROUP BY c.day
),
e(key, edge) AS (%s)
SELECT to_char(e.key, 'YYYY-MM-DD') AS key,
       now.units - COALESCE((SELECT SUM(ch.units) FROM ch WHERE ch.day > e.edge), 0),
       now.value - COALESCE((SELECT SUM(ch.value) FROM ch WHERE ch.day > e.edge), 0)
FROM e CROSS JOIN now`, batchScope, dayLiteral(first), changeScope, edgeValues(edges))

	return scanFigures(db, true, readyFields, sql, append(batchArgs, changeArgs...)...)
}
