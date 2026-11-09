package main

import (
	"net/http"

	"gorm.io/gorm"

	mcp_service "github.com/pdcgo/warehouse_revamp/backend/services/mcp_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_oauth"
)

// AI AGENTS (our-server-hosts-the-mcp): user_service's credential store — which the access interceptor checks an agent's
// bearer against — its OAuth endpoints, and the MCP endpoint whose tools read through our own RPCs.

func NewAgentStore(db *gorm.DB) *agent_credentials.Store {
	return agent_credentials.NewStore(db)
}

// AgentEndpoints is what an agent on the internet reaches: the OAuth that connects it, and /mcp.
type AgentEndpoints struct {
	OAuth *agent_oauth.Handler
	MCP   http.Handler
}

// NewAgentEndpoints builds both. The MCP's tools call our API at InternalBaseURL with the agent's bearer, so every
// tool's read passes the same access interceptor a screen's does.
func NewAgentEndpoints(cfg *Config, store *agent_credentials.Store, client *internalHTTPClient) *AgentEndpoints {
	oauth := agent_oauth.NewHandler(store, agent_oauth.Config{PublicURL: cfg.PublicURL, AppURL: cfg.AppURL})

	return &AgentEndpoints{
		OAuth: oauth,
		MCP: mcp_service.NewHandler(store, mcp_service.NewClients(client, cfg.InternalBaseURL), mcp_service.Config{
			PublicURL:           cfg.PublicURL,
			ResourceMetadataURL: oauth.ResourceMetadataURL(),
		}),
	}
}

// Mount puts them on the mux.
func (a *AgentEndpoints) Mount(mux *http.ServeMux) {
	a.OAuth.Mount(mux)
	mux.Handle(mcp_service.Path, a.MCP)
}

// isAgentPath is a request an agent makes — answered with its own CORS, since an agent is not our app's origin.
func isAgentPath(path string) bool {
	return path == mcp_service.Path ||
		len(path) > len("/oauth/") && path[:len("/oauth/")] == "/oauth/" ||
		len(path) > len("/.well-known/") && path[:len("/.well-known/")] == "/.well-known/"
}
