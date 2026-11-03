package main

import (
	"log"
	"net/http"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"connectrpc.com/validate"
	"github.com/rs/cors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	shipment_service "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// NewServeMux mounts shipment_service — ShipmentChannelService and ReceiptService — behind the same interceptor
// chain the dev server builds, and nothing else.
//
// ⚠ NO AGENT VERIFIER AND NO TEAM KINDS. Both read user_service's and team_service's state, which this binary
// does not carry. Without a verifier an AI-agent bearer (`wha_…`) answers Unauthenticated; without team kinds no
// admin-team monitoring applies — and neither changes a shipment answer: the channel reads are public, the
// channel writes are root's, and the label check takes any signed-in user.
func NewServeMux(
	shipment *shipment_v1.Service,
	signer *san_auth.Signer,
	resolver access_interceptors.RoleResolver,
) (*http.ServeMux, error) {
	// FAIL FAST on a malformed policy, as the dev server does: a bad use_scope tag is silent at runtime.
	err := san_auth.ValidateDescriptors()
	if err != nil {
		return nil, err
	}

	// protovalidate BEFORE authorization, so a malformed request never reaches the role lookup.
	opts := connect.WithInterceptors(
		validate.NewInterceptor(),
		access_interceptors.NewInterceptor(signer, resolver),
	)

	mux := http.NewServeMux()

	// Cloud Run's startup probe and `san deploy`'s check after a rollout.
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	san_grpc.Register(mux,
		shipment_service.NewRegister(mux, shipment, opts),
	)

	return mux, nil
}

func NewServer(cfg *Config, mux *http.ServeMux) *http.Server {
	// net/http's own unencrypted HTTP/2 (Go 1.24+), never x/net/http2/h2c (HARD RULE 5). Cloud Run speaks HTTP/1.1
	// to the container unless --use-http2 is set, and both are served.
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	log.Printf("cors origins: %v", cfg.AllowedOrigins)

	return &http.Server{
		Addr:      cfg.Addr,
		Handler:   withCORS(cfg, mux),
		Protocols: protocols,
	}
}

// withCORS is the dev server's, less the agent paths this binary does not serve.
//
// Authorization is added to connect's own header list: without it every signed-in call is killed by the browser
// at preflight, and nothing reaches the server log.
func withCORS(cfg *Config, handler http.Handler) http.Handler {
	allowedHeaders := append(connectcors.AllowedHeaders(), "Authorization")

	middleware := cors.New(cors.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		AllowedMethods: connectcors.AllowedMethods(),
		AllowedHeaders: allowedHeaders,
		ExposedHeaders: connectcors.ExposedHeaders(),
	})

	return middleware.Handler(handler)
}
