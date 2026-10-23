package product_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// BundleList returns a page of the scoped team's bundles, each with its lines — the Bundles page, and the order form's
// bundle search. `q` matches the bundle's name AND a line's product name or code: "which bundle has the Kopi in it?" is
// asked as often as its name, and a name may repeat (bundle-names-may-repeat). The last change first unless a sort is
// sent.
func (s *Service) BundleList(
	ctx context.Context,
	req *connect.Request[productv1.BundleListRequest],
) (*connect.Response[productv1.BundleListResponse], error) {
	page := req.Msg.GetPage()
	db := s.db.WithContext(ctx)

	query := db.
		Model(&product_service_models.Bundle{}).
		Where("team_id = ?", req.Msg.GetTeamId())

	if q := strings.TrimSpace(req.Msg.GetFilter().GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		// An IN over a subquery, not a join: a join multiplies a bundle by its matching lines and the page count with it.
		//
		// ⚠ The subquery is SCOPED TO THE TEAM's own bundles first. Written as a correlated EXISTS, Postgres hoisted it
		// into one hashed subplan over EVERY team's bundle_products ⋈ products — a cost that grows with the whole
		// system, not with the team searching (audit, 2026-10-22). Starting from this team's bundles, it reads only
		// their lines and looks each product up by its key.
		query = query.Where(
			"(bundles.name ILIKE ? OR bundles.id IN ("+
				"SELECT bp.bundle_id FROM bundles own "+
				"JOIN bundle_products bp ON bp.bundle_id = own.id "+
				"JOIN products p ON p.id = bp.product_id "+
				"WHERE own.team_id = ? AND (p.name ILIKE ? OR p.sku ILIKE ?)))",
			pattern, req.Msg.GetTeamId(), pattern, pattern,
		)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var bundles []product_service_models.Bundle

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order(bundleOrderClause(req.Msg.GetSort())).
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&bundles).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	err = withLines(db, bundles)
	if err != nil {
		return nil, dbError(err)
	}

	items, ids := bundleListItems(bundles, req.Msg.GetDataRequest())

	return connect.NewResponse(&productv1.BundleListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
