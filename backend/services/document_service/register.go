package document_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

// NewRegister mounts document_service's guarded Connect handler AND — for the local backend — the
// unauthenticated file endpoint that clients PUT/GET bytes through (a signed URL is the capability).
// The file endpoint is a dev backend detail; a cloud backend would mount nothing extra here.
func NewRegister(
	mux *http.ServeMux,
	document *document_v1.Service,
	cfg docstore.Config,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(documentv1connect.NewDocumentServiceHandler(document, opts))
		mux.Handle(docstore.LocalMountPath, docstore.NewLocalFileHandler(docstore.DefaultConfig(cfg)))

		return san_grpc.ServiceReflectNames{documentv1connect.DocumentServiceName}
	}
}
