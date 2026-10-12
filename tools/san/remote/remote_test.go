package remote

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1/remotev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
)

// The tests go through a REAL server and the generated client rather than calling the handler
// directly. connect does not export a way to build a ServerStream, and more to the point the
// interceptor is half of what is being tested here — a handler called directly would never see
// the token.

const testToken = "test-token-not-a-secret"

type harness struct {
	client remotev1connect.RemoteServiceClient
	root   string
	server *httptest.Server
}

func newHarness(t *testing.T, mutate func(*Config)) *harness {
	t.Helper()

	root := t.TempDir()

	cfg := Config{
		Root:           root,
		Shell:          DefaultShell(),
		DefaultTimeout: 30 * time.Second,
		MaxTimeout:     time.Minute,
		// Discard: the audit log is the operator's terminal, and a passing test should be quiet.
		Audit: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if mutate != nil {
		mutate(&cfg)
	}

	service, err := NewService(cfg)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	token := NewToken(testToken, 0, time.Now())

	mux := http.NewServeMux()

	opts := connect.WithInterceptors(
		validate.NewInterceptor(),
		NewAuthInterceptor(token, time.Now),
	)

	san_grpc.Register(mux, NewRegister(mux, service, opts))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return &harness{
		client: remotev1connect.NewRemoteServiceClient(
			server.Client(),
			server.URL,
			connect.WithInterceptors(NewClientAuthInterceptor(testToken)),
		),
		root:   service.Root(),
		server: server,
	}
}

// unauthenticated builds a client with the wrong credential.
func (h *harness) unauthenticated(token string) remotev1connect.RemoteServiceClient {
	opts := []connect.ClientOption{}
	if token != "" {
		opts = append(opts, connect.WithInterceptors(NewClientAuthInterceptor(token)))
	}

	return remotev1connect.NewRemoteServiceClient(h.server.Client(), h.server.URL, opts...)
}

// script writes the same intent in whichever shell the test host actually runs, so these tests
// mean the same thing on a developer's Windows box and on Linux CI.
type script struct {
	echoStderr string
	sleep5     string
	exit3      string
	writeFile  string
}

func scripts() script {
	if runtime.GOOS == "windows" {
		return script{
			echoStderr: `[Console]::Error.WriteLine("oops")`,
			sleep5:     "Start-Sleep -Seconds 5",
			exit3:      "exit 3",
			writeFile:  `Set-Content -Path marker.txt -Value here`,
		}
	}

	return script{
		echoStderr: "echo oops 1>&2",
		sleep5:     "sleep 5",
		exit3:      "exit 3",
		writeFile:  "echo here > marker.txt",
	}
}

// collected is a whole Exec run, flattened into the three things a test wants to assert on.
type collected struct {
	stdout string
	stderr string
	system string
	result *remotev1.ExecResult
}

func (h *harness) exec(t *testing.T, req *remotev1.ExecRequest) (collected, error) {
	t.Helper()

	return execWith(t, h.client, req)
}

func execWith(
	t *testing.T,
	client remotev1connect.RemoteServiceClient,
	req *remotev1.ExecRequest,
) (collected, error) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	stream, err := client.Exec(ctx, connect.NewRequest(req))
	if err != nil {
		return collected{}, err
	}

	defer func() { _ = stream.Close() }()

	var got collected

	for stream.Receive() {
		msg := stream.Msg()

		switch msg.GetStream() {
		case remotev1.ExecStream_EXEC_STREAM_STDOUT:
			got.stdout += msg.GetMessage()

		case remotev1.ExecStream_EXEC_STREAM_STDERR:
			got.stderr += msg.GetMessage()

		default:
			got.system += msg.GetMessage()
		}

		if msg.GetResult() != nil {
			got.result = msg.GetResult()
		}
	}

	return got, stream.Err()
}
