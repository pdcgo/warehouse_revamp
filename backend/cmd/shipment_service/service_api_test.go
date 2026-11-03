package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// newTestServer builds the real mux with NO database. Every request here is answered before a handler touches
// one: by the health route, by the validator, or by the access interceptor.
func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()

	signer := san_auth.NewSigner("test-secret", time.Hour)
	resolver := access_interceptors.NewDBRoleResolver(nil, san_caches.NewSkipCacheManager())

	mux, err := NewServeMux(shipment_v1.NewService(nil), signer, resolver)
	if err != nil {
		t.Fatalf("NewServeMux: %v", err)
	}

	cfg := &Config{AllowedOrigins: []string{"http://localhost:5174"}}
	server := httptest.NewServer(NewServer(cfg, mux).Handler)
	t.Cleanup(server.Close)

	return server
}

func post(t *testing.T, url, body string) *http.Response {
	t.Helper()

	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}

	t.Cleanup(func() { _ = res.Body.Close() })

	return res
}

// /healthz is what Cloud Run's probe and `san deploy`'s check after a rollout both ask.
func TestHealthzAnswers(t *testing.T) {
	server := newTestServer(t)

	res, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}

	_ = res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("/healthz = %d, want 200", res.StatusCode)
	}
}

// The label check is mounted AND guarded: a request with no token reaches the access interceptor (valid body, so
// past the validator) and is refused there, before the reader sees a byte.
func TestReceiptCheckIsMountedAndNeedsALogin(t *testing.T) {
	server := newTestServer(t)

	res := post(t, server.URL+"/warehouse.shipment.v1.ReceiptService/ReceiptCheck", `{"fileContent":"JVBERg=="}`)

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ReceiptCheck with no token = %d, want 401", res.StatusCode)
	}
}

// A channel write is mounted and guarded the same way: no token, no write.
func TestAChannelWriteNeedsALogin(t *testing.T) {
	server := newTestServer(t)

	res := post(t, server.URL+"/warehouse.shipment.v1.ShipmentChannelService/ShipmentChannelCreate",
		`{"code":"x","name":"X"}`)

	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ShipmentChannelCreate with no token = %d, want 401", res.StatusCode)
	}
}

// Only shipment is served: another service's route is not here at all.
func TestNoOtherServiceIsMounted(t *testing.T) {
	server := newTestServer(t)

	res := post(t, server.URL+"/warehouse.user.v1.AuthService/Login", `{}`)

	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("another service's route = %d, want 404", res.StatusCode)
	}
}
