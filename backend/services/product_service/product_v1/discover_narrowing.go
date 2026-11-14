package product_v1

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// CategoryTree answers Discover's Kategori filter: a category and every category below it
// (a-picked-branch-keeps-its-whole-subtree). The tree is category_service's, which this service must not join to (HARD
// RULE 3); the composition root answers it in-process (cmd/app_development/product_categories.go). An id that is no
// category answers nothing.
type CategoryTree interface {
	SubtreeIDs(ctx context.Context, categoryID uint64) ([]uint64, error)
}

var errNoCategoryTree = errors.New("the category tree cannot be read — try again without the category filter")

// categoriesUnder reads the picked category's subtree once per request — nil when no category is picked. scope() then
// binds it as a small id list on products_category_idx.
func (s *Service) categoriesUnder(ctx context.Context, categoryID uint64) ([]uint64, error) {
	if categoryID == 0 {
		return nil, nil
	}

	if s.categories == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errNoCategoryTree)
	}

	ids, err := s.categories.SubtreeIDs(ctx, categoryID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return ids, nil
}

// shelfPicked reports whether Discover's Gudang, Stok siap or Harga cross is picked — whether the statement may carry the
// shelves' id list. A Stok siap range from 0 with no top narrows nothing, but still counts here: the single statement is
// only a way of binding the list once.
func shelfPicked(req *productv1.ProductDiscoverRequest) bool {
	return req.GetWarehouseId() > 0 || req.GetReady() != nil || req.GetCrossPrice() != nil
}

// narrowByShelf is Discover's Gudang, Stok siap and Harga cross (discovers-warehouse-keeps-ready-stock-there,
// discover-ranges-are-picked, a-cross-band-keeps-a-range-that-touches-it). The ready units and the costs are inventory's,
// so the shelves are asked ONCE, for every team's products, and the list keeps only what they answer — still ONE count
// and ONE page statement of its own, so the total, the sort and the paging describe the narrowed list:
//
//	Gudang          products with ready units in that warehouse now; the other two then read that warehouse
//	Stok siap       ready units in [min, max], both ends included, no max = open-ended
//	Harga cross     the cross price range overlaps [min, max]: cross_min <= max AND cross_max >= min
//
// A range from 0 keeps a product with NO stock row (it has 0 ready), which no read of the batches can list — so with no
// warehouse and no cross band it asks the opposite set (ready above max) and drops that (the-range-pills-are-a-fixed-set).
// With a warehouse or a cross band picked, a product must hold ready units anyway, and the one positive ask answers all.
//
// THE CROSS TEST IS THIS SERVICE'S: inventory hands back each product's cost spread, pre-cut by the band; the markup is
// this service's column, so the exact test — cost + cost × bps ÷ 10 000 at both ends, the take's and
// DiscoverStockByIds' own formula in the same order of operations — runs in the page's own statement. The costs travel
// in-process only; nothing of them is in the response.
func (s *Service) narrowByShelf(
	ctx context.Context,
	query *gorm.DB,
	scope func() *gorm.DB,
	req *productv1.ProductDiscoverRequest,
) (*gorm.DB, error) {
	if !shelfPicked(req) {
		return query, nil
	}

	warehouseID := req.GetWarehouseId()
	ready := req.GetReady()
	cross := req.GetCrossPrice()

	// From 0 with no top: every product has at least 0 ready — nothing to narrow by stock alone.
	readyBounded := ready != nil && (ready.GetMin() > 0 || ready.Max != nil)

	if warehouseID == 0 && cross == nil && !readyBounded {
		return query, nil
	}

	if s.stock == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errNoShelfReader)
	}

	// A range from 0, alone: drop whatever holds MORE than its top; keep the rest, the never-stocked included.
	if warehouseID == 0 && cross == nil && ready.GetMin() == 0 {
		above, err := s.stock.ProductsReadyAbove(ctx, ready.GetMax())
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		if len(above) == 0 {
			return query, nil
		}

		teams, ids := shelfPairs(above)

		return query.Where(`NOT EXISTS (
    SELECT 1 FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS above(team_id, product_id)
    WHERE above.product_id = products.id AND above.team_id = products.team_id)`, teams, ids), nil
	}

	ask := ShelfAsk{WarehouseID: warehouseID}

	if ready != nil {
		if ready.GetMin() > 0 {
			readyMin := ready.GetMin()
			ask.ReadyMin = &readyMin
		}

		if ready.Max != nil {
			readyMax := ready.GetMax()
			ask.ReadyMax = &readyMax
		}
	}

	if cross != nil {
		err := s.cutCosts(&ask, scope, cross)
		if err != nil {
			return nil, err
		}
	}

	shelved, err := s.stock.ShelvedProducts(ctx, ask)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if len(shelved) == 0 {
		return query.Where("FALSE"), nil
	}

	teams, ids := shelfPairs(shelved)

	if cross == nil {
		return query.Where(`EXISTS (
    SELECT 1 FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS shelf(team_id, product_id)
    WHERE shelf.product_id = products.id AND shelf.team_id = products.team_id)`, teams, ids), nil
	}

	mins, maxes := shelfCosts(shelved)
	args := []any{teams, ids, mins, maxes, cross.GetMin()}

	// cross_max >= the band's min always; cross_min <= the band's max only when it has one (the top band is open).
	test := `shelf.cost_max + shelf.cost_max * CAST(products.cross_markup_bps AS double precision) / CAST(10000 AS double precision) >= ?`
	if cross.Max != nil {
		test += `
      AND shelf.cost_min + shelf.cost_min * CAST(products.cross_markup_bps AS double precision) / CAST(10000 AS double precision) <= ?`

		args = append(args, cross.GetMax())
	}

	return query.Where(`EXISTS (
    SELECT 1
    FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[]), CAST(? AS double precision[]), CAST(? AS double precision[]))
        AS shelf(team_id, product_id, cost_min, cost_max)
    WHERE shelf.product_id = products.id AND shelf.team_id = products.team_id
      AND `+test+`)`, args...), nil
}

