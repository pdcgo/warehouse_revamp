package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/services/mcp_service"
)

const corsTestOrigin = "http://localhost:5174"

// preCheck sends the browser's CORS pre-check (an OPTIONS with the request's method and headers) through the server's
// real handler — NewServer's, the CORS wrapper the dev server answers with — and returns the answer.
func preCheck(t *testing.T, server *httptest.Server, path string) *http.Response {
	t.Helper()

	req, err := http.NewRequest(http.MethodOptions, server.URL+path, nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}

	req.Header.Set("Origin", corsTestOrigin)
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization,connect-protocol-version,content-type")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS %s: %v", path, err)
	}

	t.Cleanup(func() { _ = res.Body.Close() })

	return res
}

func newCORSTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	cfg := &Config{AllowedOrigins: []string{corsTestOrigin}}

	// The pre-check is answered by the CORS wrapper itself, before any route: an empty mux is the real chain for it.
	server := httptest.NewServer(NewServer(cfg, http.NewServeMux()).Handler)
	t.Cleanup(server.Close)

	return server
}

// A browser keeps a pre-check's answer only as long as Access-Control-Max-Age says — 5 s when it is absent, so every
// request shape was asked again on each screen (backlog #127). The API answers 7200 s, Chromium's own cap, and the
// rest of the answer is what it was: the app's origin, POST, the Authorization header.
func TestAPreCheckIsKeptForTwoHours(t *testing.T) {
	server := newCORSTestServer(t)

	res := preCheck(t, server, "/warehouse.inventory.v1.RackService/RackDetail")

	got := res.Header.Get("Access-Control-Max-Age")
	if got != "7200" {
		t.Errorf("Access-Control-Max-Age = %q, want \"7200\"", got)
	}

	got = res.Header.Get("Access-Control-Allow-Origin")
	if got != corsTestOrigin {
		t.Errorf("Access-Control-Allow-Origin = %q, want %q", got, corsTestOrigin)
	}

	got = res.Header.Get("Access-Control-Allow-Methods")
	if got != http.MethodPost {
		t.Errorf("Access-Control-Allow-Methods = %q, want POST", got)
	}

	got = res.Header.Get("Access-Control-Allow-Headers")
	if got != "authorization,connect-protocol-version,content-type" {
		t.Errorf("Access-Control-Allow-Headers = %q, want the three asked for", got)
	}
}

// An agent's door answers its own CORS (our-server-hosts-the-mcp): its pre-check never reaches the app's wrapper, so
// it carries none of the app's answer — no max age either.
func TestAnAgentPathKeepsItsOwnCORS(t *testing.T) {
	server := newCORSTestServer(t)

	for _, path := range []string{mcp_service.Path, "/oauth/token", "/.well-known/oauth-authorization-server"} {
		res := preCheck(t, server, path)

		got := res.Header.Get("Access-Control-Max-Age")
		if got != "" {
			t.Errorf("%s: Access-Control-Max-Age = %q, want none — the agent path answers its own CORS", path, got)
		}

		got = res.Header.Get("Access-Control-Allow-Origin")
		if got != "" {
			t.Errorf("%s: Access-Control-Allow-Origin = %q, want none from the app's wrapper", path, got)
		}
	}
}
