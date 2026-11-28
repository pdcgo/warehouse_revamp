package inventory_v1

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE LEDGERS' LOGS AS THE HISTORY SCREENS READ THEM. The screens speak `MovementKind`; the ledgers speak
// `change_type` (the-two-type-lists-do-not-line-up resolved into one list). This file is the one place the two meet,
// so a product's history, a rack's history and the owner's history name the same row the same way.
//
// A rack's history reads `product_placement_logs` — it knows the rack, not the batch. A batch's and the owner's read
// `batch_logs` — they know the batch, not the rack. No log row carries both (a-batch-shows-the-racks-it-was-put-on), so
// a batch's history reads its rack from the rack rows of the same transaction (batchRackJoin), and a product's history
// in a warehouse reads its rack rows' batch from the batch rows of the same transaction (rackBatchJoin, moveBatchExpr —
// backlog #142), plus the price corrections, which write a batch row and no rack row.

// kindOf names a log row the way the screens do. An order only ever takes, so its positive rows are its rollback — the
// units coming back, a CANCEL (#143, transaction.md given 2: *"the cancelled order's units shown coming back, as a
// cancel"*); a buyer's return is a RETURN. A price correction is its own kind — it moved no unit
// (the-owning-team-revalues-with-a-reason). Units found broken and units found are each their own kind too (#143,
// given 3: *"the damaged unit shown as broken"*, *"the found unit shown as found"*). Every other correction (a provisional
// adjustment, a lost unit, a received-count correction) reads as an adjust.
func kindOf(changeType string, change int64) inventoryv1.MovementKind {
	switch changeType {
	case "restock":
		return inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE
	case "order":
		if change > 0 {
			return inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL
		}

		return inventoryv1.MovementKind_MOVEMENT_KIND_PICK
	case "return":
		return inventoryv1.MovementKind_MOVEMENT_KIND_RETURN
	case "broken":
		return inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN
	case "found":
		return inventoryv1.MovementKind_MOVEMENT_KIND_FOUND
	case "sample":
		return inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE
	case "transfer_in":
		return inventoryv1.MovementKind_MOVEMENT_KIND_TRANSFER_IN
	case "transfer_out":
		return inventoryv1.MovementKind_MOVEMENT_KIND_TRANSFER_OUT
	case "move":
		return inventoryv1.MovementKind_MOVEMENT_KIND_MOVE
	case "revaluation":
		return inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION
	default:
		return inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST
	}
}

// correctionTypes are the change types ADJUST reaches AS A FILTER — the provisional adjustments, units found broken,
// lost or found, and a received-count correction's (KOREKSI JUMLAH TERIMA — a-wrong-stock-in-is-a-received-count-
// correction: "in the ledger it stays an adjustment"). Since #143 a broken and a found row READ as BROKEN and FOUND
// (kindOf), but the ADJUST filter keeps its reach, so every reader asking for it — the warehouse product page's last
// stock-take among them — answers as before. A price correction is not one: it reads as REVALUATION.
var correctionTypes = []string{"adjustment", "broken", "lost", "found", "restock_correction", "transfer_correction"}

// kindsWhere is the SQL condition for log rows of any of `kinds`, over a log aliased `alias` whose signed change column
// is `change`. Empty (and no args) when no kind is asked for. The kinds are a closed switch, so nothing a caller sends
// reaches the SQL but `?` arguments. The kinds #143 split out (CANCEL, BROKEN, FOUND) find their own rows; the kinds
// they were split from (RETURN, ADJUST) keep the reach they had, so no existing filter answers differently.
func kindsWhere(alias, change string, kinds ...inventoryv1.MovementKind) (string, []any) {
	var (
		parts []string
		args  []any
	)

	for _, kind := range kinds {
		switch kind {
		case inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "restock")
		case inventoryv1.MovementKind_MOVEMENT_KIND_PICK:
			parts = append(parts, fmt.Sprintf("(%s.change_type = ? AND %s.%s < 0)", alias, alias, change))
			args = append(args, "order")
		case inventoryv1.MovementKind_MOVEMENT_KIND_RETURN:
			parts = append(parts, fmt.Sprintf("((%s.change_type = ? AND %s.%s > 0) OR %s.change_type = ?)", alias, alias, change, alias))
			args = append(args, "order", "return")
		case inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "sample")
		case inventoryv1.MovementKind_MOVEMENT_KIND_TRANSFER_IN:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "transfer_in")
		case inventoryv1.MovementKind_MOVEMENT_KIND_TRANSFER_OUT:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "transfer_out")
		case inventoryv1.MovementKind_MOVEMENT_KIND_MOVE:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "move")
		case inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST:
			parts = append(parts, alias+".change_type IN ?")
			args = append(args, correctionTypes)
		case inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "revaluation")
		case inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL:
			parts = append(parts, fmt.Sprintf("(%s.change_type = ? AND %s.%s > 0)", alias, alias, change))
			args = append(args, "order")
		case inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "broken")
		case inventoryv1.MovementKind_MOVEMENT_KIND_FOUND:
			parts = append(parts, alias+".change_type = ?")
			args = append(args, "found")
		}
	}

	if len(parts) == 0 {
		return "", nil
	}

	return "(" + strings.Join(parts, " OR ") + ")", args
}

