package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// StockNarrower answers the product list's filters that hang on STOCK — facts inventory_service owns, which this service
// must not join to (HARD RULE 3). The composition root answers it in-process over inventory's own tables
// (cmd/app_development/product_stock_narrower.go). The list keeps ONE count and ONE page statement of its own and only
// adds `id = ANY(<the ids it got back>)` before them, so the total, the sort and the paging stay exact
// (the-range-pills-are-a-fixed-set narrows the supplier list the same way).
type StockNarrower interface {
	// ClosedByMinimum returns, of the candidates, the ids whose owner's ready stock across EVERY warehouse is UNDER the
	// candidate's minimum (a-minimum-closes-only-under-it) — one with no stock at all among them.
	ClosedByMinimum(ctx context.Context, candidates []MinimumCandidate) ([]uint64, error)
	// AgedAtLeast returns the team's product ids whose oldest batch still holding ready units arrived at least `days`
	// whole days ago — in one warehouse, or every warehouse when warehouseID is 0 (the-dates-read-as-ages). A product
	// with nothing on a shelf has no age and never comes back.
	AgedAtLeast(ctx context.Context, teamID, warehouseID uint64, days uint32) ([]uint64, error)
	// ShelvedProducts returns every product holding READY units in the ask's warehouse (every warehouse when 0), its ready
	// units inside the ask's range and its cost spread passing the ask's cut, each with its owner and that spread — any
	// team's (discovers-warehouse-keeps-ready-stock-there, discover-ranges-are-picked). Discover's Gudang, Stok siap and
	// Harga cross. The spread stays in-process: it is priced here with the product's markup and never sent.
	ShelvedProducts(ctx context.Context, ask ShelfAsk) ([]ShelvedProduct, error)
	// ProductsReadyAbove returns every product whose ready units across EVERY warehouse are above `ceiling` (owner and id
	// only) — the set a Stok siap range from 0 drops, asked as the complement because that range keeps products with no
	// stock row at all.
	ProductsReadyAbove(ctx context.Context, ceiling int64) ([]ShelvedProduct, error)
}

// ShelfAsk is one ask of the shelves — see inventory_v1.ShelfAsk, which it is handed to unchanged: the warehouse (0 =
// every one), the ready range (nil = no edge on that side) and the cost cut a cross band allows (nil = no cut).
type ShelfAsk struct {
	WarehouseID uint64
	ReadyMin    *int64
	ReadyMax    *int64
	CostAtMost  *float64
	CostAtLeast *float64
}

// ShelvedProduct is one product the shelves hold: its owner, its id, and the spread of its ready batches' unit costs.
type ShelvedProduct struct {
	TeamID    uint64
	ProductID uint64
	CostMin   float64
	CostMax   float64
}

// MinimumCandidate is a product whose lock is a minimum: its owner, its id and the minimum (reserved_stock).
type MinimumCandidate struct {
	TeamID    uint64
	ProductID uint64
	Minimum   uint32
}

var (
	errNoStockNarrower = errors.New("the stock behind this filter cannot be read — try again without the lock-now or stock-age filter")
	errNoShelfReader   = errors.New("the stock behind this filter cannot be read — try again without the warehouse, ready stock or cross price filter")
	// Discover's own lock filter (Terbuka = orderable now, Terkunci = closed now) is a different set than the list's
	// setting (discover-filters-by-lock), so each RPC refuses the other's values; the age is not one of Discover's filters.
	errListOnlyFilter     = errors.New("the lock's ways, the lock-now and the stock-age filters narrow a team's own product list only")
	errDiscoverOnlyFilter = errors.New("the closed and orderable lock filters narrow Discover only")
)

// The three ways of the lock as predicates on the two fields (one-lock-three-ways). Always wins: a locked product with a
// minimum is locked.
const (
	lockModeOpen    = "cross_locked = FALSE AND reserved_stock = 0"
	lockModeMinimum = "cross_locked = FALSE AND reserved_stock > 0"
	lockModeAlways  = "cross_locked = TRUE"
)

// narrowByLock keeps the products of one lock way, or — LOCKED_NOW — the minimums in force now. The three ways are this
// service's own columns; "in force" also needs the owner's ready stock, so the candidates (the scope's products whose
// way is the minimum, each with its minimum) go to inventory, and only the ids it says are under their minimum stay.
// `scope` builds a FRESH copy of the list's own narrowing (team, archive, search) for the candidate read.
func (s *Service) narrowByLock(
	ctx context.Context,
	query *gorm.DB,
	scope func() *gorm.DB,
	lock productv1.ProductLockFilter,
) (*gorm.DB, error) {
	switch lock {
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_UNSPECIFIED:
		return query, nil
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN:
		return query.Where(lockModeOpen), nil
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM:
		return query.Where(lockModeMinimum), nil
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_ALWAYS:
		return query.Where(lockModeAlways), nil
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW:
		// handled below
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED, productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE:
		return nil, connect.NewError(connect.CodeInvalidArgument, errDiscoverOnlyFilter)
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("unknown lock filter"))
	}

	closed, err := s.closedByMinimum(ctx, scope)
	if err != nil {
		return nil, err
	}

	if len(closed) == 0 {
		return query.Where("FALSE"), nil
	}

	// The way is checked again in the page's own statement: a minimum cleared between the two reads is not "locked now".
	return query.
		Where(lockModeMinimum).
		Where("id = ANY(CAST(? AS bigint[]))", idArray(closed)), nil
}

