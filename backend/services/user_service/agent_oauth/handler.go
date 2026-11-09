// Package agent_oauth is the OAuth an AI agent speaks to connect (our-server-hosts-the-mcp): discovery, dynamic client
// registration, the authorize redirect to our connect page, and the token exchange. Plain HTTP — an agent speaks OAuth
// 2.1, never Connect — over agent_credentials, which holds every rule.
//
//	the agent                     our server                          the person, in the browser
//	  │ POST /mcp, no bearer   →  401, WWW-Authenticate: resource_metadata
//	  │ GET  the metadata      →  the authorization server, its endpoints
//	  │ POST /oauth/register   →  a client_id (a public client: PKCE, no secret)
//	  │ opens /oauth/authorize →  302 to the app's /connect-agent      →  signs in, names it, picks the team, Allow
//	  │                                                                    AgentConnect → the redirect with a code
//	  │ POST /oauth/token      →  the agent's own credential, 90 days
//	  │ POST /mcp, Bearer      →  the tools
package agent_oauth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
)

// MCPPath is where the MCP endpoint is mounted — the protected resource this authorization server mints credentials for.
const MCPPath = "/mcp"

// ConnectPagePath is the app's page where the person allows an agent.
const ConnectPagePath = "/connect-agent"

// Config is where things are, as an agent on the internet sees them.
type Config struct {
	// PublicURL is the API's own public base — the issuer, its endpoints and the MCP resource (https://api.example.com).
	PublicURL string
	// AppURL is the web app's public base, where the connect page is (https://app.example.com).
	AppURL string
}

// Handler serves the OAuth endpoints.
type Handler struct {
	store *agent_credentials.Store
	cfg   Config
}

func NewHandler(store *agent_credentials.Store, cfg Config) *Handler {
	cfg.PublicURL = strings.TrimSuffix(cfg.PublicURL, "/")
	cfg.AppURL = strings.TrimSuffix(cfg.AppURL, "/")

	return &Handler{store: store, cfg: cfg}
}

// Mount puts every endpoint on the mux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("/.well-known/oauth-authorization-server", public(h.authorizationServerMetadata))
	// RFC 9728 places a resource's metadata under the well-known prefix + the resource's path; the bare one is served too
	// for an agent that asks there.
	mux.HandleFunc("/.well-known/oauth-protected-resource", public(h.protectedResourceMetadata))
	mux.HandleFunc("/.well-known/oauth-protected-resource"+MCPPath, public(h.protectedResourceMetadata))
	mux.HandleFunc("/oauth/register", public(h.register))
	mux.HandleFunc("/oauth/authorize", h.authorize)
	mux.HandleFunc("/oauth/token", public(h.token))
}

// ResourceMetadataURL is where the MCP endpoint's 401 points an agent.
func (h *Handler) ResourceMetadataURL() string {
	return h.cfg.PublicURL + "/.well-known/oauth-protected-resource" + MCPPath
}

// ── discovery ─────────────────────────────────────────────────────────────────────────────────────────────────────

func (h *Handler) authorizationServerMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                h.cfg.PublicURL,
		"authorization_endpoint":                h.cfg.PublicURL + "/oauth/authorize",
		"token_endpoint":                        h.cfg.PublicURL + "/oauth/token",
		"registration_endpoint":                 h.cfg.PublicURL + "/oauth/register",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      []string{"read"},
	})
}

func (h *Handler) protectedResourceMetadata(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"resource":                 h.cfg.PublicURL + MCPPath,
		"authorization_servers":    []string{h.cfg.PublicURL},
		"bearer_methods_supported": []string{"header"},
		"scopes_supported":         []string{"read"},
		"resource_name":            "Warehouse — read-only",
	})
}

// ── registration (RFC 7591) ───────────────────────────────────────────────────────────────────────────────────────

