package product_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductDiscover lists active, UNLOCKED products across ALL teams (cross-team discovery, #106),
// newest first, paginated, searchable by name/product code. Unlike ProductList it does NOT filter by team —
// the request's team_id only authorizes the caller (use_scope). Each returned Product still carries
// its owning team_id.
//
// A LOCKED product is absent by default, and that is where the lock bites: a picker is how another team builds an
// order, so a product its owner has kept back must not be offered in the first place. The Discover PAGE asks for it
// with `include_locked` (a-locked-product-shows-on-discover) — shown with its lock, still not orderable. The owner's own
// ProductList shows it either way — locking is about other teams, not about hiding it from yourself.
//
// Discover's KUNCI (discover-filters-by-lock): filter.lock CLOSED keeps what another team cannot take now — locked by
// its owner, or a minimum in force — and ORDERABLE every other. Whether a minimum is in force hangs on the owner's ready
// stock, inventory's, asked through the StockNarrower seam for every team's candidates at once BEFORE the count and the
// page (stock_narrower.go), so `total_items`, the sort and the paging describe the narrowed list.
//
// Discover's GUDANG, STOK SIAP and HARGA CROSS narrow the same way, through the same seam: one ask of the shelves for
// every team's products, the cross price tested here with the product's own markup (discover_narrowing.go). KATEGORI is
// a branch with everything below it, the subtree read once through the CategoryTree seam and bound on this table's own
// category column.
func (s *Service) ProductDiscover(
	ctx context.Context,
	req *connect.Request[productv1.ProductDiscoverRequest],
) (*connect.Response[productv1.ProductDiscoverResponse], error) {
	page := req.Msg.GetPage()
	filter := req.Msg.GetFilter()

	// The filter is shared with ProductList, whose stock-age narrowing is not one of Discover's filters. Refused rather
	// than ignored, so no caller reads an unnarrowed page as a narrowed one. The list's lock values are refused by
	// narrowByOrderable.
	if filter.GetStockAgeMinDays() > 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errListOnlyFilter)
	}

	// The picked category's whole subtree, read once — every copy of the scope binds the same list.
	categoryID := req.Msg.GetCategoryId()

	categories, err := s.categoriesUnder(ctx, categoryID)
	if err != nil {
		return nil, err
	}

	// Discover's own narrowing, built fresh on each call: the lock filter reads its candidates through a copy of it.
	scope := func() *gorm.DB {
		query := s.db.
			WithContext(ctx).
			Model(&product_service_models.Product{}).
			Where("archived = ?", false)

		if !req.Msg.GetIncludeLocked() {
			query = query.Where("cross_locked = ?", false)
		}

		// "Somebody else's catalogue", for a caller showing own and other-team products as separate tabs.
		// Applied HERE rather than in the client because the result is paginated: filtering after the page
		// is loaded narrows what is shown while the count keeps describing the unfiltered set.
		if req.Msg.GetExcludeOwnTeam() {
			query = query.Where("team_id <> ?", req.Msg.GetTeamId())
		}

		// One team's catalogue, when the caller already knows whose product it wants. Same reasoning as
		// above: after the page is loaded is too late for a filter that the pager's count must also see.
		if owner := req.Msg.GetOwnerTeamId(); owner != 0 {
			query = query.Where("team_id = ?", owner)
		}

		// ── The PRIORITY partition ────────────────────────────────────────────────────────────────────
		//
		// Two complementary narrowings over the OWNING team, backing the picker's *Priority Product* and
		// *Other Product* tabs. Priority is a flag on the TEAM (warehouse.team.v1.Team.priority_product),
		// which this service does not own and must not join to (HARD RULE 3) — so the caller resolves the
		// priority team ids against team_service and hands them here as a plain list. This service filters
		// by ids and never learns what the list means.
		//
		// ⚠ EMPTY MEANS NO NARROWING on both, exactly as `owner_team_id = 0` does. A caller whose priority
		// set is genuinely empty must render nothing itself — sending an empty list here returns the whole
		// catalogue, which on a Priority tab would read as "everything is priority".
		if ids := req.Msg.GetOwnerTeamIds(); len(ids) > 0 {
			query = query.Where("team_id IN ?", ids)
		}

		if ids := req.Msg.GetExcludeOwnerTeamIds(); len(ids) > 0 {
			query = query.Where("team_id NOT IN ?", ids)
		}

		if q := strings.TrimSpace(filter.GetQ()); q != "" {
			pattern := "%" + escapeLike(q) + "%"
			query = query.Where("name ILIKE ? OR product_code ILIKE ?", pattern, pattern)
		}

		// KATEGORI — under the picked node or any node below it (a-picked-branch-keeps-its-whole-subtree). This table's
		// own column; an id that is no category keeps nothing.
		if categoryID > 0 {
			if len(categories) == 0 {
				query = query.Where("FALSE")
			} else {
				query = query.Where("category_id = ANY(CAST(? AS bigint[]))", idArray(categories))
			}
		}

		return query
	}

	query, err := s.narrowByOrderable(ctx, scope(), scope, filter.GetLock())
	if err != nil {
		return nil, err
	}

	query, err = s.narrowByShelf(ctx, query, scope, req.Msg)
	if err != nil {
		return nil, err
	}

	var (
		products []product_service_models.Product
		total    int64
	)

	offset := int((page.GetPage() - 1) * page.GetLimit())
	order := productOrderClause(req.Msg.GetSort())

	if narrowedByStock(filter) || shelfPicked(req.Msg) {
		// An id list may be bound: it travels once, the page and the count in one statement (stock_narrower.go).
		products, total, err = pageWithCount(query, order, offset, int(page.GetLimit()))
		if err != nil {
			return nil, dbError(err)
		}
	} else {
		err = query.Count(&total).Error
		if err != nil {
			return nil, dbError(err)
		}

		err = query.
			Order(order).
			Offset(offset).
			Limit(int(page.GetLimit())).
			Find(&products).
			Error
		if err != nil {
			return nil, dbError(err)
		}
	}

	items, ids := productListItems(products, req.Msg.GetDataRequest())

	return connect.NewResponse(&productv1.ProductDiscoverResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
