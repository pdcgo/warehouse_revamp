package remote

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The MCP tests go through a REAL http server and the SDK's own client, for the same reason the
// Connect ones do: the token check is HTTP middleware, so a handler called directly would never
// see it — and the auth is half of what this endpoint is.

type mcpHarness struct {
	server  *httptest.Server
	session *mcp.ClientSession
	root    string
}

// newMCPHarness serves one workspace over MCP and connects a client to it.
func newMCPHarness(t *testing.T, cfg MCPConfig) *mcpHarness {
	t.Helper()

	service, token, server := newMCPServerOnly(t, cfg)

	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "0"}, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:   server.URL + DefaultMCPPath,
		HTTPClient: bearerClient(server.Client(), token.Value()),
	}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	t.Cleanup(func() { _ = session.Close() })

	return &mcpHarness{server: server, session: session, root: service.Root()}
}

func newMCPServerOnly(t *testing.T, cfg MCPConfig) (*Service, *Token, *httptest.Server) {
	t.Helper()

	root := t.TempDir()

	service, err := NewService(Config{
		Root:           root,
		Shell:          DefaultShell(),
		DefaultTimeout: 30 * time.Second,
		MaxTimeout:     time.Minute,
		// Discard: the audit log is the operator's terminal, and a passing test should be quiet.
		Audit: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	token := NewToken(testToken, 0, time.Now())

	if cfg.Audit == nil {
		cfg.Audit = slog.New(slog.NewTextHandler(io.Discard, nil))
	}

	mux := http.NewServeMux()
	handler := NewMCPHandler(service, token, cfg)

	mux.Handle(DefaultMCPPath, handler)
	mux.Handle(DefaultMCPPath+"/", handler)

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return service, token, server
}

// bearerClient presents the token on every request, the way a locally-configured MCP client does.
func bearerClient(base *http.Client, token string) *http.Client {
	clone := *base
	clone.Transport = &bearerTransport{next: base.Transport, token: token}

	return &clone
}

type bearerTransport struct {
	next  http.RoundTripper
	token string
}

func (t *bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	next := t.next
	if next == nil {
		next = http.DefaultTransport
	}

	clone := r.Clone(r.Context())

	if t.token != "" {
		clone.Header.Set("Authorization", "Bearer "+t.token)
	}

	return next.RoundTrip(clone)
}

// call runs one tool and returns the result, failing the test only when the CALL failed — a tool
// that reports an error in its result is a normal outcome the caller may want to assert on.
func (h *mcpHarness) call(t *testing.T, name string, args map[string]any) *mcp.CallToolResult {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	res, err := h.session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("CallTool %s: %v", name, err)
	}

	return res
}

// structured decodes a tool's structured output into a map, which is what a client that reads
// structuredContent rather than the text block sees.
func structured(t *testing.T, res *mcp.CallToolResult) map[string]any {
	t.Helper()

	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatalf("marshal structured content: %v", err)
	}

	var out map[string]any

	err = json.Unmarshal(raw, &out)
	if err != nil {
		t.Fatalf("unmarshal structured content: %v", err)
	}

	return out
}

func textOf(res *mcp.CallToolResult) string {
	var out strings.Builder

	for _, content := range res.Content {
		text, ok := content.(*mcp.TextContent)
		if ok {
			out.WriteString(text.Text)
		}
	}

	return out.String()
}

// The tool set is the CONTRACT with an agent we did not write. A tool silently disappearing —
// dropped from NewMCPServer in a refactor — would show up on the far side as a model that quietly
// stops being able to read files, with nothing failing here.
func TestMCPExposesTheFourTools(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	res, err := h.session.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}

	got := map[string]bool{}
	for _, tool := range res.Tools {
		got[tool.Name] = true
	}

	for _, want := range []string{"workspace_info", "run_command", "read_file", "write_file"} {
		if !got[want] {
			t.Fatalf("tool %q missing; got %v", want, got)
		}
	}
}

// A model that does not know the shell writes for the wrong one. This is the single fact the
// instructions tell it to fetch first, so it must actually be there.
func TestMCPWorkspaceInfoReportsShellAndRoot(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	out := structured(t, h.call(t, "workspace_info", map[string]any{}))

	if out["workspace_root"] != h.root {
		t.Fatalf("workspace_root = %v, want %s", out["workspace_root"], h.root)
	}

	shell, _ := out["shell"].([]any)
	if len(shell) == 0 {
		t.Fatalf("shell = %v, want the argv a command is appended to", out["shell"])
	}

	if out["max_file_bytes"] == nil {
		t.Fatal("max_file_bytes missing — an agent cannot tell what read_file will refuse")
	}
}

func TestMCPRunCommandReturnsOutputAndExitCode(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	res := h.call(t, "run_command", map[string]any{"command": "echo hello"})

	if res.IsError {
		t.Fatalf("run_command reported an error: %s", textOf(res))
	}

	out := structured(t, res)

	output, _ := out["output"].(string)
	if !strings.Contains(output, "hello") {
		t.Fatalf("output = %q, want it to contain hello", output)
	}

	if out["exit_code"] != float64(0) {
		t.Fatalf("exit_code = %v, want 0", out["exit_code"])
	}

	// The SYSTEM frames the streaming face emits are the server narrating the run. They must not
	// reach a model's context — every fact in them is already a typed field here.
	if strings.Contains(output, "level=INFO") {
		t.Fatalf("the server's own log leaked into the transcript: %q", output)
	}
}

