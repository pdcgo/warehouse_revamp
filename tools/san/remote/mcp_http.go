package remote

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// DefaultMCPPath is where the MCP endpoint is mounted. It is a path and not a whole server so
// ONE tunnel carries both faces of `san remote` — the Connect RPCs live under /<proto package>/,
// which cannot collide with this.
const DefaultMCPPath = "/mcp"

// mcpSessionTimeout closes a session nobody has spoken to since.
//
// A tunnel drops, a browser tab closes, a laptop sleeps — none of those send a DELETE, so without
// this every abandoned session stays resident for as long as the server runs. Half an hour is
// longer than any gap in an actual working session and shorter than a lunch break.
const mcpSessionTimeout = 30 * time.Minute

// mcpMaxRequestBody leaves room for the largest legal write_file plus its base64 overhead and the
// JSON around it, so the transport never becomes the tighter of the two limits.
const mcpMaxRequestBody = MaxFileBytes*4/3 + (1 << 20)

// MCPConfig is what the CLI decides about the MCP endpoint.
type MCPConfig struct {
	// Path is the mount point. Empty means DefaultMCPPath.
	Path string

	// BehindTunnel turns OFF the SDK's DNS-rebinding guard.
	//
	// ⚠ This is not decoration — it is the difference between a tunnel working and a tunnel
	// returning 403 to everything. The guard rejects a request that ARRIVES on loopback while
	// carrying a non-loopback Host header, and that is EXACTLY the shape of every tunnelled
	// request: cloudflared connects to 127.0.0.1 and forwards Host: devel.example.com. The guard
	// is right for a server only ever spoken to locally and wrong for the one case this endpoint
	// exists to serve, so the operator declares which they are running.
	BehindTunnel bool

	// Audit is the operator's log — who connected, and who was turned away.
	Audit *slog.Logger
}

// NewMCPHandler builds the HTTP face of the MCP server: the token check, then the MCP transport.
//
// # Why the token can travel in the PATH as well as a header
//
// A bearer header is the right way to carry a credential, and it is what every locally-configured
// client uses — Claude Code, Claude Desktop and Cursor all take a headers map. But the case this
// endpoint exists for is the one that CANNOT do that: a hosted client where the operator pastes a
// URL into a box and there is nowhere to type a header. For those, the token is a path segment.
//
// ⚠ A token in a URL is genuinely weaker: URLs end up in browser history, in a tunnel provider's
// access logs, and in a screenshot of the settings screen it was pasted into. It is acceptable
// HERE because the credential is minted per run, dies with the process, and is revoked by Ctrl-C
// — and because the alternative is not "use a header", it is "no hosted client at all".
func NewMCPHandler(service *Service, token *Token, cfg MCPConfig) http.Handler {
	if cfg.Path == "" {
		cfg.Path = DefaultMCPPath
	}

	if cfg.Audit == nil {
		cfg.Audit = slog.Default()
	}

	server := NewMCPServer(service)

	handler := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{
			SessionTimeout: mcpSessionTimeout,

			// See MCPConfig.BehindTunnel. Left ON when the server is only spoken to locally.
			DisableLocalhostProtection: cfg.BehindTunnel,

			// The SDK default is 4MB, which is SMALLER than what write_file is allowed to carry:
			// a file may be MaxFileBytes, and base64 inflates it by a third on the way through
			// JSON. A 413 from the transport would look to an agent like the file tool refusing a
			// size the file tool actually permits.
			MaxRequestBodyBytes: mcpMaxRequestBody,
		},
	)

	return &mcpAuthHandler{
		next:  handler,
		token: token,
		path:  strings.TrimSuffix(cfg.Path, "/"),
		audit: cfg.Audit,
		now:   time.Now,
	}
}

type mcpAuthHandler struct {
	next  http.Handler
	token *Token
	path  string
	audit *slog.Logger
	now   func() time.Time
}

func (h *mcpAuthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// A browser-based agent calls this cross-origin. The TOKEN is what authorizes the call, not
	// the origin — an origin check would refuse the legitimate caller while stopping nobody who
	// holds the credential.
	setMCPCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)

		return
	}

	presented, rest := h.credential(r)

	err := h.token.Verify(presented, h.now())
	if err != nil {
		h.audit.Warn("mcp refused",
			"peer", peerOf(r),
			"path", r.URL.Path,
			"reason", err,
		)

		// The challenge tells a client that DOES support headers what to send. Without it a
		// well-behaved client cannot tell "you need a token" from "this endpoint is broken".
		w.Header().Set("WWW-Authenticate", "Bearer realm=\"san remote\"")
		http.Error(w, "unauthorized", http.StatusUnauthorized)

		return
	}

	// Rewrite the path back to the mount point, so the token segment is not part of what the MCP
	// transport sees. It does not route on the path today, and this makes sure it never can.
	r.URL.Path = rest

	h.next.ServeHTTP(w, withPeerRequest(r))
}

// credential reads the token from wherever this client was able to put it, and returns the path
// with any token segment removed.
//
// The header WINS. A client that can send one has the safer channel, and letting a stale segment
// in a bookmarked URL override a correct header would be a confusing way to be locked out.
func (h *mcpAuthHandler) credential(r *http.Request) (token string, path string) {
	path = r.URL.Path

	header := bearerOf(r.Header.Get("Authorization"))
	if header != "" {
		return header, path
	}

	// Anything after the mount point is the token: /mcp/<token>.
	rest := strings.TrimPrefix(path, h.path)
	rest = strings.Trim(rest, "/")

	if rest == "" {
		return "", h.path
	}

	// One segment only. A longer path is not a token with extra parts, it is a request for
	// something this server does not serve.
	if strings.Contains(rest, "/") {
		return "", h.path
	}

	return rest, h.path
}

// bearerOf reads "Bearer <token>", case-insensitively on the scheme.
//
// Written here rather than borrowed from san_auth because this file must not depend on the
// warehouse identity system: the credential is a per-run secret, and the day those two share a
// parser is the day somebody makes them share a token.
func bearerOf(header string) string {
	const prefix = "bearer "

	header = strings.TrimSpace(header)
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}

	return strings.TrimSpace(header[len(prefix):])
}

// setMCPCORS allows a browser-based agent to reach the endpoint.
//
// Mcp-Session-Id must be EXPOSED as well as allowed: it is a response header, and a browser
// client that cannot read it cannot continue its own session — which shows up as a client that
// re-initializes on every call and loses its state each time.
func setMCPCORS(w http.ResponseWriter) {
	header := w.Header()

	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	header.Set("Access-Control-Allow-Headers",
		"Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID")
	header.Set("Access-Control-Expose-Headers", "Mcp-Session-Id")
	header.Set("Access-Control-Max-Age", "86400")
}

// peerContextKey types the context value so nothing else can collide with it.
type peerContextKey struct{}

// withPeerRequest carries who is calling down to the tool handlers, which is what puts a real
// address on the operator's audit line instead of a blank field.
func withPeerRequest(r *http.Request) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), peerContextKey{}, peerOf(r)))
}

// peerFrom reads it back. Empty is fine — an audit line with no peer is still an audit line.
func peerFrom(ctx context.Context) string {
	peer, _ := ctx.Value(peerContextKey{}).(string)

	return peer
}

// peerOf prefers the forwarded address, because behind a tunnel RemoteAddr is the tunnel daemon
// on 127.0.0.1 and would make every caller look identical in the log.
func peerOf(r *http.Request) string {
	forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
	if forwarded != "" {
		return forwarded + " (via " + r.RemoteAddr + ")"
	}

	return r.RemoteAddr
}
