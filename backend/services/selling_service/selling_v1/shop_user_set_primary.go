package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// errNotGranted is Make primary on someone without a grant: a primary is never someone who cannot
// work on the shop (the-primary-cs-is-a-flag-on-a-grant).
var errNotGranted = errors.New("this user has no access to the shop — grant it first")

// ShopUserSetPrimary moves the shop's primary CS to another of its granted users — Make primary.
//
// Idempotent: making the primary primary again changes nothing.
func (s *Service) ShopUserSetPrimary(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopUserSetPrimaryRequest],
) (*connect.Response[sellingv1.ShopUserSetPrimaryResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()
	userID := req.Msg.GetUserId()

	var shop selling_service_models.Shop

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The shop's row, FOR UPDATE: two Make primary clicks on one shop run one after the other,
		// never both clearing the old flag and both setting a new one.
		exists, err := lockShop(tx, teamID, shopID)
		if err != nil {
			return err
		}

		if !exists {
			return errShopMissing
		}

		var grant selling_service_models.ShopUser

		err = tx.
			Where("shop_id = ? AND user_id = ?", shopID, userID).
			Limit(1).
			Find(&grant).
			Error
		if err != nil {
			return err
		}

		if grant.ID == 0 {
			return errNotGranted
		}

		// CLEAR, THEN SET — two statements, in that order. The partial unique index is checked row by
		// row, so one UPDATE flipping both could meet the new flag before the old one is gone.
		err = tx.
			Model(&selling_service_models.ShopUser{}).
			Where("shop_id = ? AND is_primary AND user_id <> ?", shopID, userID).
			Update("is_primary", false).
			Error
		if err != nil {
			return err
		}

		err = tx.
			Model(&selling_service_models.ShopUser{}).
			Where("id = ?", grant.ID).
			Update("is_primary", true).
			Error
		if err != nil {
			return err
		}

		err = tx.Where("id = ?", shopID).First(&shop).Error
		if err != nil {
			return err
		}

		shop.PrimaryUserID = userID

		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errShopMissing):
			return nil, notFound()
		case errors.Is(err, errNotGranted):
			return nil, connect.NewError(connect.CodeFailedPrecondition, errNotGranted)
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopUserSetPrimaryResponse{Shop: toProto(&shop)}), nil
}