// crossCutSlack widens the cost cut by a billionth, so the float rounding of a division never drops a product the
// exact test keeps — the cut only keeps the answer small; the test decides.
const crossCutSlack = 1e-9

// cutCosts turns a cross band into the cost cut inventory applies before answering. The cross price is never below the
// cost (the markup is never negative), so a cheapest cost above the band's max never prices inside it: MIN(cost) <= max.
// At the other end the dearest cost must reach the band's min even with the LARGEST markup among the products in the
// scope — read here, from this service's own column — so MAX(cost) >= min ÷ (1 + that markup).
func (s *Service) cutCosts(ask *ShelfAsk, scope func() *gorm.DB, cross *productv1.DiscoverPriceRange) error {
	if cross.Max != nil {
		atMost := cross.GetMax() * (1 + crossCutSlack)
		ask.CostAtMost = &atMost
	}

	if cross.GetMin() <= 0 {
		return nil
	}

	var maxBps int64

	err := scope().
		Select("COALESCE(MAX(cross_markup_bps), 0)").
		Scan(&maxBps).
		Error
	if err != nil {
		return dbError(err)
	}

	atLeast := cross.GetMin() / (1 + float64(maxBps)/10000) * (1 - crossCutSlack)
	ask.CostAtLeast = &atLeast

	return nil
}

// shelfPairs splits the shelves' answer into its owners and ids, as two Postgres array literals (bound once each).
func shelfPairs(rows []ShelvedProduct) (string, string) {
	teams := make([]uint64, 0, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, r := range rows {
		teams = append(teams, r.TeamID)
		ids = append(ids, r.ProductID)
	}

	return idArray(teams), idArray(ids)
}

// shelfCosts is the answer's cost spreads as two float8 array literals — each value in its shortest exact form, so
// Postgres reads back the very double inventory summed.
func shelfCosts(rows []ShelvedProduct) (string, string) {
	mins := make([]string, 0, len(rows))
	maxes := make([]string, 0, len(rows))

	for _, r := range rows {
		mins = append(mins, strconv.FormatFloat(r.CostMin, 'g', -1, 64))
		maxes = append(maxes, strconv.FormatFloat(r.CostMax, 'g', -1, 64))
	}

	return "{" + strings.Join(mins, ",") + "}", "{" + strings.Join(maxes, ",") + "}"
}
