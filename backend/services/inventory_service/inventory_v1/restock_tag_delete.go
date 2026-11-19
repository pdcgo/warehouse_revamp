package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockTagDelete deletes a tag — the admins' alone (the 🔄 line under
// custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): it leaves the app-wide list AND comes off every restock
// that carries it, every team's, in ONE transaction. The tag's row is locked FOR UPDATE first, so a put-on in flight
// (which holds it FOR KEY SHARE, tagHeld) commits before the restocks are taken off and is taken off with them, and a
// later one finds no tag (NotFound) — never a restock left carrying a deleted tag. The app's own tags are
// FailedPrecondition; an unknown or already deleted tag NotFound.
func (s *Service) RestockTagDelete(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockTagDeleteRequest],
) (*connect.Response[inventoryv1.RestockTagDeleteResponse], error) {
	var off int64

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var tag inventory_service_models.Tag

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

		offRes := tx.
			Where("tag_id = ?", tag.ID).
			Delete(&inventory_service_models.RestockTag{})
		if offRes.Error != nil {
			return offRes.Error
		}

		off = offRes.RowsAffected

		return tx.
			Delete(&tag).
			Error
	})
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockTagDeleteResponse{RestockCount: uint64(off)}), nil
}
