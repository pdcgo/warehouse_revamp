package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockTagRename renames a tag — the admins' alone (the 🔄 line under
// custom-tags-are-shared-system-tags-are-the-admins-and-the-apps), a custom or an admin's system tag; every restock
// carrying it reads the new name at once. ONE NAME, ONE TAG: a name ANOTHER tag carries, any case, is AlreadyExists (the
// unique index decides, so two renames to one name at the same second cannot both pass); a change of case alone is a
// rename. The app's own tags are FailedPrecondition; an unknown tag NotFound.
func (s *Service) RestockTagRename(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockTagRenameRequest],
) (*connect.Response[inventoryv1.RestockTagRenameResponse], error) {
	name := cleanTagName(req.Msg.GetName())
	if name == "" {
		return nil, tagErr(errTagNameEmpty)
	}

	var tag inventory_service_models.Tag

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", req.Msg.GetTagId()).
			Take(&tag).
			Error
		if errors.Is(loadErr, gorm.ErrRecordNotFound) {
			return errTagMissing
		}

		if loadErr != nil {
			return loadErr
		}

		if tag.AppTask != "" {
			return errTagAppOwned
		}

		tag.Name = name
		tag.UpdatedAt = time.Now()

		updErr := tx.
			Model(&tag).
			Updates(map[string]any{"name": tag.Name, "updated_at": tag.UpdatedAt}).
			Error
		if isUniqueViolation(updErr) {
			return errTagNameTaken
		}

		return updErr
	})
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockTagRenameResponse{Tag: tagToProto(&tag)}), nil
}
