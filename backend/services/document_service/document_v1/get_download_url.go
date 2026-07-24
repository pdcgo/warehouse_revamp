package document_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// GetDownloadUrl returns a viewable URL for an active document. The `team_id` clause is the scope
// check — a document owned by another team reads as NotFound, which closes the cross-team read gap.
func (s *Service) GetDownloadUrl(
	ctx context.Context,
	req *connect.Request[documentv1.GetDownloadUrlRequest],
) (*connect.Response[documentv1.GetDownloadUrlResponse], error) {
	var doc document_service_models.Document

	err := s.db.WithContext(ctx).
		Where("id = ? AND team_id = ? AND status = ?", req.Msg.GetDocumentId(), req.Msg.GetTeamId(), statusActive).
		First(&doc).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Public types get a stable URL with no expiry; private types get a short-lived signed one.
	if isPublic(doc.ResourceType) {
		return connect.NewResponse(&documentv1.GetDownloadUrlResponse{
			Url:    s.signer.PublicURL(doc.ObjectKey),
			Public: true,
		}), nil
	}

	expiry := time.Now().Add(s.cfg.URLTTL)

	return connect.NewResponse(&documentv1.GetDownloadUrlResponse{
		Url:           s.signer.SignedGetURL(doc.ObjectKey),
		ExpiresAtUnix: expiry.Unix(),
		Public:        false,
	}), nil
}