// refExpr is what a row's `ref` shows: the order's key for an order's take, the restock's receipt for its accept.
func refExpr(alias string) string {
	return `COALESCE(
		(SELECT k.idempotency_key FROM idempotency_order_check k WHERE k.transaction_id = ` + alias + `.transaction_id),
		(SELECT r.receipt FROM restocks r WHERE r.transaction_id = ` + alias + `.transaction_id),
		'')`
}

// overrideExpr is whether the row's inventory transaction was an override — its creator Root or the System
// Administrator, outside the team (an-override-is-stamped-in-every-service). The flag lives on the TRANSACTION, never on
// the log rows it wrote, so a history row reads it by the transaction's primary key: one index probe per row of the
// page. A row under no transaction (0) reads false. The screens draw the "by Root team" badge from it
// (an-override-shows-a-platform-badge).
func overrideExpr(transactionID string) string {
	return `COALESCE((SELECT t.is_override FROM inventory_transactions t WHERE t.id = ` + transactionID + `), FALSE)`
}

// recipientExpr is who received a SAMPLE row's units — its inventory transaction's `recipient`
// (a-sample-keeps-its-recipient), read by the transaction's primary key as overrideExpr reads the flag. Only a sample row
// asks: every other row reads empty without a lookup, so a page costs one index probe per sample on it and no more.
// It takes the row's change type and transaction id as column expressions, so the rack's, the product's and the batch's
// histories (`l.change_type`, `l.transaction_id`) and the owner's page (`p.change_type`, `p.movement_id`) read it alike.
// ⚠ The CASE does not spare a sample row an OFFSET skips — a select under the LIMIT still probes it (the rack and batch
// selects below pay that on a deep page); the owner's history reads it on the page's own rows only.
func recipientExpr(changeType, transactionID string) string {
	return `CASE WHEN ` + changeType + ` = 'sample'
		THEN COALESCE((SELECT t.recipient FROM inventory_transactions t WHERE t.id = ` + transactionID + `), '')
		ELSE '' END`
}

// historyRow is one log row as the history screens read it.
type historyRow struct {
	ID          uint64
	ProductID   uint64
	WarehouseID uint64
	PlacementID uint64
	BatchID     uint64
	ChangeType  string
	Change      int64
	After       int64
	Description string
	Ref         string
	ActorID     uint64
	CreatedAt   time.Time
	// The row's inventory transaction was an override (inventory_transactions.is_override) — overrideExpr.
	IsOverride bool
	// Who received a sample row's units (inventory_transactions.recipient) — recipientExpr; empty on every other row.
	Recipient string
	// The batch's price before and after the row, and the value it changed — a batch row's (priceExprs); 0 on a rack row.
	PriceUnitBefore float64
	PriceUnitAfter  float64
	ValueChange     float64
	// The row's inventory transaction — a received-count correction's label is found by it (countCorrectionLabels).
	TransactionID uint64
	// A batch row's value change as its part carries it (batchHistorySelect) — the whole row's unless it is split over
	// racks. Nil on a rack row.
	PartValue *float64
}

func (r *historyRow) proto() *inventoryv1.StockMovement {
	return &inventoryv1.StockMovement{
		Id:          r.ID,
		ProductId:   r.ProductID,
		WarehouseId: r.WarehouseID,
		RackId:      r.PlacementID,
		BatchId:     r.BatchID,
		Delta:       r.Change,
		Balance:     r.After,
		Kind:        kindOf(r.ChangeType, r.Change),
		Reason:      r.Description,
		Ref:         r.Ref,
		ActorUserId: r.ActorID,
		CreatedAt:   r.CreatedAt.UTC().Format(time.RFC3339),
		IsOverride:  r.IsOverride,
		Recipient:   r.Recipient,

		PriceUnitBefore: r.PriceUnitBefore,
		PriceUnitAfter:  r.PriceUnitAfter,
		ValueChange:     r.valueChange(),
	}
}

