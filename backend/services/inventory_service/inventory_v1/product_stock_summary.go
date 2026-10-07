package inventory_v1

import (
	"context"
	"database/sql"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// ProductStockSummary answers the Info tab's stat tiles in ONE read (#209) — Ready and Ongoing stock,
// when it was last counted, and the last delivery. One aggregate call keeps the header cheap.
//
// It answers only what THIS service owns. The Last-order and Last-return tiles link into other
// services (selling / return) and the page resolves them separately — this read never fabricates a
// number it cannot stand behind.
func (s *Service) ProductStockSummary(
	ctx context.Context,
	req *connect.Request[inventoryv1.ProductStockSummaryRequest],
) (*connect.Response[inventoryv1.ProductStockSummaryResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()

	db := s.db.WithContext(ctx)

	// READY — on hand across every shelf, and its value across known-cost layers (#74: an unknown-cost
	// batch adds nothing rather than valuing at 0).
	var readyQty int64

	err := db.Raw(`SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels WHERE warehouse_id = ? AND product_id = ?`,
		warehouseID, productID).Scan(&readyQty).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var readyValue int64

	err = db.Raw(`
		SELECT COALESCE(SUM(sb.qty * b.unit_cost), 0)
		FROM stock_shelf_batches sb
		JOIN stock_batches b ON b.id = sb.batch_id
		WHERE b.warehouse_id = ? AND b.product_id = ? AND b.unit_cost IS NOT NULL`,
		warehouseID, productID).Scan(&readyValue).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// ONGOING — inbound on restocks not yet accepted, and the estimated cost of those lines.
	type ongoing struct {
		Qty   int64
		Value int64
	}

	var o ongoing

	err = db.Raw(`
		SELECT COALESCE(SUM(i.quantity), 0) AS qty, COALESCE(SUM(i.total_price), 0) AS value
		FROM restock_request_items i
		JOIN restock_requests r ON r.id = i.restock_request_id
		WHERE r.warehouse_id = ? AND i.product_id = ? AND r.status = ?`,
		warehouseID, productID, restockStatusPending).Scan(&o).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Last counted — the most recent stock-take (ADJUST) on any shelf. NULL when never counted, so a
	// nullable scan target: a plain *time.Time cannot hold the NULL a MAX over no rows returns.
	var lastCounted sql.NullTime

	err = db.Raw(`SELECT MAX(created_at) FROM stock_movements WHERE warehouse_id = ? AND product_id = ? AND kind = ?`,
		warehouseID, productID, int32(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST)).Scan(&lastCounted).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Last delivery — the newest batch's delivery number. NULL when never delivered here.
	var lastRestock sql.NullInt64

	err = db.Raw(`SELECT MAX(delivery_id) FROM stock_batches WHERE warehouse_id = ? AND product_id = ?`,
		warehouseID, productID).Scan(&lastRestock).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := &inventoryv1.ProductStockSummaryResponse{
		ReadyQty:        readyQty,
		ReadyValue:      readyValue,
		OngoingQty:      o.Qty,
		OngoingValueEst: o.Value,
	}

	if lastCounted.Valid {
		out.LastCountedUnix = lastCounted.Time.Unix()
	}
	if lastRestock.Valid {
		out.LastRestockId = uint64(lastRestock.Int64)
	}

	return connect.NewResponse(out), nil
}
