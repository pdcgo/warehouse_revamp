package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockAvailability reports what a pick from this warehouse would find for each product.
//
// It reads the SAME rows pickOneLine drains — `stock_levels` for the warehouse, every place summed —
// so the number a person sees before placing an order is the number the order will meet. Anything
// cleverer here (ownership, reservations, a projection) would be a second definition of "available",
// and the first time the two disagreed it would be this screen that looked broken.
//
// ⚠ It is NOT filtered by owning team, exactly as the pick is not. Any team may draw stock from any
// warehouse (owner, 2026-07-20), so filtering the READ while leaving the WRITE open would tell people
// they cannot do something the system would let them do.
func (s *Service) StockAvailability(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAvailabilityRequest],
) (*connect.Response[inventoryv1.StockAvailabilityResponse], error) {
	productIDs := req.Msg.GetProductIds()

	type scan struct {
		ProductID uint64
		Available int64
	}

	var rows []scan

	// Summed over the places, because a line is filled from as many of them as it takes: three on one
	// shelf and two on another is five available, and reporting the largest single place would refuse
	// an order the warehouse can actually fill.
	err := s.db.
		WithContext(ctx).
		Table("stock_levels").
		Select("product_id, COALESCE(SUM(on_hand), 0) AS available").
		Where("warehouse_id = ?", req.Msg.GetWarehouseId()).
		Where("product_id IN ?", productIDs).
		Group("product_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	found := make(map[uint64]int64, len(rows))
	for _, row := range rows {
		found[row.ProductID] = row.Available
	}

	// Every id asked about gets a row, including the ones with nothing. A caller deciding whether it
	// may promise goods must be able to tell "none" from "not answered", and a gap cannot say which.
	items := make([]*inventoryv1.StockAvailabilityItem, 0, len(productIDs))
	for _, id := range productIDs {
		items = append(items, &inventoryv1.StockAvailabilityItem{
			ProductId: id,
			Available: found[id],
		})
	}

	return connect.NewResponse(&inventoryv1.StockAvailabilityResponse{Items: items}), nil
}
