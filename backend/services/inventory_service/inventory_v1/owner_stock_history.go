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
// It reads `stock_owner_movements` — the owner's projection of the ledger — and not `stock_movements`
// itself. That table answers for a SHELF: its balance is a rack's running total and a shelf-to-shelf
// move is one of its most common rows. Neither is a fact about what the owner holds. See the
// projection's migration for why the translation happens at write time.
//
// ── The running balance is computed here, and the window comes BEFORE the filters ────────────────
//
// `balance` is the owner's on-hand of this product in that building after the movement — a running sum
// over their own ledger. It is derived rather than stored so it cannot drift from the rows it is made
// of (see the migration), and the window runs over the UNFILTERED set in a subquery: summing after a
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
		SELECT id, movement_id, product_id, warehouse_id,
		       COALESCE(batch_id, 0) AS batch_id, kind, delta,
		       SUM(delta) OVER (PARTITION BY warehouse_id ORDER BY id) AS balance,
		       reason, ref, actor_user_id, created_at
		FROM stock_owner_movements
		WHERE owner_team_id = ? AND product_id = ?`

	args := []any{teamID, filter.GetProductId()}

	if warehouseID := filter.GetWarehouseId(); warehouseID > 0 {
		inner += ` AND warehouse_id = ?`
		args = append(args, warehouseID)
	}

	// The narrowing filters sit OUTSIDE the window — see the header.
	where := ` WHERE TRUE`

	if kind := filter.GetKind(); kind != inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED {
		where += ` AND kind = ?`
		args = append(args, int32(kind))
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
		Kind        int32
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
			Kind:          inventoryv1.MovementKind(r.Kind),
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
