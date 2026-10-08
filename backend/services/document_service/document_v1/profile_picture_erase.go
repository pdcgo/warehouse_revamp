package document_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// ProfilePictureErase implements [documentv1connect.DocumentServiceHandler].
//
// erase-deletes-the-photo-file: when a person is erased, the photos they uploaded go too — not only the link the
// account held. EVERY profile picture they uploaded, the current one and those they replaced, each with its
// thumbnail, and the rows that describe them.
//
// The FILES go first, then the rows. A file that fails to delete stops the call with its row still in place, so
// erasing again finds it and tries again; a file already gone is not an error (the store ignores a missing key). The
// reverse order would leave a file nobody can find.
func (s *Service) ProfilePictureErase(
	ctx context.Context,
	req *connect.Request[documentv1.ProfilePictureEraseRequest],
) (*connect.Response[documentv1.ProfilePictureEraseResponse], error) {
	var docs []document_service_models.Document

	err := s.db.
		WithContext(ctx).
		Select("id", "object_key", "thumbnail_key").
		Where("resource_type = ? AND created_by_id = ?", resourceProfilePicture, req.Msg.GetUserId()).
		Find(&docs).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if len(docs) == 0 {
		return connect.NewResponse(&documentv1.ProfilePictureEraseResponse{}), nil
	}

	ids := make([]string, 0, len(docs))

	for _, doc := range docs {
		for _, key := range []string{doc.ObjectKey, doc.ThumbnailKey} {
			if key == "" {
				continue
			}

			err = s.store.Delete(key)
			if err != nil {
				return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("deleting a photo file: %w", err))
			}
		}

		ids = append(ids, doc.ID)
	}

	// A photo shared with another team is held by its share rows (ON DELETE RESTRICT); a link to an erased person's
	// photo goes with the photo.
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Where("document_id IN ?", ids).Delete(&document_service_models.DocumentShare{}).Error
		if err != nil {
			return err
		}

		return tx.Where("id IN ?", ids).Delete(&document_service_models.Document{}).Error
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&documentv1.ProfilePictureEraseResponse{Erased: uint32(len(ids))}), nil
}