// valueChange is what the row changed the value by — a batch row's part's share when it is split over racks.
func (r *historyRow) valueChange() float64 {
	if r.PartValue != nil {
		return *r.PartValue
	}

	return r.ValueChange
}

// priceExprs reads a `batch_logs` row's price and value columns as the history screens show them: the value it changed
// the batch by, the batch's unit price after it (batch-logs-carry-price-unit-after), and before it. Only a price
// correction changes a price, by Δ × the units left with no unit moved (batch.md §Change Price Flow), so its price before
// is the price after less value ÷ units — no join on `batch_price_logs`, which carries no transaction. Every other row
// leaves the price as it was.
func priceExprs(alias string) string {
	return `CASE WHEN ` + alias + `.change_type = 'revaluation' AND ` + alias + `.stock_count_after <> 0
		THEN ` + alias + `.price_unit_after - ` + alias + `.change_valuation / ` + alias + `.stock_count_after
		ELSE ` + alias + `.price_unit_after END AS price_unit_before,
	` + alias + `.price_unit_after, ` + alias + `.change_valuation AS value_change`
}

// placementHistorySelect reads `product_placement_logs AS l` as history rows: the rack, never a batch.
var placementHistorySelect = `l.id, l.product_id, l.warehouse_id, l.placement_id, 0 AS batch_id, l.change_type, l.transaction_id,
	l.stock_change AS change, l.stock_after AS after, l.description, ` + refExpr("l") + ` AS ref, l.actor_id, l.created_at,
	` + overrideExpr("l.transaction_id") + ` AS is_override,
	` + recipientExpr("l.change_type", "l.transaction_id") + ` AS recipient`

// batchRackJoin gives each `batch_logs AS l` row of `batches AS b` THE RACK IT MOVED ON (backlog #47). A batch row
// carries no rack, so the rack is read from the rack rows (`product_placement_logs`) its transaction wrote for the
// batch's product in the same warehouse, on the same side — units in for units in, out for out. A row under no
// transaction, or one that moved no unit (a price correction), finds none: rack 0.
//
// A movement over several racks reads as the rack and product histories show it — ONE ROW PER RACK — when those rack
// rows are this batch row's alone: they add up to it (`exact`), so each rack's units are this batch's. Each
// part then carries its rack's units, the batch's count after it, and its share of the value. When they do not add up,
// other batches drew on the same racks in that transaction (a take over two batches, a transfer's layers) and which
// rack fed which batch is not recorded: the row stays whole, on the transaction's FIRST rack row (`part` 1) — as the
// accepted prototype's batch history shows a take on its first shelf.
//
// One indexed lookup per batch row (product_placement_logs_transaction_idx), for the count and the page alike.
const batchRackJoin = `LEFT JOIN LATERAL (
	SELECT x.placement_id, x.part, x.exact, x.part_change, x.later_change
	FROM (
		SELECT p.placement_id,
		       p.stock_change AS part_change,
		       ROW_NUMBER() OVER (ORDER BY p.id) AS part,
		       SUM(p.stock_change) OVER () = l.change_count AS exact,
		       COALESCE(SUM(p.stock_change) OVER (ORDER BY p.id ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING), 0)::bigint
		           AS later_change
		FROM product_placement_logs p
		WHERE p.transaction_id = l.transaction_id
		  AND p.product_id = b.product_id
		  AND p.warehouse_id = l.warehouse_id
		  AND l.transaction_id <> 0
		  AND l.change_count <> 0
		  AND SIGN(p.stock_change) = SIGN(l.change_count)
	) x
	WHERE x.part = 1 OR x.exact
) rk ON TRUE`

// batchRowOrder is a batch's history newest first — a row split over racks by its rack rows, newest first too.
const batchRowOrder = "l.id DESC, rk.part DESC"

