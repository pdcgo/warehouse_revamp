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
// Ownership is read exactly as in OwnerStockByIds — `batches.team_id` (a-batch-carries-its-owner) — so this can
// never total another team's goods.
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
		SELECT COALESCE(SUM(b.stock_count), 0) AS qty,
		       ROUND(COALESCE(SUM(b.stock_valuation), 0))::bigint AS value
		FROM batches b
		WHERE b.team_id = ? AND b.stock_count > 0 AND (? = 0 OR b.warehouse_id = ?)`

	var ready struct {
		Qty   int64
		Value int64
	}

	err := db.Raw(readySQL, teamID, warehouseID, warehouseID).Scan(&ready).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	const ongoingSQL = `
		SELECT COALESCE(SUM(ri.count), 0) AS qty,
		       ROUND(COALESCE(SUM(ri.total), 0))::bigint AS value
		FROM restock_items ri
		JOIN restocks r ON r.id = ri.restock_id
		WHERE r.team_id = ? AND r.status IN ? AND (? = 0 OR r.warehouse_id = ?)`

	var ongoing struct {
		Qty   int64
		Value int64
	}

	err = db.Raw(ongoingSQL, teamID, restockInboundStatuses, warehouseID, warehouseID).Scan(&ongoing).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// MAX over no rows is NULL, not 0 — a team that has never received anything needs a nullable scan
	// target or the driver errors on the conversion.
	const lastRestockSQL = `
		SELECT MAX(b.created_at)
		FROM batches b
		JOIN inventory_transactions t ON t.id = b.transaction_id
		WHERE b.team_id = ? AND t.tx_type = 'restock' AND (? = 0 OR b.warehouse_id = ?)`

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
