package settlement_importer_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// readMaxBytes caps what the handler reads (settlement_importer critique 17). The FILE is held to 10 MB by
// the request's own `max_len`; the browser sends JSON, where 10 MB of bytes is ~13.4 MB of base64 — so
// the transport's cap sits just above that, and nothing larger is read at all.
const readMaxBytes = 15 << 20

// NewRegister mounts settlement_importer_service behind the shared interceptor chain — whose access
// interceptor authorizes a server stream on its request (a-server-stream-is-authorized-on-its-request) —
// and reports it for reflection.
func NewRegister(
	mux *http.ServeMux,
	importer *settlement_importer_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(settlement_importerv1connect.NewSettlementImporterServiceHandler(
			importer,
			opts,
			connect.WithReadMaxBytes(readMaxBytes),
		))

		return san_grpc.ServiceReflectNames{settlement_importerv1connect.SettlementImporterServiceName}
	}
}
