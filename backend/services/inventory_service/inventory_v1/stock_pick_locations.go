package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// pickLocationRow is the query's shape: one product, one rack, the quantity taken from it.
type pickLocationRow struct {
	ProductID uint64
	RackID    uint64
	RackCode  *string
	Quantity  int64
}

// StockPickLocations returns WHERE THIS PICK'S GOODS WERE TAKEN FROM — the pick screen's shelf column
// (#151).
//
// Read from the TAKE, not from the racks now. The order's take wrote, per rack, exactly how much it drew under
// this ref — its key (the-order-take-bridges-its-key-per-order); those rows are what the order holds and they cannot
// drift. Current levels answer
// a different question whose answer keeps changing — another order draws from the same shelf, a
// stock-take shifts goods — and a picker sent by current levels can arrive at a shelf whose stock is
// spoken for.
//
// The take and its rollback are NETTED, per rack, and only a positive remainder is a stop on the walk: the log is
// append-only, so a released take's rows are still there beside their reversal (a-rollback-reverses-its-log-rows).
// A released take nets to zero on every rack and drops out entirely — an empty list is the right answer to "where
// do I go for this" when the answer is "nowhere".
func (s *Service) StockPickLocations(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockPickLocationsRequest],
) (*connect.Response[inventoryv1.StockPickLocationsResponse], error) {
	var rows []pickLocationRow

	err := s.db.
		WithContext(ctx).
		Table("idempotency_order_check AS k").
		Select("l.product_id AS product_id, l.placement_id AS rack_id, r.code AS rack_code, "+
			"SUM(-l.stock_change) AS quantity").
		Joins("JOIN product_placement_logs l ON l.transaction_id = k.transaction_id").
		Joins("JOIN placements r ON r.id = l.placement_id").
		Where("k.idempotency_key = ? AND l.warehouse_id = ?", req.Msg.GetRef(), req.Msg.GetWarehouseId()).
		Group("l.product_id, l.placement_id, r.code").
		Having("SUM(-l.stock_change) > 0").
		Order("l.product_id, r.code").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockPickLocation, 0, len(rows))

	for i := range rows {
		loc := inventoryv1.StockPickLocation{
			ProductId: rows[i].ProductID,
			RackId:    rows[i].RackID,
			Quantity:  rows[i].Quantity,
		}

		if rows[i].RackCode != nil {
			loc.RackCode = *rows[i].RackCode
		}

		out = append(out, &loc)
	}

	return connect.NewResponse(&inventoryv1.StockPickLocationsResponse{Locations: out}), nil
}
