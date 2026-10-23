package product_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// BundleUpdate replaces a bundle's name, description and EVERY line. A CS may only change a bundle she created
// (mayChangeBundle). A line already in the bundle is kept whatever its product has become since; only a line the save
// ADDS must be a live, shareable product (checkLines).
//
// The bundle row is LOCKED first, so two saves of one bundle run one after the other: each replaces the lines whole,
// and two interleaved replaces would leave a mix of both — or trip the (bundle_id, product_id) uniqueness halfway.
func (s *Service) BundleUpdate(
	ctx context.Context,
	req *connect.Request[productv1.BundleUpdateRequest],
) (*connect.Response[productv1.BundleUpdateResponse], error) {
	name := strings.TrimSpace(req.Msg.GetName())
	if name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a bundle needs a name"))
	}

	var bundle product_service_models.Bundle

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", req.Msg.GetBundleId(), req.Msg.GetTeamId()).
			Take(&bundle).
			Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return bundleNotFound()
		}
		if err != nil {
			return dbError(err)
		}

		err = mayChangeBundle(ctx, &bundle)
		if err != nil {
			return err
		}

		// The old lines go — and RETURN which products they held, which is the "kept" set the line check needs. One
		// statement for both; a refused check rolls the delete back with the rest of the transaction.
		var removed []product_service_models.BundleProduct

		err = tx.
			Clauses(clause.Returning{Columns: []clause.Column{{Name: "product_id"}}}).
			Where("bundle_id = ?", bundle.ID).
			Delete(&removed).
			Error
		if err != nil {
			return dbError(err)
		}

		kept := make(map[uint64]bool, len(removed))
		for _, l := range removed {
			kept[l.ProductID] = true
		}

		err = checkLines(tx, bundle.TeamID, req.Msg.GetLines(), kept)
		if err != nil {
			return err
		}

		bundle.Name = name
		bundle.Description = strings.TrimSpace(req.Msg.GetDescription())
		bundle.UpdatedAt = time.Now()

		err = tx.
			Model(&bundle).
			Updates(map[string]any{"name": bundle.Name, "description": bundle.Description, "updated_at": bundle.UpdatedAt}).
			Error
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

	return connect.NewResponse(&productv1.BundleUpdateResponse{Bundle: bundleRowItem(&bundle)}), nil
}
