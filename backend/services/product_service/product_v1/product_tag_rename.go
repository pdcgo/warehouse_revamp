package product_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductTagRename renames a product tag — the admins' alone (products-have-their-own-tag-list), a custom or an admin's
// system tag; every product carrying it reads the new name at once. The app's own (`need_reprint_code`) is locked for
// everyone, admins included: FailedPrecondition. ONE NAME, ONE TAG: a name ANOTHER product tag carries, any case, is
// AlreadyExists (the unique index decides, so two renames to one name at the same second cannot both pass); a change of
// case alone is a rename. An unknown tag is NotFound.
func (s *Service) ProductTagRename(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagRenameRequest],
) (*connect.Response[productv1.ProductTagRenameResponse], error) {
	name := cleanProductTagName(req.Msg.GetName())
	if name == "" {
		return nil, productTagErr(errProductTagNameEmpty)
	}

	var tag *product_service_models.ProductTag

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var loadErr error

		tag, loadErr = lockedTagForAdmin(tx, req.Msg.GetTagId())
		if loadErr != nil {
			return loadErr
		}

		tag.Name = name
		tag.UpdatedAt = time.Now()

		updErr := tx.
			Model(tag).
			Updates(map[string]any{"name": tag.Name, "updated_at": tag.UpdatedAt}).
			Error
		if isUniqueViolation(updErr) {
			return errProductTagNameTaken
		}

		return updErr
	})
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagRenameResponse{Tag: productTagToProto(tag)}), nil
}
