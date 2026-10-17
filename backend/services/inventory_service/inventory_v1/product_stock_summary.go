package inventory_v1

import (
	"context"
	"database/sql"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
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

	// READY — the units the batches hold here, and their value: every batch carries its price, so nothing is unknown.
	var readyQty int64

	err := db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE warehouse_id = ? AND product_id = ?`,
		warehouseID, productID).Scan(&readyQty).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var readyValue int64

	err = db.Raw(`
		SELECT COALESCE(ROUND(SUM(stock_valuation)), 0)::BIGINT
		FROM batches
		WHERE warehouse_id = ? AND product_id = ?`,
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
		SELECT COALESCE(SUM(i.count), 0) AS qty, ROUND(COALESCE(SUM(i.total), 0))::bigint AS value
		FROM restock_items i
		JOIN restocks r ON r.id = i.restock_id
		WHERE r.warehouse_id = ? AND i.product_id = ? AND r.status IN ?`,
		warehouseID, productID, restockInboundStatuses).Scan(&o).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Last counted — the most recent count (an `adjustment` rack row) on any rack. NULL when never counted, so a
	// nullable scan target: a plain *time.Time cannot hold the NULL a MAX over no rows returns.
	var lastCounted sql.NullTime

	err = db.Raw(`SELECT MAX(created_at) FROM product_placement_logs WHERE warehouse_id = ? AND product_id = ? AND change_type = ?`,
		warehouseID, productID, string(inventory_service_models.TxAdjustment)).Scan(&lastCounted).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Last delivery — the newest restock that minted a batch of it here. NULL when never delivered here.
	var lastRestock sql.NullInt64

	err = db.Raw(`SELECT MAX(r.id) FROM restocks r JOIN batches b ON b.transaction_id = r.transaction_id
		 WHERE b.warehouse_id = ? AND b.product_id = ?`,
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
