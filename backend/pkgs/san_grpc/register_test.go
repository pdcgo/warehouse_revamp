package san_grpc_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
)

// Register must (1) run every handler — that is what mounts the services — and (2) mount the gRPC
// reflection endpoints, both v1 and v1alpha, over the names the handlers reported.
func TestRegister_RunsHandlersAndMountsReflection(t *testing.T) {
	mux := http.NewServeMux()

	ran := 0
	register := func() san_grpc.ServiceReflectNames {
		ran++

		return san_grpc.ServiceReflectNames{"warehouse.test.v1.TestService"}
	}

	san_grpc.Register(mux, register, register)

	if ran != 2 {
		t.Fatalf("handlers run = %d, want 2 (Register must call every handler)", ran)
	}

	srv := httptest.NewServer(mux)
	defer srv.Close()

	// A mounted handler answers its path; an unmounted one 404s. We only need to prove the
	// reflection paths are mounted, so anything other than 404 is a pass.
	for _, path := range []string{
		"/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
		"/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo",
	} {
		resp, err := http.Post(srv.URL+path, "application/grpc", http.NoBody)
		if err != nil {
			t.Fatalf("POST %s: %v", path, err)
		}
		resp.Body.Close()

		if resp.StatusCode == http.StatusNotFound {
			t.Errorf("%s is not mounted (404) — reflection was not registered", path)
		}
	}
}