// batchHistorySelect reads `batch_logs AS l JOIN batches AS b` + batchRackJoin as history rows: the batch, and the rack
// each row (or each part of it) moved on. A part past the first is keyed by the batch row's id with its part number above
// bit 48 — unique on the page and never another batch row's id (ids stay far below 2^48).
var batchHistorySelect = `CASE WHEN COALESCE(rk.part, 1) = 1 THEN l.id ELSE ((rk.part - 1) << 48) | l.id END AS id,
	b.product_id, l.warehouse_id, COALESCE(rk.placement_id, 0) AS placement_id, l.batch_id, l.change_type, l.transaction_id,
	CASE WHEN rk.exact THEN rk.part_change ELSE l.change_count END AS change,
	CASE WHEN rk.exact THEN l.stock_count_after - rk.later_change ELSE l.stock_count_after END AS after,
	l.description, ` + refExpr("l") + ` AS ref, l.actor_id, l.created_at,
	` + overrideExpr("l.transaction_id") + ` AS is_override,
	` + recipientExpr("l.change_type", "l.transaction_id") + ` AS recipient, ` + priceExprs("l") + `,
	CASE WHEN rk.exact THEN l.change_valuation * rk.part_change / l.change_count ELSE l.change_valuation END AS part_value`

// rackBatchJoin gives each `product_placement_logs AS l` rack row THE BATCH ITS UNITS CAME FROM (backlog #142) — the
// mirror of batchRackJoin. A rack row carries no batch, so the batch is read from the batch rows (`batch_logs`) its
// transaction wrote for the same product in the same warehouse, of the same change type, on the same side — units in
// for units in, out for out (a cancel's rows are its take's rows reversed under the same transaction, so only the side
// tells them apart, a-rollback-reverses-its-log-rows). Grouped by batch:
//
//   - one batch: the row names it, whole (a take off one batch, a put-away over two racks);
//   - several batches that add up to this rack row (`exact` — the transaction's only rack row of the product on that
//     side: a take crossing from one batch into the next): ONE ROW PER BATCH, as a batch's history splits a movement
//     over two racks — each part carries its batch's units and the rack's count after that part;
//   - several batches that do not add up (several racks drawn by several batches — which rack fed which batch is not
//     recorded): the row whole, batch 0, said as "—".
//
// A row under no transaction, one that moved no unit (a rack an exact recount found right — batch-less, #211) and a move
// (it writes no batch row — moveBatchExpr) find none.
//
// ONE pass over the product's batch rows in the warehouse, grouped per transaction, change type, side and batch, hash
// joined to its rack rows — not a lookup per rack row: a lookup per row ran for every row of the product before the
// page was cut (3 201 probes, ~90 ms on a 5 000-row product). Its two arguments: the warehouse, the product.
const rackBatchJoin = `LEFT JOIN (
	SELECT g.transaction_id, g.change_type, g.side, g.batch_id,
	       g.change AS part_change,
	       ROW_NUMBER() OVER upto AS part,
	       COUNT(*) OVER side AS batches,
	       SUM(g.change) OVER side AS total,
	       (SUM(g.change) OVER side - SUM(g.change) OVER upto)::bigint AS later_change
	FROM (
		SELECT bl.transaction_id, bl.change_type, SIGN(bl.change_count) AS side, bl.batch_id,
		       SUM(bl.change_count)::bigint AS change, MIN(bl.id) AS first_id
		FROM batch_logs bl
		JOIN batches bb ON bb.id = bl.batch_id
		WHERE bl.warehouse_id = ? AND bb.product_id = ?
		  AND bl.transaction_id <> 0 AND bl.change_count <> 0
		GROUP BY bl.transaction_id, bl.change_type, SIGN(bl.change_count), bl.batch_id
	) g
	-- side: the transaction's batches on one side; upto: those up to this one, first drawn first (later = the rest).
	WINDOW side AS (PARTITION BY g.transaction_id, g.change_type, g.side),
	       upto AS (PARTITION BY g.transaction_id, g.change_type, g.side ORDER BY g.first_id)
) bk ON bk.transaction_id = l.transaction_id
	AND bk.change_type = l.change_type
	AND bk.side = SIGN(l.stock_change)
	AND l.transaction_id <> 0
	AND l.stock_change <> 0
	AND (bk.part = 1 OR (bk.total = l.stock_change AND bk.batches > 1))`

// rackRowSplit is whether a rack row reads as one part per batch (rackBatchJoin's second case: its batches add up to it).
const rackRowSplit = "(bk.total = l.stock_change AND bk.batches > 1)"

