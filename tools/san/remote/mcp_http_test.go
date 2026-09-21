package remote

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// initializeBody is the smallest request that gets past routing, so these tests are about the
// token check and nothing else. Its content does not matter — only whether it is refused.
const initializeBody = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":` +
	`{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}`

// post sends one MCP request and returns the status, with whatever credential the caller wants.
func post(t *testing.T, client *http.Client, url string, header string) *http.Response {
	t.Helper()

	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(initializeBody))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	if header != "" {
		req.Header.Set("Authorization", header)
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}

	t.Cleanup(func() { _ = resp.Body.Close() })

	return resp
}

// The token is the ONLY thing between a caller and a shell on the operator's machine. An
// unauthenticated request reaching the MCP transport at all is the failure that matters here.
func TestMCPRefusesWithoutAToken(t *testing.T) {
	_, _, server := newMCPServerOnly(t, MCPConfig{})

	resp := post(t, server.Client(), server.URL+DefaultMCPPath, "")

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}

	// Without the challenge a well-behaved client cannot tell "send a token" from "this endpoint
	// is broken", and will not retry with one.
	if !strings.HasPrefix(resp.Header.Get("WWW-Authenticate"), "Bearer") {
		t.Fatalf("WWW-Authenticate = %q, want a Bearer challenge", resp.Header.Get("WWW-Authenticate"))
	}
}

func TestMCPRefusesTheWrongToken(t *testing.T) {
	_, _, server := newMCPServerOnly(t, MCPConfig{})

	resp := post(t, server.Client(), server.URL+DefaultMCPPath, "Bearer not-the-token")

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

// An expired token is refused like any other. Without this the --token-ttl flag would be a
// promise the MCP face does not keep, while the RPC face does.
func TestMCPRefusesAnExpiredToken(t *testing.T) {
	_, token, _ := newMCPServerOnly(t, MCPConfig{})

	// Reach past the constructor: the handler reads the clock, so an expiry in the past is the
	// same thing to it as a token that has been alive for an hour.
	expired := NewToken(token.Value(), time.Nanosecond, time.Now().Add(-time.Hour))

	handler := &mcpAuthHandler{
		next:  http.NotFoundHandler(),
		token: expired,
		path:  DefaultMCPPath,
		audit: discardLogger(),
		now:   time.Now,
	}

	rec := newRecorder(t, http.MethodPost, DefaultMCPPath, "Bearer "+token.Value())
	handler.ServeHTTP(rec.writer, rec.request)

	if rec.writer.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for an expired token", rec.writer.Code)
	}
}

// The path form is what a HOSTED client uses — it has a URL box and nowhere to put a header. If
// this regresses, Claude on the web cannot connect at all and the header tests would still pass.
func TestMCPAcceptsTheTokenInThePath(t *testing.T) {
	_, token, server := newMCPServerOnly(t, MCPConfig{})

	resp := post(t, server.Client(), server.URL+DefaultMCPPath+"/"+token.Value(), "")

	if resp.StatusCode == http.StatusUnauthorized {
		t.Fatal("a token in the path was refused; a hosted client cannot send a header")
	}
}

func TestMCPRefusesAWrongTokenInThePath(t *testing.T) {
	_, _, server := newMCPServerOnly(t, MCPConfig{})

	resp := post(t, server.Client(), server.URL+DefaultMCPPath+"/not-the-token", "")

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

// A deeper path is not a token with extra segments. Accepting one would mean /mcp/<token>/../x
// and friends reached the transport with the leading segment treated as a credential.
func TestMCPRefusesADeeperPath(t *testing.T) {
	_, token, server := newMCPServerOnly(t, MCPConfig{})

	resp := post(t, server.Client(), server.URL+DefaultMCPPath+"/"+token.Value()+"/extra", "")

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

// The token segment must not survive into the transport's view of the path. It does not route on
// the path today; this is what stops that from silently becoming untrue.
func TestMCPStripsTheTokenFromThePath(t *testing.T) {
	_, token, _ := newMCPServerOnly(t, MCPConfig{})

	var seen string

	handler := &mcpAuthHandler{
		next: http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			seen = r.URL.Path
		}),
		token: token,
		path:  DefaultMCPPath,
		audit: discardLogger(),
		now:   time.Now,
	}

	rec := newRecorder(t, http.MethodPost, DefaultMCPPath+"/"+token.Value(), "")
	handler.ServeHTTP(rec.writer, rec.request)

	if seen != DefaultMCPPath {
		t.Fatalf("the transport saw path %q, want %q", seen, DefaultMCPPath)
	}
}

