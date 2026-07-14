package document_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// ConfirmUpload is phase two: verify the token, confirm the bytes landed, move the object from the
// incoming prefix to the permanent asset prefix, and mark the document active.
func (s *Service) ConfirmUpload(
	ctx context.Context,
	req *connect.Request[documentv1.ConfirmUploadRequest],
) (*connect.Response[documentv1.ConfirmUploadResponse], error) {
	documentID, err := s.verifyToken(req.Msg.GetUploadToken(), time.Now())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var doc document_service_models.Document

	err = s.db.WithContext(ctx).
		Where("id = ? AND status = ?", documentID, statusPending).
		First(&doc).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Already confirmed, or never requested — not retriable as-is.
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				errors.New("no pending upload for this token"))
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The bytes must actually be in storage before we promote the row.
	size, _, err := s.store.Stat(doc.ObjectKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("the file was not uploaded to storage"))
	}

	if size > s.cfg.MaxSizeBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the uploaded file exceeds the size limit"))
	}

	assetKey := objectKey(docstore.AssetPrefix, doc.TeamID, doc.ID, doc.Filename)

	err = s.store.Move(doc.ObjectKey, assetKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	publicURL := ""
	if isPublic(doc.ResourceType) {
		publicURL = s.signer.PublicURL(assetKey)
	}

	// Generate a thumbnail for image uploads (best-effort — never fails the confirm).
	var thumbKey, thumbURL string
	if isImage(doc.MimeType) {
		thumbKey, thumbURL = s.makeThumbnail(doc.TeamID, doc.ID, assetKey, isPublic(doc.ResourceType))
	}

	err = s.db.WithContext(ctx).
		Model(&document_service_models.Document{}).
		Where("id = ?", doc.ID).
		Updates(map[string]any{
			"object_key":    assetKey,
			"status":        statusActive,
			"size_bytes":    size,
			"public_url":    publicURL,
			"thumbnail_key": thumbKey,
			"thumbnail_url": thumbURL,
			"updated_at":    time.Now(),
		}).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	doc.ObjectKey = assetKey
	doc.Status = statusActive
	doc.SizeBytes = size
	doc.PublicURL = publicURL
	doc.ThumbnailKey = thumbKey
	doc.ThumbnailURL = thumbURL

	return connect.NewResponse(&documentv1.ConfirmUploadResponse{Document: toProto(&doc)}), nil
}