// placementBatchSelect reads `product_placement_logs AS l` + rackBatchJoin as a product's history rows (#142): the rack,
// its batch — or one part per batch — and the keys the page orders by. A part past the first is keyed by the rack row's
// id with its part number above bit 48, as batchHistorySelect keys its parts. No price: a rack row carries none.
var placementBatchSelect = `CASE WHEN COALESCE(bk.part, 1) = 1 THEN l.id ELSE ((bk.part - 1) << 48) | l.id END AS id,
	l.product_id, l.warehouse_id, l.team_id, l.placement_id,
	CASE WHEN bk.batches = 1 OR ` + rackRowSplit + ` THEN bk.batch_id ELSE 0 END AS batch_id,
	l.change_type, l.transaction_id,
	CASE WHEN ` + rackRowSplit + ` THEN bk.part_change ELSE l.stock_change END AS change,
	CASE WHEN ` + rackRowSplit + ` THEN l.stock_after - bk.later_change ELSE l.stock_after END AS after,
	l.description, l.actor_id, l.created_at,
	0::double precision AS price_unit_before, 0::double precision AS price_unit_after, 0::double precision AS value_change,
	0 AS src, l.id AS row_id, COALESCE(bk.part, 1)::bigint AS part`

// priceCorrectionSelect reads `batch_logs AS l JOIN batches AS b` price corrections as a product's history rows (#143,
// transaction.md given 4: *"each shown with its own kind: … price corrected"*): a correction writes a batch row and NO
// rack row (revaluation-and-opname-are-transaction-types), so the rack rows alone never show it. Rack 0, its batch, the
// batch's units left as the count after, and its price before and after (priceExprs). Keyed above bit 47 — a batch row's
// id is not a rack row's, and the two share one page.
var priceCorrectionSelect = `(1::bigint << 47) | l.id AS id,
	b.product_id, l.warehouse_id, b.team_id, 0::bigint AS placement_id, l.batch_id,
	l.change_type, l.transaction_id,
	l.change_count AS change, l.stock_count_after AS after,
	l.description, l.actor_id, l.created_at,
	` + priceExprs("l") + `,
	1 AS src, l.id AS row_id, 1::bigint AS part`

// productHistoryOrder is a product's history newest first — by time, since its rows come from two logs whose ids do not
// compare; within one instant a price correction above the rack rows, the rack rows by id, a row split over batches by
// its parts, newest first too.
const productHistoryOrder = "created_at DESC, src DESC, row_id DESC, part DESC"

// moveBatchExpr is a MOVE's batch (#142), over the page's row `h`. A move writes no batch row and a rack never knows its
// batches (product_placements never knows a batch), so which batch's units were carried is recorded nowhere. It is known
// only when the warehouse had ever held ONE batch of the product up to the move — its owner's batches here minted at or
// before it: then every unit on any of its racks was that batch's. Otherwise 0. One probe on batches_last_price_idx per
// move on the page; every other row keeps the batch rackBatchJoin read.
func moveBatchExpr(h string) string {
	return `CASE WHEN ` + h + `.change_type = 'move' AND ` + h + `.batch_id = 0 THEN COALESCE((
		SELECT CASE WHEN COUNT(*) = 1 THEN MIN(o.id) ELSE 0 END
		FROM (
			SELECT bm.id FROM batches bm
			WHERE bm.warehouse_id = ` + h + `.warehouse_id
			  AND bm.team_id = ` + h + `.team_id
			  AND bm.product_id = ` + h + `.product_id
			  AND bm.created_at <= ` + h + `.created_at
			LIMIT 2
		) o), 0)
		ELSE ` + h + `.batch_id END`
}

// labelCountCorrections sets the KOREKSI JUMLAH TERIMA label on every history row a received-count correction wrote —
// *Jumlah terima dikoreksi · from → to*, why, and the restock or transfer (a-wrong-stock-in-is-a-received-count-
// correction). One statement for the page, none when it holds no correction row.
func labelCountCorrections(db *gorm.DB, rows []historyRow, out []*inventoryv1.StockMovement) error {
	var keys []labelKey

	for i := range rows {
		if countCorrectionTypes[rows[i].ChangeType] {
			keys = append(keys, labelKey{TransactionID: rows[i].TransactionID, ProductID: rows[i].ProductID})
		}
	}

	if len(keys) == 0 {
		return nil
	}

	labels, err := countCorrectionLabels(db, keys)
	if err != nil {
		return err
	}

	for i := range rows {
		if !countCorrectionTypes[rows[i].ChangeType] {
			continue
		}

		out[i].ReceivedCountCorrection = labels[labelKey{TransactionID: rows[i].TransactionID, ProductID: rows[i].ProductID}]
	}

	return nil
}
