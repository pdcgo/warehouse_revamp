package main

import (
	"net/http"
	"testing"
)

// A browser keeps a pre-check's answer only as long as Access-Control-Max-Age says — 5 s when it is absent (backlog
// #127). Shipment's own binary answers the dev server's 7200 s, through its real mux and CORS wrapper (newTestServer),
// and the rest of the answer is what it was: the app's origin, POST, the Authorization header.
func TestAPreCheckIsKeptForTwoHours(t *testing.T) {
	server := newTestServer(t)

	req, err := http.NewRequest(http.MethodOptions,
		server.URL+"/warehouse.shipment.v1.ShipmentChannelService/ShipmentChannelList", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}

	req.Header.Set("Origin", "http://localhost:5174")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	req.Header.Set("Access-Control-Request-Headers", "authorization,connect-protocol-version,content-type")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("OPTIONS: %v", err)
	}

	t.Cleanup(func() { _ = res.Body.Close() })

	got := res.Header.Get("Access-Control-Max-Age")
	if got != "7200" {
		t.Errorf("Access-Control-Max-Age = %q, want \"7200\"", got)
	}

	got = res.Header.Get("Access-Control-Allow-Origin")
	if got != "http://localhost:5174" {
		t.Errorf("Access-Control-Allow-Origin = %q, want the app's origin", got)
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
