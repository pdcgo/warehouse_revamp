package document_v1

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// RequestUpload is phase one of the two-phase upload: it records a pending document and returns a
// signed PUT URL plus a token. The bytes go straight to storage, not through this handler.
func (s *Service) RequestUpload(
	ctx context.Context,
	req *connect.Request[documentv1.RequestUploadRequest],
) (*connect.Response[documentv1.RequestUploadResponse], error) {
	msg := req.Msg

	if msg.GetSizeBytes() > s.cfg.MaxSizeBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("file too large: %d bytes exceeds the %d-byte limit", msg.GetSizeBytes(), s.cfg.MaxSizeBytes))
	}

	resourceText, err := resourceTypeToText(msg.GetResourceType())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	documentID, err := newID()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	key := objectKey(docstore.IncomingPrefix, msg.GetTeamId(), documentID, msg.GetFilename())

	// Best-effort uploader audit — never fail the upload if identity is somehow absent.
	var createdBy uint64

	identity, idErr := san_auth.GetIdentity(ctx)
	if idErr == nil {
		createdBy = identity.GetIdentityId()
	}

	doc := document_service_models.Document{
		ID:           documentID,
		TeamID:       msg.GetTeamId(),
		ResourceType: resourceText,
		ObjectKey:    key,
		MimeType:     msg.GetContentType(),
		SizeBytes:    msg.GetSizeBytes(),
		Filename:     msg.GetFilename(),
		CreatedByID:  createdBy,
		Status:       statusPending,
	}

	err = s.db.WithContext(ctx).Create(&doc).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	expiry := time.Now().Add(s.cfg.URLTTL)

	return connect.NewResponse(&documentv1.RequestUploadResponse{
		UploadUrl:     s.signer.SignedPutURL(key, msg.GetContentType()),
		Method:        http.MethodPut,
		Headers:       map[string]string{"Content-Type": msg.GetContentType()},
		UploadToken:   s.signToken(documentID, expiry),
		ExpiresAtUnix: expiry.Unix(),
	}), nil
}
