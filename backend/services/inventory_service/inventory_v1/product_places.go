package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// productPlaceRow is the query's shape.
type productPlaceRow struct {
	ProductID uint64
	RackID    *uint64
	RackCode  *string
	OnHand    int64
}

// ProductPlaces returns WHICH SHELVES ALREADY HOLD each product, and how many sit there (#156).
//
// This is the put-away recommendation: somebody shelving a delivery should add to the shelf the
// product already lives on, rather than starting a second pile of the same thing in another aisle.
// Two piles of one product is how a warehouse ends up walking past stock it already has.
//
// It reads CURRENT LEVELS, and that is the right source here — unlike StockPickLocations (#151), which
// reads the ledger because a pick is a commitment already made. "Where does this live now" is a
// question about the present, and the present is exactly what the rack rows hold.
//
// Empty racks are excluded (stock_count > 0). A shelf that USED to hold the product is not a
// recommendation — it is a shelf with nothing on it, and suggesting it would send someone to an empty
// space wondering what they were meant to find.
func (s *Service) ProductPlaces(
	ctx context.Context,
	req *connect.Request[inventoryv1.ProductPlacesRequest],
) (*connect.Response[inventoryv1.ProductPlacesResponse], error) {
	var rows []productPlaceRow

	err := s.db.
		WithContext(ctx).
		Table("product_placements AS pp").
		Select("pp.product_id AS product_id, pp.placement_id AS rack_id, r.code AS rack_code, pp.stock_count AS on_hand").
		Joins("JOIN placements r ON r.id = pp.placement_id").
		Where("pp.warehouse_id = ? AND pp.product_id IN ? AND pp.stock_count > 0",
			req.Msg.GetWarehouseId(), req.Msg.GetFilter().GetIds()).
		// Racks by label — the same order the pick walk uses (#151), so a place reads the same wherever it is shown.
		Order("pp.product_id, r.code").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.ProductPlace, 0, len(rows))

	for i := range rows {
		place := inventoryv1.ProductPlace{
			ProductId: rows[i].ProductID,
			OnHand:    rows[i].OnHand,
		}

		if rows[i].RackID != nil {
			place.RackId = *rows[i].RackID
		}

		if rows[i].RackCode != nil {
			place.RackCode = *rows[i].RackCode
		}

		out = append(out, &place)
	}

	return connect.NewResponse(&inventoryv1.ProductPlacesResponse{
		Items: productPlacesMap(out, req.Msg.GetDataRequest()),
	}), nil
}
