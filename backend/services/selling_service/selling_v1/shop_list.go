package selling_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopList returns the scoped team's active shops, newest first, paginated. `q` filters by name or
// shop code; `marketplace` by the shop's marketplace; `primary_user_id` by its primary CS and
// `no_primary` to the shops with none (the-primary-cs-is-a-flag-on-a-grant) — the last two exclude
// each other. `writable` narrows it to the shops the caller may write on — what a picker for a write offers.
func (s *Service) ShopList(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopListRequest],
) (*connect.Response[sellingv1.ShopListResponse], error) {
	page := req.Msg.GetPage()
	filter := req.Msg.GetFilter()

	if filter.GetNoPrimary() && filter.GetPrimaryUserId() > 0 {
		return nil, connect.NewError(
			connect.CodeInvalidArgument,
			errors.New("a shop cannot both have this primary cs and have none — pick one filter"),
		)
	}

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Shop{}).
		Where("team_id = ? AND deleted = ?", req.Msg.GetTeamId(), false)

	if q := strings.TrimSpace(filter.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("name ILIKE ? OR shop_code ILIKE ?", pattern, pattern)
	}

	if marketplace := filter.GetMarketplace(); marketplace != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where("marketplace = ?", san_marketplace.ToText(marketplace))
	}

	// The primary is a flag on a grant, never a column of shops, so both filters ask shop_users — by
	// its one-primary-per-shop partial unique index (shop_users_one_primary_idx).
	if userID := filter.GetPrimaryUserId(); userID > 0 {
		query = query.Where("id IN (SELECT shop_id FROM shop_users WHERE is_primary AND user_id = ?)", userID)
	}

	if filter.GetNoPrimary() {
		query = query.Where("NOT EXISTS (SELECT 1 FROM shop_users su WHERE su.shop_id = shops.id AND su.is_primary)")
	}

	// Only the shops the CALLER may write on — the pickers of the order form and the imports
	// (a-write-needs-a-grant-or-a-manager). The rule is shopAccess's: a manager writes on every shop of the team, so
	// no clause; anyone else on the shops granted to them — probed per team shop on shop_users' (shop_id, user_id)
	// unique index, so the cost follows the team's shops, never every grant of every team.
	if filter.GetWritable() {
		caller := eventActor(ctx)

		team, root, err := s.roles.Roles(ctx, caller, req.Msg.GetTeamId())
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		if !isManager(team, root) {
			query = query.Where("EXISTS (SELECT 1 FROM shop_users su WHERE su.shop_id = shops.id AND su.user_id = ?)", caller)
		}
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var shops []selling_service_models.Shop

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order(shopOrderClause(req.Msg.GetSort())).
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&shops).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	err = loadPrimaries(s.db.WithContext(ctx), shops)
	if err != nil {
		return nil, dbError(err)
	}

	items, ids := shopListItems(shops, req.Msg.GetDataRequest())

	return connect.NewResponse(&sellingv1.ShopListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
