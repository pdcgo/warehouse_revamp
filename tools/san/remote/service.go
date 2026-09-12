// Package remote implements san.remote.v1.RemoteService — the RPC server behind `san remote`.
//
// It exists to let an AI coding agent work in this checkout from somewhere else: it runs a shell
// command and streams the output back as the command produces it, so the agent sees a build fail
// on line 40 instead of waiting for the whole run.
//
// # It is NOT a sandbox
//
// Whoever holds the token can run whatever the operator can run. The workspace root stops a
// mistyped path, not a determined caller — the command itself can `cd` anywhere. The real
// protection is the credential and the bind address: a fresh token per run, printed once, and
// loopback by default.
//
// # Why it lives HERE and not in backend/services/
//
// Every warehouse service lives in backend/services/<name>_service/ and is mounted into the
// application mux by service_api.go. This one must never be — a shell belongs nowhere near the
// process serving customers. Keeping it inside the operations tool makes that structural rather
// than a rule somebody has to remember: it sits outside the tree services are wired from, so
// mounting it on the app would take an import from backend/ up into tools/, which is exactly the
// kind of line that stops a reviewer.
package remote

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1/remotev1connect"
)

// Config is what the CLI hands the service. Every field is an operator's decision made at
// `san remote serve` time, which is why none of them are read from the environment here.
type Config struct {
	// Root is the workspace. Every ExecRequest.working_dir is resolved inside it.
	Root string

	// Shell is the argv a command is appended to — ["sh", "-c"], ["pwsh", …, "-Command"].
	Shell []string

	// DefaultTimeout applies when a request asks for 0. MaxTimeout is the ceiling a request
	// cannot exceed, so a caller can never pin a process open forever.
	DefaultTimeout time.Duration
	MaxTimeout     time.Duration

	// TokenExpiresAt is reported by Info so an agent can renew before it is cut off. Zero means
	// the token lives as long as this process.
	TokenExpiresAt time.Time

	// Audit is the OPERATOR's log — every command that runs is written here, on the terminal
	// they started the server from. It is deliberately separate from the per-run log that goes
	// down the stream: a person watching the server must see what the agent did without reading
	// the agent's own output.
	Audit *slog.Logger
}

type Service struct {
	root           string
	shell          []string
	defaultTimeout time.Duration
	maxTimeout     time.Duration
	tokenExpiresAt time.Time
	audit          *slog.Logger
}

// compile-time proof Service satisfies the generated handler interface.
var _ remotev1connect.RemoteServiceHandler = (*Service)(nil)

const (
	// DefaultExecTimeout is long enough for a cold `go build ./...` or an `npm ci`, short enough
	// that a hung command does not sit there until somebody notices.
	DefaultExecTimeout = 10 * time.Minute

	// MaxExecTimeout is the ceiling on what a request may ask for.
	MaxExecTimeout = time.Hour
)

// replacement stands in for a byte that is not valid UTF-8.
const replacement = "�"

func NewService(cfg Config) (*Service, error) {
	if len(cfg.Shell) == 0 {
		return nil, errors.New("remote: no shell configured")
	}

	root, err := filepath.Abs(cfg.Root)
	if err != nil {
		return nil, fmt.Errorf("remote: resolving workspace root: %w", err)
	}

	// Resolve symlinks ONCE, here, so containment later compares like with like. On macOS a cwd
	// of /tmp/x is really /private/tmp/x, and a root that still said /tmp would reject every
	// path built from the resolved one.
	resolved, err := filepath.EvalSymlinks(root)
	if err == nil {
		root = resolved
	}

	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("remote: workspace root %s: %w", root, err)
	}

	if !info.IsDir() {
		return nil, fmt.Errorf("remote: workspace root %s is not a directory", root)
	}

	svc := &Service{
		root:           root,
		shell:          append([]string(nil), cfg.Shell...),
		defaultTimeout: cfg.DefaultTimeout,
		maxTimeout:     cfg.MaxTimeout,
		tokenExpiresAt: cfg.TokenExpiresAt,
		audit:          cfg.Audit,
	}

	if svc.defaultTimeout <= 0 {
		svc.defaultTimeout = DefaultExecTimeout
	}

	if svc.maxTimeout <= 0 {
		svc.maxTimeout = MaxExecTimeout
	}

	// A default above the ceiling would make every 0-timeout request silently exceed a limit the
	// operator set. The ceiling wins.
	if svc.defaultTimeout > svc.maxTimeout {
		svc.defaultTimeout = svc.maxTimeout
	}

	if svc.audit == nil {
		svc.audit = slog.Default()
	}

	return svc, nil
}

