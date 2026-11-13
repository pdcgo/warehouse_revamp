package inventory_v1

import (
	"fmt"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"
)

// TRANSFER — `metrics/inventory/transfer`, each side on its own day (a-transfer-counts-each-side-on-its-own-day):
//
//	sent        the out-leg's `transfer_out` change rows, negated — under the SENDING warehouse on the create day; a
//	            cancel's reversal (the same type, sign flipped) takes it back on the cancel day
//	received    the in-leg's `transfer_in` change rows — the good units, under the RECEIVING warehouse on the accept day —
//	            and a received-count correction's `transfer_correction` rows on ITS day, signed
//	            (a-received-count-correction-counts-on-its-own-day)
//	in transit  a POSITION under the RECEIVING warehouse: the out-leg's units and value of every transfer created on or
//	            before the edge and neither accepted nor cancelled by it (the-transfer-is-where-goods-in-transit-are) —
//	            every day from the create to the day before the accept. Read live from `warehouse_transfers` and the
//	            out-leg's log rows: transfers are few, and the create, the accept and the cancel each stamp their stock
//	            transaction's time, so the days agree with sent and received. ⚠ A box set LOST stays in transit — no
//	            ledger moves at a loss, the units are still the transfer's — until it turns up and is accepted.
//
// Two rows per transfer, one per side, so the warehouse filter matches either side and by warehouse each warehouse
// shows its own. A warehouse reads the units only.

var (
	transferMoveFields    = []protoreflect.Name{"sent_count", "sent_value", "received_count", "received_value"}
	transferTransitFields = []protoreflect.Name{"in_transit_count", "in_transit_value"}
)

func readTransfer(db *gorm.DB, q stockQuery) (map[string]figures, error) {
	scope, args := scopeSQL(reportColumns("c"), q.reader, q.filters)

	src := `
SELECT c.day, c.warehouse_id, c.team_id, c.product_id, c.supplier_id,
       CASE WHEN c.change_type = 'transfer_out' THEN -c.change_count ELSE 0 END AS sent_count,
       CASE WHEN c.change_type = 'transfer_out' THEN -c.change_value ELSE 0 END AS sent_value,
       CASE WHEN c.change_type IN ('transfer_in', 'transfer_correction') THEN c.change_count ELSE 0 END AS received_count,
       CASE WHEN c.change_type IN ('transfer_in', 'transfer_correction') THEN c.change_value ELSE 0 END AS received_value
FROM inventory_stock_daily_changes c
WHERE c.change_type IN ('transfer_out', 'transfer_in', 'transfer_correction') AND ` + windowSQL("c.day", q.filters) + ` AND ` + scope

	out, err := readMovement(db, q, src, args, transferMoveFields)
	if err != nil {
		return nil, err
	}

	transit, err := readTransit(db, q)
	if err != nil {
		return nil, err
	}

	for k, f := range transit {
		if out[k] == nil {
			out[k] = figures{}
		}

		out[k].add(f)
	}

	return out, nil
}

// transitSource is every out-leg take row of a transfer that may be in transit between `first` and `last` (created by
// the last edge, not ended before the first): the RECEIVING warehouse, the batch's owner, product and supplier, the day
// the units left, the day the transfer ended (accepted or cancelled; none yet), and the units and value on the road.
func transitSource(q stockQuery, first, last time.Time) (string, []any) {
	scope, args := scopeSQL(keyColumns{
		warehouse: "t.to_warehouse_id", team: "b.team_id", product: "b.product_id", supplier: "b.supplier_id",
	}, q.reader, q.filters)

	ended := "COALESCE(t.accepted_at, t.cancelled_at)"

	sql := fmt.Sprintf(`
SELECT t.to_warehouse_id AS warehouse_id, b.team_id, b.product_id, b.supplier_id,
       (l.created_at AT TIME ZONE 'Asia/Jakarta')::date AS start_day,
       (%[1]s AT TIME ZONE 'Asia/Jakarta')::date AS end_day,
       -l.change_count AS in_transit_count, -l.change_valuation AS in_transit_value
FROM warehouse_transfers t
JOIN batch_logs l ON l.transaction_id = t.outbound_transaction_id AND l.change_count < 0
JOIN batches b ON b.id = l.batch_id
WHERE t.outbound_transaction_id IS NOT NULL
  AND l.created_at < (%[2]s + 1)::timestamp AT TIME ZONE 'Asia/Jakarta'
  AND (%[1]s IS NULL OR %[1]s >= (%[3]s + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
  AND %[4]s`, ended, dayLiteral(last), dayLiteral(first), scope)

	return sql, args
}

// readTransit is in transit at the edge — the window's for the headline and an id row, each period's for a time group.
func readTransit(db *gorm.DB, q stockQuery) (map[string]figures, error) {
	fields := transferTransitFields
	sums := "COALESCE(SUM(r.in_transit_count), 0)::float8, COALESCE(SUM(r.in_transit_value), 0)::float8"

	if q.summary() || !q.key.isDay {
		edge := windowEdge(q.filters, q.today)
		src, args := transitSource(q, edge, edge)
		at := fmt.Sprintf(" AND r.start_day <= %[1]s AND (r.end_day IS NULL OR r.end_day > %[1]s)", dayLiteral(edge))

		if q.summary() {
			return scanFigures(db, false, fields, "SELECT "+sums+" FROM ("+src+") AS r WHERE TRUE"+at, args...)
		}

		where, keyArgs := q.keyFilter()
		if where == "" {
			where = " WHERE TRUE"
		}

		sql := "SELECT " + keyText(q.key) + " AS key, " + sums + " FROM (" + src + ") AS r" + where + at + " GROUP BY 1"

		return scanFigures(db, true, fields, sql, append(args, keyArgs...)...)
	}

	edges := q.edges()
	if len(edges) == 0 {
		return map[string]figures{}, nil
	}

	first, last := edgeBounds(edges)
	src, args := transitSource(q, first, last)

	sql := `
WITH r AS (` + src + `),
     e(key, edge) AS (` + edgeValues(edges) + `)
SELECT to_char(e.key, 'YYYY-MM-DD') AS key, ` + sums + `
FROM e
JOIN r ON r.start_day <= e.edge AND (r.end_day IS NULL OR r.end_day > e.edge)
GROUP BY e.key`

	return scanFigures(db, true, fields, sql, args...)
}

// edgeBounds is the earliest and the latest edge.
func edgeBounds(edges map[string]time.Time) (time.Time, time.Time) {
	var first, last time.Time

	for _, e := range edges {
		if first.IsZero() || e.Before(first) {
			first = e
		}

		if last.IsZero() || e.After(last) {
			last = e
		}
	}

	return first, last
}
