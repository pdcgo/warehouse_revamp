package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// OwnerStockHistory is the STOCK HISTORY tab of the catalogue owner's product detail (#232): every
// movement of the owner's units, newest first, so a number that looks wrong can be explained.
//
// It reads the BATCH ledger's rows of the owner's batches (`batches.team_id`, a-batch-carries-its-owner) — not the
// racks' rows. A rack's row answers for a SHELF: its count is a rack's running total and a shelf-to-shelf move is one
// of its most common rows. Neither is a fact about what the owner holds; a move writes no batch row at all.
//
// ── The running balance is computed here, and the window comes BEFORE the filters ────────────────
//
// `balance` is the owner's on-hand of this product in that building after the movement — a running sum
// over their own ledger. It is derived rather than stored so it cannot drift from the rows it is made
// of, and the window runs over the UNFILTERED set in a subquery: summing after a
// kind or date filter would produce "the total of the adjustments I asked to see", which is a number
// about the filter rather than about the stock.
//
// PARTITION BY warehouse_id, always. With the lens set it is a single partition and costs nothing;
// with the lens open it is what keeps each row's balance a statement about ONE building, rather than a
// total that adds together stock in cities that can never fill each other's orders.
func (s *Service) OwnerStockHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.OwnerStockHistoryRequest],
) (*connect.Response[inventoryv1.OwnerStockHistoryResponse], error) {
	teamID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()

	inner := `
		SELECT l.id, l.transaction_id AS movement_id, b.product_id, l.warehouse_id, l.batch_id,
		       l.change_type, l.change_count AS delta,
		       SUM(l.change_count) OVER (PARTITION BY l.warehouse_id ORDER BY l.id) AS balance,
		       l.description AS reason, ` + refExpr("l") + ` AS ref, l.actor_id AS actor_user_id, l.created_at
		FROM batch_logs l
		JOIN batches b ON b.id = l.batch_id
		WHERE b.team_id = ? AND b.product_id = ?`

	args := []any{teamID, filter.GetProductId()}

	if warehouseID := filter.GetWarehouseId(); warehouseID > 0 {
		inner += ` AND l.warehouse_id = ?`
		args = append(args, warehouseID)
	}

	// The narrowing filters sit OUTSIDE the window — see the header.
	where := ` WHERE TRUE`

	if cond, kindArgs := kindsWhere("x", "delta", filter.GetKind()); cond != "" {
		where += ` AND ` + cond
		args = append(args, kindArgs...)
	}

	// Server-side, like the warehouse's ledger: the history is paginated and grows forever, so a
	// client-side date filter would narrow the loaded page only. 0 = open on that end.
	if from := filter.GetFromUnix(); from > 0 {
		where += ` AND created_at >= ?`
		args = append(args, time.Unix(from, 0))
	}

	if to := filter.GetToUnix(); to > 0 {
		where += ` AND created_at <= ?`
		args = append(args, time.Unix(to, 0))
	}

	db := s.db.WithContext(ctx)

	var total int64

	err := db.Raw("SELECT COUNT(*) FROM ("+inner+") x"+where, args...).Scan(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		ID          uint64
		MovementID  uint64
		ProductID   uint64
		WarehouseID uint64
		BatchID     uint64
		ChangeType  string
		Delta       int64
		Balance     int64
		Reason      string
		Ref         string
		ActorUserID uint64
		CreatedAt   time.Time
	}

	var rows []row

	err = db.
		Raw("SELECT * FROM ("+inner+") x"+where+" ORDER BY id DESC LIMIT ? OFFSET ?",
			append(append([]any{}, args...), int(page.GetLimit()), pageOffset(page))...).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	movements := make([]*inventoryv1.OwnerMovement, 0, len(rows))

	for i := range rows {
		r := &rows[i]

		movements = append(movements, &inventoryv1.OwnerMovement{
			Id:            r.ID,
			MovementId:    r.MovementID,
			ProductId:     r.ProductID,
			WarehouseId:   r.WarehouseID,
			BatchId:       r.BatchID,
			Kind:          kindOf(r.ChangeType, r.Delta),
			Delta:         r.Delta,
			Balance:       r.Balance,
			Reason:        r.Reason,
			Ref:           r.Ref,
			ActorUserId:   r.ActorUserID,
			CreatedAtUnix: r.CreatedAt.Unix(),
		})
	}

	items, ids := ownerHistoryItems(movements, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.OwnerStockHistoryResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