// Root is the resolved workspace root — the CLI prints it in its banner, so the operator sees
// what the server actually resolved rather than what they typed.
func (s *Service) Root() string { return s.root }

// Shell is the resolved shell argv.
func (s *Service) Shell() []string { return append([]string(nil), s.shell...) }

// timeoutFor caps rather than refuses. A caller asking for two hours on a one-hour server has
// made an estimate, not an error — refusing would waste the run it was about to do, and the
// ceiling is enforced either way.
func (s *Service) timeoutFor(requested uint32) time.Duration {
	if requested == 0 {
		return s.defaultTimeout
	}

	timeout := time.Duration(requested) * time.Second
	if timeout > s.maxTimeout {
		return s.maxTimeout
	}

	return timeout
}

// sender serialises writes to the stream.
//
// connect's ServerStream.Send is NOT safe for concurrent use, and this handler has three writers
// — the stdout pump, the stderr pump, and the slog handler. Without the mutex the interleaving is
// a data race that shows up as a corrupted frame under load and never in a test.
type sender struct {
	mu     sync.Mutex
	stream *connect.ServerStream[remotev1.ExecResponse]
}

// text sends one frame of output.
//
// The text is forced to valid UTF-8 first. proto3 strings must be valid UTF-8 and command output
// is under no such obligation — a single stray byte from a compiler's coloured output would fail
// the marshal and kill a run that was otherwise fine.
func (s *sender) text(body string, kind remotev1.ExecStream) error {
	if body == "" {
		return nil
	}

	return s.send(&remotev1.ExecResponse{
		Message: strings.ToValidUTF8(body, replacement),
		Stream:  kind,
	})
}

// finish sends the FINAL frame — the one carrying the result, which is how a caller knows the run
// is over rather than merely quiet.
func (s *sender) finish(body string, result *remotev1.ExecResult) error {
	return s.send(&remotev1.ExecResponse{
		Message: strings.ToValidUTF8(body, replacement),
		Stream:  remotev1.ExecStream_EXEC_STREAM_SYSTEM,
		Result:  result,
	})
}

func (s *sender) send(msg *remotev1.ExecResponse) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.stream.Send(msg)
}

// trailingPartial reports how many bytes at the end of b belong to a rune that is not finished
// yet, so a pump can hold them back for the next read.
//
// Output arrives in fixed-size reads, and a 32KB boundary lands in the middle of a multi-byte
// rune often enough to matter — every box-drawing character in a test runner's output is three
// bytes. Without this, ToValidUTF8 would replace both halves and the caller would see two
// replacement characters where there was one glyph.
func trailingPartial(b []byte) int {
	for back := 1; back <= utf8.UTFMax && back <= len(b); back++ {
		lead := b[len(b)-back]

		if !utf8.RuneStart(lead) {
			continue
		}

		size := runeLen(lead)
		if size > back {
			return back
		}

		return 0
	}

	return 0
}

// runeLen is the encoded length a lead byte promises.
func runeLen(lead byte) int {
	switch {
	case lead < 0x80:
		return 1

	case lead&0xE0 == 0xC0:
		return 2

	case lead&0xF0 == 0xE0:
		return 3

	case lead&0xF8 == 0xF0:
		return 4

	default:
		// Not a lead byte at all; treat it as complete so it becomes one replacement character
		// rather than being carried forever.
		return 1
	}
}