// narrowByOrderable is Discover's Kunci (discover-filters-by-lock): CLOSED keeps what another team cannot take now — a
// product its owner locked, or one whose minimum is in force (a-minimum-closes-only-under-it) — and ORDERABLE every
// other. The lock is this service's column; whether a minimum is in force is asked of inventory for the scope's
// minimum products of EVERY team at once (one ClosedByMinimum call, never one per team or product). `scope` builds a
// FRESH copy of Discover's own narrowing for the candidate read.
func (s *Service) narrowByOrderable(
	ctx context.Context,
	query *gorm.DB,
	scope func() *gorm.DB,
	lock productv1.ProductLockFilter,
) (*gorm.DB, error) {
	switch lock {
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_UNSPECIFIED:
		return query, nil
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED, productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE:
		// handled below
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN,
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM,
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_ALWAYS,
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW:
		return nil, connect.NewError(connect.CodeInvalidArgument, errListOnlyFilter)
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("unknown lock filter"))
	}

	closed, err := s.closedByMinimum(ctx, scope)
	if err != nil {
		return nil, err
	}

	closing := lock == productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED

	// No minimum in force: closed is the owner-locked alone, orderable every product not locked.
	if len(closed) == 0 {
		if closing {
			return query.Where(lockModeAlways), nil
		}

		return query.Where("cross_locked = FALSE"), nil
	}

	// The way is read again in the page's own statement, so a product whose lock changed between the two reads lands by
	// its lock now; only "is its minimum in force" comes from the candidate read. One group, so the OR never escapes into
	// the scope's other conditions.
	ids := idArray(closed)

	if closing {
		return query.Where("(("+lockModeAlways+") OR ("+lockModeMinimum+" AND id = ANY(CAST(? AS bigint[]))))", ids), nil
	}

	return query.Where("cross_locked = FALSE AND (reserved_stock = 0 OR id <> ALL(CAST(? AS bigint[])))", ids), nil
}

// closedByMinimum reads the scope's products whose lock is a minimum — any team's, each with its owner and minimum —
// and asks inventory which of them that minimum closes now. No candidate asks nothing.
func (s *Service) closedByMinimum(ctx context.Context, scope func() *gorm.DB) ([]uint64, error) {
	if s.stock == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errNoStockNarrower)
	}

	var rows []struct {
		ID            uint64
		TeamID        uint64
		ReservedStock uint32
	}

	err := scope().
		Where(lockModeMinimum).
		Select("id, team_id, reserved_stock").
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if len(rows) == 0 {
		return nil, nil
	}

	candidates := make([]MinimumCandidate, 0, len(rows))
	for _, r := range rows {
		candidates = append(candidates, MinimumCandidate{TeamID: r.TeamID, ProductID: r.ID, Minimum: r.ReservedStock})
	}

	closed, err := s.stock.ClosedByMinimum(ctx, candidates)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return closed, nil
}

// narrowByStockAge keeps the products whose stock is at least `days` whole days old, read in the lens's warehouse
// (0 = every one). 0 days is no narrowing.
func (s *Service) narrowByStockAge(
	ctx context.Context,
	query *gorm.DB,
	teamID, warehouseID uint64,
	days uint32,
) (*gorm.DB, error) {
	if days == 0 {
		return query, nil
	}

	if s.stock == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errNoStockNarrower)
	}

	aged, err := s.stock.AgedAtLeast(ctx, teamID, warehouseID, days)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if len(aged) == 0 {
		return query.Where("FALSE"), nil
	}

	return query.Where("id = ANY(CAST(? AS bigint[]))", idArray(aged)), nil
}

// narrowedByStock reports whether a stock filter of the shared filter is picked — whether the list's statement may carry
// an id list. Discover's own shelf filters add theirs (shelfPicked).
func narrowedByStock(filter *productv1.ProductListFilter) bool {
	switch filter.GetLock() {
	case productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW,
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED,
		productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE:
		return true
	}

	return filter.GetStockAgeMinDays() > 0
}

// pageWithCount reads one page AND the count of every match in ONE statement — COUNT(*) OVER (), taken before the
// LIMIT — so the id list a stock filter bound travels to Postgres once, not once for the count and again for the page
// (the-list-is-sent-once, as SearchAmong does). Only a page past the last match carries no row to read the count from,
// and counts on its own.
func pageWithCount(query *gorm.DB, order string, offset, limit int) ([]product_service_models.Product, int64, error) {
	var found []searchAmongRow

	err := query.
		Session(&gorm.Session{}).
		Select("products.*, COUNT(*) OVER () AS total_matches").
		Order(order).
		Offset(offset).
		Limit(limit).
		Scan(&found).
		Error
	if err != nil {
		return nil, 0, err
	}

	var total int64

	switch {
	case len(found) > 0:
		total = found[0].TotalMatches
	case offset > 0:
		err = query.
			Count(&total).
			Error
		if err != nil {
			return nil, 0, err
		}
	}

	products := make([]product_service_models.Product, 0, len(found))
	for i := range found {
		products = append(products, found[i].Product)
	}

	return products, total, nil
}
