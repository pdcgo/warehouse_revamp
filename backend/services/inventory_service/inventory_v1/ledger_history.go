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
// a batch's history reads its rack from the rack rows of the same transaction (batchRackJoin).

// kindOf names a log row the way the screens do. An order only ever takes, so its positive rows are its rollback — the
// units coming back. A price correction is its own kind — it moved no unit (the-owning-team-revalues-with-a-reason).
// Every other correction (a provisional adjustment, a problem, a found unit) reads as an adjust.
func kindOf(changeType string, change int64) inventoryv1.MovementKind {
	switch changeType {
	case "restock":
		return inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE
	case "order":
		if change > 0 {
			return inventoryv1.MovementKind_MOVEMENT_KIND_RETURN
		}

		return inventoryv1.MovementKind_MOVEMENT_KIND_PICK
	case "return":
		return inventoryv1.MovementKind_MOVEMENT_KIND_RETURN
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

// correctionTypes are the change types that read as an adjust — units found broken, lost or found, and a received-count
// correction's (KOREKSI JUMLAH TERIMA — a-wrong-stock-in-is-a-received-count-correction: "in the ledger it stays an
// adjustment"). A price correction is not one: it reads as REVALUATION.
var correctionTypes = []string{"adjustment", "broken", "lost", "found", "restock_correction", "transfer_correction"}

// kindsWhere is the SQL condition for log rows of any of `kinds`, over a log aliased `alias` whose signed change column
// is `change`. Empty (and no args) when no kind is asked for. The kinds are a closed switch, so nothing a caller sends
// reaches the SQL but `?` arguments.
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
	` + overrideExpr("l.transaction_id") + ` AS is_override`

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
	` + overrideExpr("l.transaction_id") + ` AS is_override, ` + priceExprs("l") + `,
	CASE WHEN rk.exact THEN l.change_valuation * rk.part_change / l.change_count ELSE l.change_valuation END AS part_value`

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