type registration struct {
	ClientName   string   `json:"client_name"`
	RedirectURIs []string `json:"redirect_uris"`
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	var body registration

	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body)
	if err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_client_metadata", "the registration is not JSON")

		return
	}

	client, err := h.store.RegisterClient(r.Context(), body.ClientName, body.RedirectURIs)
	if errors.Is(err, agent_credentials.ErrBadRegistration) {
		oauthError(w, http.StatusBadRequest, "invalid_redirect_uri", err.Error())

		return
	}

	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "the registration could not be saved")

		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  client.ClientID,
		"client_id_issued_at":        client.CreatedAt.Unix(),
		"client_name":                client.ClientName,
		"redirect_uris":              body.RedirectURIs,
		"grant_types":                []string{"authorization_code"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
	})
}

// ── authorize ─────────────────────────────────────────────────────────────────────────────────────────────────────

// authorize sends the person's browser to the app's connect page, which signs them in, names the connection and picks
// the team (an-agent-gets-its-own-team-credential). ⚠ An unknown client or a redirect it never registered gets a
// page HERE, never a redirect: a code or an error sent to an unregistered address is handed to whoever owns it.
func (h *Handler) authorize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	q := r.URL.Query()
	clientID := q.Get("client_id")
	redirectURI := q.Get("redirect_uri")
	state := q.Get("state")

	_, err := h.store.Client(r.Context(), clientID, redirectURI)
	if err != nil {
		http.Error(w, "This connection link is not valid: "+err.Error()+". Start again from the agent.", http.StatusBadRequest)

		return
	}

	refuse := func(code, description string) {
		target, _ := url.Parse(redirectURI)
		query := target.Query()
		query.Set("error", code)
		query.Set("error_description", description)

		if state != "" {
			query.Set("state", state)
		}

		target.RawQuery = query.Encode()
		http.Redirect(w, r, target.String(), http.StatusFound)
	}

	if q.Get("response_type") != "code" {
		refuse("unsupported_response_type", "only the authorization code flow is supported")

		return
	}

	if q.Get("code_challenge") == "" || q.Get("code_challenge_method") != "S256" {
		refuse("invalid_request", "PKCE with S256 is required")

		return
	}

	page := url.Values{
		"client_id":             {clientID},
		"redirect_uri":          {redirectURI},
		"code_challenge":        {q.Get("code_challenge")},
		"code_challenge_method": {"S256"},
	}

	if state != "" {
		page.Set("state", state)
	}

	http.Redirect(w, r, h.cfg.AppURL+ConnectPagePath+"?"+page.Encode(), http.StatusFound)
}

// ── token ─────────────────────────────────────────────────────────────────────────────────────────────────────────

func (h *Handler) token(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)

		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)

	err := r.ParseForm()
	if err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request", "the request is not a form")

		return
	}

	if r.PostForm.Get("grant_type") != "authorization_code" {
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type", "only authorization_code is supported — connect again after 90 days")

		return
	}

	token, credential, err := h.store.Exchange(r.Context(),
		r.PostForm.Get("code"),
		r.PostForm.Get("client_id"),
		r.PostForm.Get("redirect_uri"),
		r.PostForm.Get("code_verifier"),
	)
	if errors.Is(err, agent_credentials.ErrBadCode) {
		oauthError(w, http.StatusBadRequest, "invalid_grant", err.Error())

		return
	}

	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error", "the credential could not be made")

		return
	}

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": token,
		"token_type":   "Bearer",
		"expires_in":   int64(time.Until(credential.ExpiresAt).Seconds()),
		"scope":        "read",
	})
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────

// public lets an agent's browser-side code reach an endpoint cross-origin. Nothing here reads a cookie or a session —
// a public client proves itself with PKCE — so an origin check would refuse the legitimate caller and stop nobody.
func public(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)

			return
		}

		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func oauthError(w http.ResponseWriter, status int, code, description string) {
	writeJSON(w, status, map[string]string{"error": code, "error_description": description})
}
