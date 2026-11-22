package selling_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderTagRename renames an order tag — the admins' alone (orders-have-their-own-tag-list, its 🔄 "A"), a custom or a
// system tag (no app-owned order tags, so none is locked); every order carrying it reads the new name at once. ONE NAME,
// ONE TAG: a name ANOTHER order tag carries, any case, is AlreadyExists (the unique index decides, so two renames to one
// name at the same second cannot both pass); a change of case alone is a rename. An unknown tag is NotFound.
func (s *Service) OrderTagRename(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagRenameRequest],
) (*connect.Response[sellingv1.OrderTagRenameResponse], error) {
	name := cleanOrderTagName(req.Msg.GetName())
	if name == "" {
		return nil, orderTagErr(errOrderTagNameEmpty)
	}

	var tag selling_service_models.OrderTag

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", req.Msg.GetTagId()).
			Take(&tag).
			Error
		if errors.Is(loadErr, gorm.ErrRecordNotFound) {
			return errOrderTagMissing
		}

		if loadErr != nil {
			return loadErr
		}

		tag.Name = name
		tag.UpdatedAt = time.Now()

		updErr := tx.
			Model(&tag).
			Updates(map[string]any{"name": tag.Name, "updated_at": tag.UpdatedAt}).
			Error
		if isUniqueViolation(updErr) {
			return errOrderTagNameTaken
		}

		return updErr
	})
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagRenameResponse{Tag: orderTagToProto(&tag)}), nil
}
