package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockAvailability reports what a pick from this warehouse would find for each product.
//
// It reads the SAME rows the order take counts — the product's batches in the warehouse, every batch summed — so
// the number a person sees before placing an order is the number the order will meet. A product has one owner, so
// these are its owner's batches whoever asks; the take's other refusals (a locked product, the reserve) are its own and
// are not repeated here.
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
		Table("batches").
		Select("product_id, COALESCE(SUM(stock_count), 0) AS available").
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
