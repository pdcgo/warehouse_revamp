// Package document_v1 implements warehouse.document.v1.DocumentService.
//
// The bytes never pass through here: RequestUpload issues a PUT URL, the client uploads directly,
// ConfirmUpload verifies and promotes the object. Every RPC is team-scoped except ConfirmUpload,
// whose capability is the server-signed upload token.
package document_v1

import (
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
)

type Service struct {
	db     *gorm.DB
	signer docstore.Signer
	store  docstore.ObjectStore
	cfg    docstore.Config
}

var _ documentv1connect.DocumentServiceHandler = (*Service)(nil)

// NewService builds the DocumentService on the local filesystem backend (Config defaults filled).
// A cloud backend would swap the signer/store here and change nothing else.
func NewService(db *gorm.DB, cfg docstore.Config) *Service {
	cfg = docstore.DefaultConfig(cfg)

	return &Service{
		db:     db,
		signer: docstore.NewLocalSigner(cfg),
		store:  docstore.NewLocalStore(cfg),
		cfg:    cfg,
	}
}

const (
	statusPending = "pending"
	statusActive  = "active"
)

// resource types, as stored in the `resource_type` TEXT column.
const (
	resourceGeneral        = "general"
	resourceProfilePicture = "profile_picture"
)

func resourceTypeToText(t documentv1.DocumentResourceType) (string, error) {
	switch t {
	case documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL:
		return resourceGeneral, nil
	case documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PROFILE_PICTURE:
		return resourceProfilePicture, nil
	default:
		return "", fmt.Errorf("unknown resource type %v", t)
	}
}

func resourceTypeFromText(text string) documentv1.DocumentResourceType {
	switch text {
	case resourceGeneral:
		return documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_GENERAL
	case resourceProfilePicture:
		return documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_PROFILE_PICTURE
	default:
		return documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_UNSPECIFIED
	}
}

// isPublic reports whether a resource type is served at a stable public URL (an <img src>) rather
// than a short-lived signed one.
func isPublic(text string) bool {
	return text == resourceProfilePicture
}

var errDocumentMissing = errors.New("document not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errDocumentMissing)
}
