package agent_oauth_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_oauth"
)

const (
	publicURL = "https://api.example.com"
	appURL    = "https://app.example.com"
	redirect  = "https://claude.ai/api/mcp/auth_callback"
	verifier  = "a-verifier-that-is-long-enough-to-be-a-real-pkce-verifier-0123456789"
)

func challenge() string {
	sum := sha256.Sum256([]byte(verifier))

	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func serve(t *testing.T) (*httptest.Server, *agent_credentials.Store) {
	t.Helper()

	store := agent_credentials.NewStore(san_testdb.DB(t))
	mux := http.NewServeMux()
	agent_oauth.NewHandler(store, agent_oauth.Config{PublicURL: publicURL, AppURL: appURL}).Mount(mux)

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return server, store
}

// noRedirects lets a test read the 302 itself.
var noRedirects = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func decode(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()

	var body map[string]any

	err := json.NewDecoder(res.Body).Decode(&body)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}

	return body
}

// DISCOVERY: the agent finds the authorization server from the resource, and its endpoints from there — all on the
// public URL, never the address the server listens on.
func TestOAuth_DiscoveryNamesThePublicEndpoints(t *testing.T) {
	server, _ := serve(t)

	res, _ := http.Get(server.URL + "/.well-known/oauth-protected-resource/mcp")
	resource := decode(t, res)

	if resource["resource"] != publicURL+"/mcp" {
		t.Fatalf("resource = %v, want %s/mcp", resource["resource"], publicURL)
	}

	res, _ = http.Get(server.URL + "/.well-known/oauth-authorization-server")
	meta := decode(t, res)

	for key, want := range map[string]string{
		"issuer":                 publicURL,
		"authorization_endpoint": publicURL + "/oauth/authorize",
		"token_endpoint":         publicURL + "/oauth/token",
		"registration_endpoint":  publicURL + "/oauth/register",
	} {
		if meta[key] != want {
			t.Fatalf("%s = %v, want %s", key, meta[key], want)
		}
	}
}

// REGISTRATION hands out a public client id — and refuses a redirect that is neither https nor this machine.
func TestOAuth_Registration(t *testing.T) {
	server, _ := serve(t)

	res, _ := http.Post(server.URL+"/oauth/register", "application/json",
		strings.NewReader(`{"client_name":"Claude","redirect_uris":["`+redirect+`"]}`))
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register = %d, want 201", res.StatusCode)
	}

	body := decode(t, res)
	if id, _ := body["client_id"].(string); !strings.HasPrefix(id, "agent_") || body["token_endpoint_auth_method"] != "none" {
		t.Fatalf("registration = %v, want an agent_ client id and no secret", body)
	}

	res, _ = http.Post(server.URL+"/oauth/register", "application/json",
		strings.NewReader(`{"client_name":"x","redirect_uris":["http://evil.example.com/cb"]}`))
	if res.StatusCode != http.StatusBadRequest || decode(t, res)["error"] != "invalid_redirect_uri" {
		t.Fatal("a plain-http, non-local redirect was registered")
	}
}

// AUTHORIZE sends the browser to the app's connect page with everything it needs — and an unknown client or redirect
// gets a page here, never a redirect.
func TestOAuth_AuthorizeSendsTheBrowserToTheConnectPage(t *testing.T) {
	server, store := serve(t)

	client, _ := store.RegisterClient(context.Background(), "Claude", []string{redirect})

	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {client.ClientID},
		"redirect_uri":          {redirect},
		"state":                 {"xyz"},
		"code_challenge":        {challenge()},
		"code_challenge_method": {"S256"},
	}

	res, _ := noRedirects.Get(server.URL + "/oauth/authorize?" + query.Encode())
	if res.StatusCode != http.StatusFound {
		t.Fatalf("authorize = %d, want 302", res.StatusCode)
	}

	target, _ := url.Parse(res.Header.Get("Location"))
	if target.Scheme+"://"+target.Host+target.Path != appURL+"/connect-agent" ||
		target.Query().Get("client_id") != client.ClientID || target.Query().Get("state") != "xyz" ||
		target.Query().Get("code_challenge") != challenge() {
		t.Fatalf("redirected to %s, want the connect page with the client, the state and the challenge", target)
	}

	bad := url.Values{}
	for k, v := range query {
		bad[k] = v
	}

	bad.Set("redirect_uri", "https://evil.example.com/cb")

	res, _ = noRedirects.Get(server.URL + "/oauth/authorize?" + bad.Encode())
	if res.StatusCode != http.StatusBadRequest || res.Header.Get("Location") != "" {
		t.Fatalf("an unregistered redirect = %d to %q, want a 400 page and no redirect", res.StatusCode, res.Header.Get("Location"))
	}

	query.Del("code_challenge")

	res, _ = noRedirects.Get(server.URL + "/oauth/authorize?" + query.Encode())
	if location, _ := url.Parse(res.Header.Get("Location")); res.StatusCode != http.StatusFound ||
		!strings.HasPrefix(location.String(), redirect) || location.Query().Get("error") != "invalid_request" {
		t.Fatalf("no PKCE = %d to %s, want the agent's redirect with invalid_request", res.StatusCode, location)
	}
}

// THE TOKEN EXCHANGE gives the agent its own credential, once.
func TestOAuth_TheTokenExchange(t *testing.T) {
	server, store := serve(t)
	ctx := context.Background()

	client, _ := store.RegisterClient(ctx, "Claude", []string{redirect})

	// The code needs a person: the seeded root.
	const userID uint64 = 1

	code, err := store.MintCode(ctx, agent_credentials.CodeGrant{
		ClientID: client.ClientID, RedirectURI: redirect, CodeChallenge: challenge(), UserID: userID, TeamID: 5, Name: "Claude",
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {client.ClientID},
		"redirect_uri":  {redirect},
		"code_verifier": {verifier},
	}

	res, _ := http.PostForm(server.URL+"/oauth/token", form)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("token = %d, want 200", res.StatusCode)
	}

	body := decode(t, res)

	token, _ := body["access_token"].(string)
	if !access_interceptors.IsAgentToken(token) || body["token_type"] != "Bearer" {
		t.Fatalf("token response = %v, want an agent bearer", body)
	}

	if expires, _ := body["expires_in"].(float64); expires < 89*24*3600 || expires > 90*24*3600 {
		t.Fatalf("expires_in = %v, want 90 days", body["expires_in"])
	}

	res, _ = http.PostForm(server.URL+"/oauth/token", form)
	if res.StatusCode != http.StatusBadRequest || decode(t, res)["error"] != "invalid_grant" {
		t.Fatal("a code was exchanged twice")
	}

	form.Set("grant_type", "refresh_token")

	res, _ = http.PostForm(server.URL+"/oauth/token", form)
	if res.StatusCode != http.StatusBadRequest || decode(t, res)["error"] != "unsupported_grant_type" {
		t.Fatal("a refresh grant was accepted — a credential lives 90 days, then the person connects again")
	}
}
