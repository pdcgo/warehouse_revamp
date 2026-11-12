package inventory_v1

import (
	"fmt"
	"strings"
	"time"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE LEDGERS' LOGS AS THE HISTORY SCREENS READ THEM. The screens speak `MovementKind`; the ledgers speak
// `change_type` (the-two-type-lists-do-not-line-up resolved into one list). This file is the one place the two meet,
// so a product's history, a rack's history and the owner's history name the same row the same way.
//
// A rack's history reads `product_placement_logs` — it knows the rack, not the batch. A batch's and the owner's read
// `batch_logs` — they know the batch, not the rack. No log row carries both (a-batch-shows-the-racks-it-was-put-on).

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

// correctionTypes are the change types that read as an adjust — units found broken, lost or found. A price correction is
// not one: it reads as REVALUATION.
var correctionTypes = []string{"adjustment", "broken", "lost", "found"}

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
		ValueChange:     r.ValueChange,
	}
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
var placementHistorySelect = `l.id, l.product_id, l.warehouse_id, l.placement_id, 0 AS batch_id, l.change_type,
	l.stock_change AS change, l.stock_after AS after, l.description, ` + refExpr("l") + ` AS ref, l.actor_id, l.created_at,
	` + overrideExpr("l.transaction_id") + ` AS is_override`

// batchHistorySelect reads `batch_logs AS l JOIN batches AS b` as history rows: the batch, never a rack.
var batchHistorySelect = `l.id, b.product_id, l.warehouse_id, 0 AS placement_id, l.batch_id, l.change_type,
	l.change_count AS change, l.stock_count_after AS after, l.description, ` + refExpr("l") + ` AS ref, l.actor_id, l.created_at,
	` + overrideExpr("l.transaction_id") + ` AS is_override, ` + priceExprs("l")
