package product_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// BundleCreate makes a bundle in the scoped team — every selling role may, the CS included, so a package listing can
// become a bundle while a draft is being mapped (the-creator-or-an-admin-edits-a-bundle). The caller is recorded as its
// creator. The bundle and its lines are one transaction; every line is checked first (checkLines).
func (s *Service) BundleCreate(
	ctx context.Context,
	req *connect.Request[productv1.BundleCreateRequest],
) (*connect.Response[productv1.BundleCreateResponse], error) {
	creator, err := callerID(ctx)
	if err != nil {
		return nil, err
	}

	name := strings.TrimSpace(req.Msg.GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a bundle needs a name"))
	}

	bundle := product_service_models.Bundle{
		TeamID:          req.Msg.GetTeamId(),
		Name:            name,
		Description:     strings.TrimSpace(req.Msg.GetDescription()),
		CreatedByUserID: creator,
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := checkLines(tx, bundle.TeamID, req.Msg.GetLines(), nil)
		if err != nil {
			return err
		}

		err = tx.Create(&bundle).Error
		if err != nil {
			return dbError(err)
		}

		lines := modelLines(bundle.ID, req.Msg.GetLines())

		err = tx.Create(&lines).Error
		if err != nil {
			return dbError(err)
		}

		bundle.Lines = lines

		return nil
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&productv1.BundleCreateResponse{Bundle: bundleRowItem(&bundle)}), nil
}
