package inventory_v1

import (
	"context"
	"database/sql"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// OwnerStockStat is the same facts as OwnerStockByIds, summed over the WHOLE catalogue — the stat row
// above the product list.
//
// It is a separate read rather than a total of the page for a reason the screen depends on: the stat
// describes what the team owns, and the page shows twenty rows of it filtered by a search box. Adding
// up the visible rows would make the headline move every time somebody typed, which is the one thing
// a headline must not do.
//
// Ownership is derived exactly as in OwnerStockByIds — through restock_requests.requesting_team_id —
// so this can never total another team's goods.
func (s *Service) OwnerStockStat(
	ctx context.Context,
	req *connect.Request[inventoryv1.OwnerStockStatRequest],
) (*connect.Response[inventoryv1.OwnerStockStatResponse], error) {
	teamID := req.Msg.GetTeamId()
	warehouseID := req.Msg.GetFilter().GetWarehouseId()

	db := s.db.WithContext(ctx)

	// The lens as a pair of SQL fragments: `?` is the warehouse and `? = 0` disables the clause, so
	// one statement serves both "everywhere" and "this building" without string-building a WHERE.
	const readySQL = `
		SELECT COALESCE(SUM(sb.qty), 0) AS qty,
		       COALESCE(SUM(sb.qty * COALESCE(b.unit_cost, 0)), 0) AS value
		FROM stock_shelf_batches sb
		JOIN stock_batches b ON b.id = sb.batch_id
		JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
		JOIN restock_requests r ON r.id = ri.restock_request_id
		WHERE r.requesting_team_id = ? AND sb.qty > 0 AND (? = 0 OR b.warehouse_id = ?)`

	var ready struct {
		Qty   int64
		Value int64
	}

	err := db.Raw(readySQL, teamID, warehouseID, warehouseID).Scan(&ready).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	const ongoingSQL = `
		SELECT COALESCE(SUM(ri.quantity), 0) AS qty,
		       COALESCE(SUM(ri.total_price), 0) AS value
		FROM restock_request_items ri
		JOIN restock_requests r ON r.id = ri.restock_request_id
		WHERE r.requesting_team_id = ? AND r.status = ? AND (? = 0 OR r.warehouse_id = ?)`

	var ongoing struct {
		Qty   int64
		Value int64
	}

	err = db.Raw(ongoingSQL, teamID, restockStatusPending, warehouseID, warehouseID).Scan(&ongoing).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// MAX over no rows is NULL, not 0 — a team that has never received anything needs a nullable scan
	// target or the driver errors on the conversion.
	const lastRestockSQL = `
		SELECT MAX(b.accepted_at)
		FROM stock_batches b
		JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
		JOIN restock_requests r ON r.id = ri.restock_request_id
		WHERE r.requesting_team_id = ? AND (? = 0 OR b.warehouse_id = ?)`

	var lastRestock sql.NullTime

	err = db.Raw(lastRestockSQL, teamID, warehouseID, warehouseID).Scan(&lastRestock).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	preview := &inventoryv1.OwnerStockPreview{
		ReadyQty:        ready.Qty,
		ReadyValue:      ready.Value,
		OngoingQty:      ongoing.Qty,
		OngoingValueEst: ongoing.Value,
	}

	if lastRestock.Valid {
		preview.LastRestockUnix = lastRestock.Time.Unix()
	}

	return connect.NewResponse(&inventoryv1.OwnerStockStatResponse{Preview: preview}), nil
}
