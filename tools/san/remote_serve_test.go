package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/urfave/cli/v3"
)

// These tests drive the CLI the way an operator does — `san remote …` as argv — because the thing
// under test IS the wiring: which faces a command mounts, and on which paths. A test that called
// serveRemote directly would prove nothing about what `san remote mcp` actually starts.

// runServer starts one `san remote …` invocation on a free-ish port and returns its base URL,
// stopping it when the test ends.
func runServer(t *testing.T, args ...string) string {
	t.Helper()

	addr := "127.0.0.1:" + freePort(t)

	cmd := &cli.Command{
		Name:     "san",
		Commands: []*cli.Command{remoteCommand()},
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	full := append([]string{"san", "remote"}, args...)
	full = append(full, "--addr", addr, "--token", testServeToken)

	done := make(chan error, 1)

	go func() { done <- cmd.Run(ctx, full) }()

	base := "http://" + addr

	waitReady(t, base, done)

	return base
}

const testServeToken = "serve-test-token-not-a-secret"

// freePort asks the OS for one, so two tests running side by side cannot collide the way a
// hardcoded port would.
func freePort(t *testing.T) string {
	t.Helper()

	listener, err := listenAny()
	if err != nil {
		t.Fatalf("finding a free port: %v", err)
	}

	defer func() { _ = listener.Close() }()

	addr := listener.Addr().String()

	return addr[strings.LastIndex(addr, ":")+1:]
}

// waitReady blocks until the server answers, or until it dies trying — a server that failed to
// start must fail the test with ITS error, not with a timeout that says nothing.
func waitReady(t *testing.T, base string, done <-chan error) {
	t.Helper()

	deadline := time.Now().Add(15 * time.Second)

	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			if err != nil && !errors.Is(err, context.Canceled) {
				t.Fatalf("the server exited during startup: %v", err)
			}

			t.Fatal("the server exited during startup")

		default:
		}

		resp, err := http.Get(base + "/mcp")
		if err == nil {
			_ = resp.Body.Close()

			return
		}

		time.Sleep(50 * time.Millisecond)
	}

	t.Fatalf("the server never answered on %s", base)
}

// status POSTs to one path and reports what came back.
func status(t *testing.T, url string, body string) int {
	t.Helper()

	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("building request: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+testServeToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", url, err)
	}

	defer func() { _ = resp.Body.Close() }()

	return resp.StatusCode
}

const initBody = `{"jsonrpc":"2.0","id":1,"method":"initialize","params":` +
	`{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}`

const (
	rpcPath        = "/san.remote.v1.RemoteService/Info"
	reflectionPath = "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo"
)

// `san remote` serves BOTH faces on one port — one server, one tunnel.
func TestRemoteServesBothFaces(t *testing.T) {
	base := runServer(t)

	if code := status(t, base+"/mcp", initBody); code != http.StatusOK {
		t.Fatalf("mcp = %d, want 200", code)
	}

	if code := status(t, base+rpcPath, "{}"); code == http.StatusNotFound {
		t.Fatal("the Connect RPC is not mounted")
	}
}

// ⚠ `san remote mcp` serves the MCP endpoint and NOTHING ELSE. The RPCs being ABSENT is the whole
// point of the command: this is the address deliberately reachable from the internet, and a second
// unused surface on it is a second surface to get wrong.
func TestRemoteMCPServesOnlyMCP(t *testing.T) {
	base := runServer(t, "mcp")

	if code := status(t, base+"/mcp", initBody); code != http.StatusOK {
		t.Fatalf("mcp = %d, want 200", code)
	}

	if code := status(t, base+rpcPath, "{}"); code != http.StatusNotFound {
		t.Fatalf("the Connect RPC = %d, want 404 — `san remote mcp` must not serve it", code)
	}

	if code := status(t, base+reflectionPath, ""); code != http.StatusNotFound {
		t.Fatalf("gRPC reflection = %d, want 404 — it advertises services that are not mounted", code)
	}
}

// The mirror image, and the flag's whole meaning: the RPCs alone.
func TestRemoteNoMCPServesOnlyTheRPCs(t *testing.T) {
	base := runServer(t, "--no-mcp")

	if code := status(t, base+"/mcp", initBody); code != http.StatusNotFound {
		t.Fatalf("mcp = %d, want 404 under --no-mcp", code)
	}

	if code := status(t, base+rpcPath, "{}"); code == http.StatusNotFound {
		t.Fatal("the Connect RPC is not mounted")
	}
}

// A server with no faces at all is not a thing to start silently. Honouring the flag would serve
// nothing and ignoring it would contradict something the operator typed on purpose.
func TestRemoteMCPRefusesNoMCP(t *testing.T) {
	cmd := &cli.Command{
		Name:     "san",
		Commands: []*cli.Command{remoteCommand()},
	}

	err := cmd.Run(context.Background(), []string{"san", "remote", "mcp", "--no-mcp"})
	if err == nil {
		t.Fatal("`san remote mcp --no-mcp` started a server with no faces")
	}

	if !strings.Contains(err.Error(), "--no-mcp") {
		t.Fatalf("the error does not name the flag: %v", err)
	}
}

// listenAny opens a listener on an OS-chosen port. Split out so the import of net stays in one
// place and freePort reads as what it is.
func listenAny() (net.Listener, error) {
	return net.Listen("tcp", "127.0.0.1:0")
}
