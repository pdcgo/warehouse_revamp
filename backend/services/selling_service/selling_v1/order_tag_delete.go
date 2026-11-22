package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderTagDelete deletes an order tag — the admins' alone (orders-have-their-own-tag-list, its 🔄 "A"): it leaves the
// orders' list AND comes off every order that carries it, every team's, in ONE transaction. The tag's row is locked FOR
// UPDATE first, so a put-on in flight (which holds it FOR KEY SHARE, orderTagHeld) commits before the orders are taken
// off and is taken off with them, and a later one finds no tag (NotFound) — never an order left carrying a deleted tag.
// An unknown or already deleted tag is NotFound.
func (s *Service) OrderTagDelete(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagDeleteRequest],
) (*connect.Response[sellingv1.OrderTagDeleteResponse], error) {
	var off int64

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var tag selling_service_models.OrderTag

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

		offRes := tx.
			Where("tag_id = ?", tag.ID).
			Delete(&selling_service_models.OrderTagLink{})
		if offRes.Error != nil {
			return offRes.Error
		}

		off = offRes.RowsAffected

		return tx.
			Delete(&tag).
			Error
	})
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagDeleteResponse{OrderCount: uint64(off)}), nil
}