// A stale token in a bookmarked URL must not beat a correct header — being locked out by a URL
// you cannot see is a very hard failure to diagnose from the client side.
func TestMCPHeaderBeatsThePath(t *testing.T) {
	_, token, server := newMCPServerOnly(t, MCPConfig{})

	resp := post(t, server.Client(), server.URL+DefaultMCPPath+"/stale-token", "Bearer "+token.Value())

	if resp.StatusCode == http.StatusUnauthorized {
		t.Fatal("a correct header was overridden by a stale token in the path")
	}
}

// A browser-based agent preflights. A CORS failure here looks like a dead endpoint from the far
// side, with nothing in the server's log to explain it.
func TestMCPAnswersThePreflight(t *testing.T) {
	_, _, server := newMCPServerOnly(t, MCPConfig{})

	req, err := http.NewRequest(http.MethodOptions, server.URL+DefaultMCPPath, nil)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}

	req.Header.Set("Origin", "https://claude.ai")
	req.Header.Set("Access-Control-Request-Method", "POST")

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("OPTIONS: %v", err)
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", resp.StatusCode)
	}

	// Mcp-Session-Id must be readable by a browser client or it cannot continue its own session,
	// which shows up as a client that re-initializes on every call.
	if !strings.Contains(resp.Header.Get("Access-Control-Expose-Headers"), "Mcp-Session-Id") {
		t.Fatalf("Mcp-Session-Id is not exposed: %q", resp.Header.Get("Access-Control-Expose-Headers"))
	}
}

// ⚠ THE TUNNEL TEST. Every tunnelled request arrives on loopback carrying the PUBLIC hostname,
// which is exactly the shape the SDK's DNS-rebinding guard rejects. Without BehindTunnel the whole
// feature returns 403 to everything — and it would still pass every other test in this file,
// because they all speak to 127.0.0.1 as 127.0.0.1.
func TestMCPBehindTunnelAcceptsAPublicHost(t *testing.T) {
	_, token, server := newMCPServerOnly(t, MCPConfig{BehindTunnel: true})

	req, err := http.NewRequest(http.MethodPost, server.URL+DefaultMCPPath, strings.NewReader(initializeBody))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token.Value())

	// What cloudflared forwards: the connection is local, the Host is not.
	req.Host = "devel.example.com"

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode == http.StatusForbidden {
		t.Fatal("a tunnelled request was rejected by the rebinding guard even with BehindTunnel set")
	}
}

// The mirror image: with no tunnel declared the guard stays ON. Leaving it off by default would
// mean a loopback-only server silently accepted rebinding attempts.
func TestMCPWithoutTunnelKeepsTheRebindingGuard(t *testing.T) {
	_, token, server := newMCPServerOnly(t, MCPConfig{})

	req, err := http.NewRequest(http.MethodPost, server.URL+DefaultMCPPath, strings.NewReader(initializeBody))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+token.Value())
	req.Host = "devel.example.com"

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 — the guard must stay on when no tunnel is declared", resp.StatusCode)
	}
}

// The transport's body cap must be LOOSER than what write_file allows, or a legal write fails as
// a 413 the file tool never got to see.
func TestMCPBodyCapClearsTheFileLimit(t *testing.T) {
	if mcpMaxRequestBody <= MaxFileBytes {
		t.Fatalf("mcpMaxRequestBody = %d, must exceed MaxFileBytes = %d plus base64 overhead",
			mcpMaxRequestBody, MaxFileBytes)
	}

	// base64 inflates by 4/3, and a file at the limit must still fit inside the JSON envelope.
	if mcpMaxRequestBody < MaxFileBytes*4/3 {
		t.Fatalf("mcpMaxRequestBody = %d, does not clear a base64-encoded file of %d bytes",
			mcpMaxRequestBody, MaxFileBytes)
	}
}

// A session must survive more than one call. A regression to "every call re-initializes" is
// invisible in a single-call test and expensive in a real conversation.
func TestMCPSessionSurvivesRepeatedCalls(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	for i := range 3 {
		_, err := h.session.CallTool(ctx, &mcp.CallToolParams{
			Name:      "workspace_info",
			Arguments: map[string]any{},
		})
		if err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
}
