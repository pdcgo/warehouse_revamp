// Package mcp_service is the MCP endpoint an AI agent connects to (our-server-hosts-the-mcp) — ChatGPT, Claude — at a
// public URL, behind the OAuth login user_service serves. Its tools READ (an-agent-only-reads-for-now), through the
// metric pattern and three lookups (the-agent-reads-through-the-metric-pattern).
//
// It owns no data and no table. Every tool calls our own RPCs as a Connect client, carrying the agent's bearer — so a
// tool's call passes the access interceptor exactly as a screen's does, and the interceptor is what holds an agent to
// reading, and to its one team (an-agent-gets-its-own-team-credential). A tool is a convenience over the API, never a
// second door into it.
//
// Built on the protocol's official Go SDK (the-mcp-uses-the-official-go-sdk).
package mcp_service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1/productv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// Path is where the endpoint is mounted.
const Path = "/mcp"

// Clients are the RPCs the tools read through. Each forwards the agent's bearer (san_auth.ForwardBearer).
type Clients struct {
	Orders             sellingv1connect.OrderServiceClient
	OrderAnalytic      sellingv1connect.OrderAnalyticServiceClient
	SettlementAnalytic settlementv1connect.SettlementAnalyticServiceClient
	SupplierAnalytic   supplierv1connect.SupplierAnalyticServiceClient
	Products           productv1connect.ProductServiceClient
	Liability          liabilityv1connect.LiabilityServiceClient
	Teams              teamv1connect.TeamServiceClient
}

// NewClients points every client at our own API.
func NewClients(httpClient connect.HTTPClient, baseURL string) Clients {
	forward := connect.WithInterceptors(san_auth.ForwardBearer())

	return Clients{
		Orders:             sellingv1connect.NewOrderServiceClient(httpClient, baseURL, forward),
		OrderAnalytic:      sellingv1connect.NewOrderAnalyticServiceClient(httpClient, baseURL, forward),
		SettlementAnalytic: settlementv1connect.NewSettlementAnalyticServiceClient(httpClient, baseURL, forward),
		SupplierAnalytic:   supplierv1connect.NewSupplierAnalyticServiceClient(httpClient, baseURL, forward),
		Products:           productv1connect.NewProductServiceClient(httpClient, baseURL, forward),
		Liability:          liabilityv1connect.NewLiabilityServiceClient(httpClient, baseURL, forward),
		Teams:              teamv1connect.NewTeamServiceClient(httpClient, baseURL, forward),
	}
}

// Config is where the endpoint is, as an agent sees it.
type Config struct {
	// PublicURL is the API's public base. A non-loopback one means the endpoint is reached through a proxy or a tunnel,
	// which the SDK's localhost guard would otherwise refuse with 403.
	PublicURL string
	// ResourceMetadataURL is where a 401 points the agent to start its OAuth (agent_oauth.Handler.ResourceMetadataURL).
	ResourceMetadataURL string
}

// NewHandler is the endpoint: the agent's bearer checked, then the MCP server. Stateless, so any instance answers any
// request and a restart drops no session; JSON responses, since no tool streams.
func NewHandler(verifier access_interceptors.AgentVerifier, clients Clients, cfg Config) http.Handler {
	server := NewServer(clients)

	streamable := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{
			Stateless:                  true,
			JSONResponse:               true,
			DisableLocalhostProtection: !isLoopback(cfg.PublicURL),
		},
	)

	guarded := auth.RequireBearerToken(verify(verifier), &auth.RequireBearerTokenOptions{
		ResourceMetadataURL: cfg.ResourceMetadataURL,
	})(streamable)

	return withCORS(guarded)
}

// NewServer is the MCP server and its tools — every one a read, listed with readOnlyHint.
func NewServer(clients Clients) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "warehouse",
		Title:   "Warehouse — read-only",
		Version: "1.0.0",
	}, &mcp.ServerOptions{
		Instructions: "Read-only access to one team's warehouse and selling data (or every team, for root). " +
			"Start with list_metrics to see what can be measured, then read_metric. search_products and find_orders " +
			"turn a name or a marketplace reference into ids; balance_positions is what the team owes and is owed. " +
			"Money is Indonesian rupiah; days are Asia/Jakarta. Nothing here can change any data.",
	})

	tools := &tools{clients: clients, limits: newLimits()}

	tools.addListTeams(server)
	tools.addListMetrics(server)
	tools.addReadMetric(server)
	tools.addSearchProducts(server)
	tools.addFindOrders(server)
	tools.addBalancePositions(server)

	return server
}

// verify is the bearer check: a live agent credential, and what it reads for. Anything else is a 401 that sends the
// agent back to OAuth; the database failing is a 500, so a broken database never reads as "connect again".
func verify(verifier access_interceptors.AgentVerifier) auth.TokenVerifier {
	return func(ctx context.Context, token string, _ *http.Request) (*auth.TokenInfo, error) {
		if !access_interceptors.IsAgentToken(token) {
			return nil, fmt.Errorf("%w: not an agent credential — connect the agent from its settings", auth.ErrInvalidToken)
		}

		grant, err := verifier.VerifyAgent(ctx, token)
		if errors.Is(err, access_interceptors.ErrInvalidAgentCredential) {
			return nil, fmt.Errorf("%w: %v", auth.ErrInvalidToken, err)
		}

		if err != nil {
			return nil, err
		}

		return &auth.TokenInfo{
			Scopes:     []string{"read"},
			Expiration: grant.ExpiresAt,
			UserID:     strconv.FormatUint(grant.CredentialID, 10),
			Extra:      map[string]any{grantKey: grant, bearerKey: token},
		}, nil
	}
}

const (
	grantKey  = "grant"
	bearerKey = "bearer"
)

// withCORS lets a browser-based agent reach the endpoint. The bearer authorizes a call, not its origin.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID")
		w.Header().Set("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)

			return
		}

		next.ServeHTTP(w, r)
	})
}

func isLoopback(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return true
	}

	host := u.Hostname()
	if host == "localhost" {
		return true
	}

	ip := net.ParseIP(host)

	return ip != nil && ip.IsLoopback()
}

// callTimeout bounds one tool's reads.
const callTimeout = 30 * time.Second
