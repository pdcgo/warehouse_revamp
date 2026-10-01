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

// GetDownloadUrl returns a viewable URL for an active document.
//
// ⚠ TWO DOORS, AND EXACTLY TWO: the team that OWNS the document, and a team the owner has SHARED it
// with (a-payment-must-carry-proof). Anything else reads as NotFound rather than PermissionDenied, so
// a caller cannot probe ids to learn what another team holds.
//
// The share is a ROW, not a rule — THERE IS NO READ WITHOUT SOMETHING RECORDING THAT YOU MAY. The
// alternative considered was an internal signing path that skipped this check so another service
// could vouch for the reader; that trades this invariant for "trust that service", and one bug in its
// relation check would leak every private file in the system.
func (s *Service) GetDownloadUrl(
	ctx context.Context,
	req *connect.Request[documentv1.GetDownloadUrlRequest],
) (*connect.Response[documentv1.GetDownloadUrlResponse], error) {
	var doc document_service_models.Document

	// ⚠ THE SHARE IS AN EXISTS SUBQUERY, not a join. A join would return one row per share and turn a
	// document shared with three teams into three documents.
	err := s.db.WithContext(ctx).
		Where("id = ? AND status = ?", req.Msg.GetDocumentId(), statusActive).
		Where(
			s.db.Where("team_id = ?", req.Msg.GetTeamId()).
				Or("EXISTS (?)", s.db.
					Table("document_shares").
					Select("1").
					Where("document_shares.document_id = documents.id").
					Where("document_shares.team_id = ?", req.Msg.GetTeamId())),
		).
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
