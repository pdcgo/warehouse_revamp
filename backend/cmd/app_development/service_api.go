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
	product_service "github.com/pdcgo/warehouse_revamp/backend/services/product_service"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	shipping_service "github.com/pdcgo/warehouse_revamp/backend/services/shipping_service"
	shipping_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_v1"
	team_service "github.com/pdcgo/warehouse_revamp/backend/services/team_service"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
	user_service "github.com/pdcgo/warehouse_revamp/backend/services/user_service"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// NewServeMux mounts every service handler.
//
// EVERY guarded handler gets the access interceptor. In the source, some services mounted no
// interceptor at all, which quietly turned their declared request_policy options into
// decoration — the policy was written down and never enforced. Mounting is not optional here.
func NewServeMux(
	authService *user_v1.AuthService,
	userService *user_v1.Service,
	teamService *team_v1.Service,
	shippingService *shipping_v1.Service,
	productService *product_v1.Service,
	resolver access_interceptors.RoleResolver,
	signer *san_auth.Signer,
) (*http.ServeMux, error) {
	// FAIL FAST on a malformed policy. A use_scope tag that is non-uint, nested, or duplicated
	// is silent at runtime — it must stop the process, not serve traffic.
	err := san_auth.ValidateDescriptors()
	if err != nil {
		return nil, err
	}

	// protovalidate runs BEFORE authorization, so a malformed request is rejected without ever
	// reaching the role lookup.
	validator := validate.NewInterceptor()

	// ONE chain, built once, applied to EVERY guarded handler.
	//
	// Building it per-handler is how the source ended up with services that mounted no
	// interceptor at all — their request_policy options were written down and never enforced.
	opts := connect.WithInterceptors(
		validator,
		access_interceptors.NewInterceptor(signer, resolver),
	)

	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// Each service reports the handler(s) it mounts and the proto services it exposes; san_grpc
	// mounts them and advertises exactly those over gRPC reflection. Adding a service is one line
	// here plus its register.go — reflection can never drift from what is actually served.
	san_grpc.Register(mux,
		user_service.NewRegister(mux, authService, userService, opts),
		team_service.NewRegister(mux, teamService, opts),
		shipping_service.NewRegister(mux, shippingService, opts),
		product_service.NewRegister(mux, productService, opts),
	)

	return mux, nil
}

func NewServer(cfg *Config, mux *http.ServeMux) *http.Server {
	// The modern replacement for the deprecated x/net/http2/h2c: net/http has spoken
	// unencrypted HTTP/2 natively since Go 1.24.
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

func withCORS(cfg *Config, handler http.Handler) http.Handler {
	// connectcors.AllowedHeaders() covers only the CONNECT PROTOCOL headers
	// (Content-Type, Connect-Protocol-Version, timeouts, …). It does NOT include Authorization
	// — that is ours to add.
	//
	// Omitting it fails in a nasty, asymmetric way: Login carries no Authorization header, so it
	// sails through, and EVERY authenticated call afterwards is killed by the browser at
	// preflight — before the request ever reaches the server. Nothing appears in the server log.
	// From the UI it looks like the API returned nothing.
	allowedHeaders := append(connectcors.AllowedHeaders(), "Authorization")

	middleware := cors.New(cors.Options{
		AllowedOrigins: cfg.AllowedOrigins,
		AllowedMethods: connectcors.AllowedMethods(),
		AllowedHeaders: allowedHeaders,
		ExposedHeaders: connectcors.ExposedHeaders(),
	})

	return middleware.Handler(handler)
}
