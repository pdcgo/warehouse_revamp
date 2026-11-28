package product_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductTagDelete deletes a product tag — the admins' alone (products-have-their-own-tag-list): it leaves the products'
// list AND comes off every product that carries it, every team's, in ONE transaction. The tag's row is locked FOR UPDATE
// first, so a put-on in flight (which holds it FOR KEY SHARE, productTagHeld) commits before the products are taken off
// and is taken off with them, and a later one finds no tag (NotFound) — never a product left carrying a deleted tag. The
// app's own (`need_reprint_code`) is locked for everyone, admins included: FailedPrecondition. An unknown or already
// deleted tag is NotFound.
func (s *Service) ProductTagDelete(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagDeleteRequest],
) (*connect.Response[productv1.ProductTagDeleteResponse], error) {
	var off int64

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		tag, loadErr := lockedTagForAdmin(tx, req.Msg.GetTagId())
		if loadErr != nil {
			return loadErr
		}

		offRes := tx.
			Where("tag_id = ?", tag.ID).
			Delete(&product_service_models.ProductTagLink{})
		if offRes.Error != nil {
			return offRes.Error
		}

		off = offRes.RowsAffected

		return tx.
			Delete(tag).
			Error
	})
	if err != nil {
		return nil, productTagErr(err)
	}

	return connect.NewResponse(&productv1.ProductTagDeleteResponse{ProductCount: uint64(off)}), nil
}