// Same rule as the RPC: a command that fails is a RESULT. If this becomes a tool error, an agent
// loses the output of the failing command — which is the output it needed most.
func TestMCPRunCommandNonZeroExitIsNotAToolError(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	res := h.call(t, "run_command", map[string]any{"command": scripts().exit3})

	if res.IsError {
		t.Fatalf("a non-zero exit was reported as a tool error: %s", textOf(res))
	}

	out := structured(t, res)
	if out["exit_code"] != float64(3) {
		t.Fatalf("exit_code = %v, want 3", out["exit_code"])
	}
}

// A bad path must come back as a TOOL error — visible to the model, which can then fix it. As a
// protocol error it would be invisible and the agent would simply retry the same thing.
func TestMCPRunCommandBadWorkingDirIsAVisibleToolError(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	res := h.call(t, "run_command", map[string]any{
		"command":     "echo hi",
		"working_dir": "../outside",
	})

	if !res.IsError {
		t.Fatal("a working_dir escaping the root was accepted")
	}

	if !strings.Contains(textOf(res), "working_dir") {
		t.Fatalf("the error does not name what to fix: %s", textOf(res))
	}
}

func TestMCPWriteThenReadFileRoundTrips(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	// The content deliberately carries what a shell would mangle: a dollar, a backtick and a CRLF.
	const content = "package main\n// $HOME and `backtick` survive\r\nfunc main() {}\n"

	write := structured(t, h.call(t, "write_file", map[string]any{
		"path":        "sub/main.go",
		"content":     content,
		"create_dirs": true,
	}))

	if write["replaced"] != false {
		t.Fatalf("replaced = %v, want false for a new file", write["replaced"])
	}

	onDisk, err := os.ReadFile(filepath.Join(h.root, "sub", "main.go"))
	if err != nil {
		t.Fatalf("reading back from disk: %v", err)
	}

	if string(onDisk) != content {
		t.Fatalf("on disk = %q, want %q", onDisk, content)
	}

	read := structured(t, h.call(t, "read_file", map[string]any{"path": "sub/main.go"}))

	if read["content"] != content {
		t.Fatalf("read_file content = %q, want %q", read["content"], content)
	}

	if read["encoding"] != encodingText {
		t.Fatalf("encoding = %v, want %q", read["encoding"], encodingText)
	}
}

// A file that is not UTF-8 must be ANNOUNCED as base64, not quietly repaired. An agent that was
// handed silently-replaced bytes would write them back and corrupt the file without being told.
func TestMCPReadFileSaysWhenAFileIsNotText(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	raw := []byte{0x00, 0xff, 0xfe, 'g', 'o'}

	err := os.WriteFile(filepath.Join(h.root, "blob.bin"), raw, 0o644)
	if err != nil {
		t.Fatalf("seeding the file: %v", err)
	}

	out := structured(t, h.call(t, "read_file", map[string]any{"path": "blob.bin"}))

	if out["encoding"] != encodingBase64 {
		t.Fatalf("encoding = %v, want %q", out["encoding"], encodingBase64)
	}
}

// base64 in, exact bytes out — the other half of the same rule.
func TestMCPWriteFileAcceptsBase64(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	res := h.call(t, "write_file", map[string]any{
		"path":     "blob.bin",
		"content":  "AP/+Z28=", // the same five bytes as above
		"encoding": encodingBase64,
	})

	if res.IsError {
		t.Fatalf("write_file: %s", textOf(res))
	}

	onDisk, err := os.ReadFile(filepath.Join(h.root, "blob.bin"))
	if err != nil {
		t.Fatalf("reading back: %v", err)
	}

	want := []byte{0x00, 0xff, 0xfe, 'g', 'o'}
	if string(onDisk) != string(want) {
		t.Fatalf("on disk = %v, want %v", onDisk, want)
	}
}

// An encoding nobody recognises must be REFUSED. Treating it as text would store the base64
// itself, and the agent would have no error to tell it why the file was wrong.
func TestMCPWriteFileRefusesAnUnknownEncoding(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	res := h.call(t, "write_file", map[string]any{
		"path":     "x.txt",
		"content":  "hello",
		"encoding": "rot13",
	})

	if !res.IsError {
		t.Fatal("an unknown encoding was accepted")
	}
}

// The proto is the ONE place the limits live. If the MCP face stopped validating, its limits
// would be free to drift from the RPC's — which is the whole bug the shared contract prevents.
func TestMCPEnforcesTheProtoLimits(t *testing.T) {
	h := newMCPHarness(t, MCPConfig{})

	res := h.call(t, "run_command", map[string]any{"command": ""})
	if !res.IsError {
		t.Fatal("an empty command was accepted; remote.proto says min_len 1")
	}

	res = h.call(t, "read_file", map[string]any{"path": strings.Repeat("a", 5000)})
	if !res.IsError {
		t.Fatal("a 5000-character path was accepted; remote.proto says max_len 4096")
	}
}

// discardLogger keeps a passing test quiet — the audit log is the operator's terminal.
func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// recorder is one request and the response it produced, for the tests that drive the auth handler
// directly rather than through a server — the cases that need a clock or a next handler of their
// own.
type recorder struct {
	request *http.Request
	writer  *httptest.ResponseRecorder
}

func newRecorder(t *testing.T, method, path, authorization string) recorder {
	t.Helper()

	req := httptest.NewRequest(method, path, strings.NewReader(initializeBody))
	req.Header.Set("Content-Type", "application/json")

	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}

	return recorder{request: req, writer: httptest.NewRecorder()}
}
