package selling_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// derivedCap is how many maps each direction of ProductDerivedList answers at most: CommonPagination's largest page,
// and the max_items of the three by-ids reads the screen names the rows with (ProductByIds, TeamByIds,
// DiscoverStockByIds) — so one call of each names a whole answer.
const derivedCap = 200

// The two directions of a product's return maps — the column the product is matched on. Turunan dari reads the maps
// that land ON the product (its owner team's); Turunannya reads every team's map FROM it.
const (
	derivedFromWhere = "own_product_id = ?"
	derivedToWhere   = "shared_product_id = ?"
)

// ProductDerivedList answers PRODUK TURUNAN — the return map, read both ways and ACROSS TEAMS
// (produk-turunan-is-the-return-map):
//
//	derived_from   Turunan dari — the maps whose own product is this one: the other teams' products it was mapped
//	               from. Several can land on one own product (the map is unique on its source, not on its own
//	               product — the-map-is-unique-on-its-source), so each comes back as its own row.
//	derived_to     Turunannya — every team's map whose borrowed product is this one: the own product each team maps it
//	               to (at most one per team).
//
// The scoped team only AUTHORIZES — the maps are every team's, as the section draws them on the product's own page and
// on the Discover detail. ProductReturnMapByIds, the order form's read, is NOT this: there the team stays the filter, and
// another team's map is never seen.
//
// Two statements, one per direction, each the newest derivedCap maps with the direction's whole count beside it
// (COUNT(*) OVER (), counted before the LIMIT), so the section's count is never short of a capped list. Names, SKUs,
// pictures and ready stock are the screen's, from the reads it already makes.
func (s *Service) ProductDerivedList(
	ctx context.Context,
	req *connect.Request[sellingv1.ProductDerivedListRequest],
) (*connect.Response[sellingv1.ProductDerivedListResponse], error) {
	productID := req.Msg.GetFilter().GetProductId()

	from, fromTotal, err := s.derivedMaps(ctx, derivedFromWhere, productID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	to, toTotal, err := s.derivedMaps(ctx, derivedToWhere, productID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sellingv1.ProductDerivedListResponse{
		DerivedFrom:      from,
		DerivedTo:        to,
		DerivedFromTotal: fromTotal,
		DerivedToTotal:   toTotal,
	}), nil
}

// derivedMapRow is one map as ProductDerivedList reads it, with its direction's whole count.
type derivedMapRow struct {
	TeamID          uint64
	SharedProductID uint64
	OwnProductID    uint64
	CreatedAt       time.Time
	Total           int64
}

// derivedMaps reads one direction: the maps matching `where` for the product, newest first (created_at, then id —
// every map is written once, so created_at is also when it last changed), at most derivedCap, and how many match in all.
func (s *Service) derivedMaps(ctx context.Context, where string, productID uint64) ([]*sellingv1.ProductReturnMap, int64, error) {
	var rows []derivedMapRow

	err := s.db.
		WithContext(ctx).
		Table("product_return_maps").
		Select("team_id, shared_product_id, own_product_id, created_at, COUNT(*) OVER () AS total").
		Where(where, productID).
		Order("created_at DESC, id DESC").
		Limit(derivedCap).
		Scan(&rows).
		Error
	if err != nil {
		return nil, 0, err
	}

	maps := make([]*sellingv1.ProductReturnMap, 0, len(rows))

	var total int64

	for _, row := range rows {
		total = row.Total

		maps = append(maps, &sellingv1.ProductReturnMap{
			TeamId:          row.TeamID,
			SharedProductId: row.SharedProductID,
			OwnProductId:    row.OwnProductID,
			CreatedAtUnix:   row.CreatedAt.Unix(),
		})
	}

	return maps, total, nil
}
