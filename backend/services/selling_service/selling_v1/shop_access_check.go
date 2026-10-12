package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopAccessCheck answers, in one call, the shop, its primary CS, and whether a user may WRITE on it
// (one-call-answers-the-shop-and-the-access).
//
// The settlement importer asks it before storing a file (the-shop-is-checked-before-the-file-is-stored),
// and settlement asks it for an imported shop row's primary CS (settlement-asks-the-shop-for-its-primary-cs).
//
// ⚠ A DELETED SHOP IS NOT FOUND, like every other read here — so a shop's statements cannot be imported
// once it is deleted. Whether a closed shop may still be paid is shop Q3.
func (s *Service) ShopAccessCheck(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopAccessCheckRequest],
) (*connect.Response[sellingv1.ShopAccessCheckResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()
	userID := req.Msg.GetUserId()

	db := s.db.WithContext(ctx)

	var shop selling_service_models.Shop

	err := db.
		Where("id = ? AND team_id = ? AND deleted = ?", shopID, teamID, false).
		First(&shop).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	// The primary and the user's own grant, in one read — at most two rows.
	var grants []selling_service_models.ShopUser

	err = db.
		Where("shop_id = ? AND (is_primary OR user_id = ?)", shopID, userID).
		Find(&grants).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	granted := false

	for _, grant := range grants {
		if grant.IsPrimary {
			shop.PrimaryUserID = grant.UserID
		}

		if grant.UserID == userID {
			granted = true
		}
	}

	// A grant answers it without asking anyone. Only without one does a manager role matter — and the
	// roles are user_service's, read through its cached resolver.
	access := granted
	if !access {
		team, root, err := s.roles.Roles(ctx, userID, teamID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		access = isManager(team, root)
	}

	return connect.NewResponse(&sellingv1.ShopAccessCheckResponse{
		Shop:          toProto(&shop),
		PrimaryUserId: shop.PrimaryUserID,
		IsHaveAccess:  access,
	}), nil
}
