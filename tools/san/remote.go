package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"
	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/tools/san/remote"
)

const defaultRemoteAddr = "127.0.0.1:8099"

// remoteCommand serves this checkout to a coding agent.
//
// `san remote` on its own serves, because that is the whole verb — `serve` exists as an explicit
// spelling and `exec` is the client you reach for to check the server by hand.
func remoteCommand() *cli.Command {
	return &cli.Command{
		Name:      "remote",
		Usage:     "serve this checkout to a coding agent — Connect RPC and MCP",
		ArgsUsage: " ",
		Description: "Runs a server that executes shell commands in this workspace and STREAMS\n" +
			"their output back, so an AI agent working on this project from elsewhere sees a\n" +
			"build fail as it fails rather than when it finishes.\n\n" +
			"IT SERVES TWO FACES ON ONE PORT. Connect RPC is for a client we write. MCP, at\n" +
			"/mcp, is for the clients we do not — Claude on the web, a browser agent, somebody\n" +
			"else's harness — which reach it through a tunnel and need no code on their side.\n" +
			"Pass --public-url when you put a tunnel in front, or MCP will refuse every\n" +
			"request.\n\n" +
			"THE TOKEN BELONGS TO THE WORKSPACE, NOT TO THE RUN. It is kept in\n" +
			"" + remote.DefaultTokenStorePath + " and reused, so restarting the server does not\n" +
			"invalidate the URL a client already holds — a hosted MCP connector stores that URL as\n" +
			"configuration, and a token that changed on every restart would break it silently. It\n" +
			"expires after 30 days, and --new-token rotates it on demand.\n\n" +
			"IT IS THE ONLY THING AUTHORIZING A CALLER — hand it to the agent and to nothing else.\n" +
			"--no-persist-token goes back to a per-run credential that dies with the process.\n\n" +
			"⚠ THIS IS NOT A SANDBOX. Whoever holds the token can run whatever you can run. The\n" +
			"server binds to loopback for that reason; exposing it further is a decision to make\n" +
			"deliberately, and behind a tunnel rather than an open port.",
		// Declared on the parent so they are persistent: `san remote --addr X` and
		// `san remote serve --addr X` are the same command with the same flags.
		Flags:  remoteFlags(),
		Action: runRemoteServe,
		Commands: []*cli.Command{
			remoteServeCommand(),
			remoteMCPCommand(),
			remoteRefreshTokenCommand(),
			remoteExecCommand(),
			remoteGetCommand(),
			remotePutCommand(),
		},
	}
}

func remoteFlags() []cli.Flag {
	return []cli.Flag{
		&cli.StringFlag{
			Name:  "addr",
			Value: defaultRemoteAddr,
			Usage: "listen address; anything other than loopback is announced loudly",
		},
		&cli.StringFlag{
			Name:  "root",
			Usage: "workspace root a command runs in (default: the current directory)",
		},
		&cli.StringFlag{
			Name:  "shell",
			Usage: `shell argv, e.g. "sh -c" or "bash -lc" (default: sh -c, or PowerShell on Windows)`,
		},
		&cli.StringFlag{
			Name:    "token",
			Sources: cli.EnvVars("SAN_REMOTE_TOKEN"),
			Usage:   "use THIS token instead of minting one; also what `remote exec` presents",
		},
		&cli.StringFlag{
			Name:  "token-file",
			Usage: "also write the token here (0600) so a supervisor can pick it up",
		},
		&cli.BoolFlag{
			Name: "no-persist-token",
			Usage: "do NOT keep the token — mint one for this run only, so the access dies with " +
				"the process",
		},
		&cli.StringFlag{
			Name:    "token-store",
			Sources: cli.EnvVars("SAN_REMOTE_TOKEN_STORE"),
			Value:   remote.DefaultTokenStorePath,
			Usage:   "where the token is kept between runs, relative to the workspace root",
		},
		&cli.BoolFlag{
			Name:  "new-token",
			Usage: "mint a fresh token even when a persisted one is still valid — the rotation",
		},
		&cli.DurationFlag{
			Name: "token-ttl",
			Usage: "how long the token stays valid (default: 30 days, or as long as the server " +
				"under --no-persist-token)",
		},
		&cli.DurationFlag{
			Name:  "exec-timeout",
			Value: remote.DefaultExecTimeout,
			Usage: "how long a command may run when the request does not say",
		},
		&cli.DurationFlag{
			Name:  "max-exec-timeout",
			Value: remote.MaxExecTimeout,
			Usage: "ceiling on what a request may ask for",
		},
		&cli.StringFlag{
			Name:  "mcp-path",
			Value: remote.DefaultMCPPath,
			Usage: "where the MCP endpoint is mounted, on the same port as the RPCs",
		},
		&cli.BoolFlag{
			Name:  "no-mcp",
			Usage: "serve the Connect RPCs only, with no MCP endpoint",
		},
		&cli.StringFlag{
			Name:    "public-url",
			Sources: cli.EnvVars("SAN_REMOTE_PUBLIC_URL"),
			Usage: "the tunnel's URL, e.g. https://devel.example.com — REQUIRED when tunnelling: " +
				"it is what tells the MCP endpoint a non-loopback Host header is expected",
		},
	}
}

func remoteServeCommand() *cli.Command {
	return &cli.Command{
		Name:      "serve",
		Usage:     "start the server (the same thing `san remote` does)",
		ArgsUsage: " ",
		Action:    runRemoteServe,
	}
}

// remoteMCPCommand serves the MCP endpoint and NOTHING ELSE.
//
// It exists because that is the case with an audience: a hosted agent behind a tunnel speaks MCP
// and will never call a Connect RPC, so serving the RPCs alongside it publishes a second, unused
// surface on the one address that is deliberately reachable from the internet. `san remote mcp`
// exposes exactly what the far side can use.
//
// The mirror image is already there: `san remote --no-mcp` is the RPC-only spelling.
func remoteMCPCommand() *cli.Command {
	return &cli.Command{
		Name:      "mcp",
		Usage:     "serve ONLY the MCP endpoint — for a hosted agent behind a tunnel",
		ArgsUsage: " ",
		Description: "Serves this checkout as MCP tools and nothing else: no Connect RPCs, no gRPC\n" +
			"reflection. Use it when the caller is a client we did not write — Claude on the\n" +
			"web, a browser agent, somebody else's harness — which reaches this machine\n" +
			"through a tunnel and needs no code on its side.\n\n" +
			"IT PRINTS A FRESH TOKEN, once, at startup. That token is the only thing\n" +
			"authorizing a caller, and it is what you give the outside environment.\n\n" +
			"⚠ PASS --public-url WHEN YOU TUNNEL. Without it every request is refused with 403\n" +
			"and nothing says why — see `san remote mcp --help` output below and\n" +
			"docs/tools/san.md.\n\n" +
			"⚠ THIS IS NOT A SANDBOX. Whoever holds the token can run whatever you can run.",
		Action: runRemoteMCP,
	}
}

// remoteFaces is which of the two surfaces this run serves.
//
// They are separate booleans rather than one enum because the two are genuinely independent: the
// RPCs without MCP is `--no-mcp`, MCP without the RPCs is `san remote mcp`, and both together is
// the bare `san remote`. An enum would make the third case look like a third kind of server
// rather than what it is — the union of the other two on one port.
type remoteFaces struct {
	connect bool
	mcp     bool
}

// runRemoteServe is `san remote` / `san remote serve`: both faces on one port.
func runRemoteServe(ctx context.Context, cmd *cli.Command) error {
	return serveRemote(ctx, cmd, remoteFaces{
		connect: true,
		mcp:     !cmd.Bool("no-mcp"),
	})
}

// runRemoteMCP is `san remote mcp`: the MCP endpoint alone.
func runRemoteMCP(ctx context.Context, cmd *cli.Command) error {
	// --no-mcp here asks for a server with no faces at all. Refused rather than resolved, because
	// either reading of it is a surprise: honouring it serves nothing, ignoring it silently
	// contradicts a flag the operator typed on purpose.
	if cmd.Bool("no-mcp") {
		return errors.New("san remote mcp: --no-mcp contradicts the command — use `san remote --no-mcp` for the RPCs alone")
	}

	return serveRemote(ctx, cmd, remoteFaces{mcp: true})
}

// serveRemote deliberately does NOT go through withSan.
//
// It is the first san command that touches no database, so prompting Local/Production for it
// would ask an operator to answer a question that has no bearing on what happens next — and
// would mean a shell server could not start without a Postgres running.
func serveRemote(ctx context.Context, cmd *cli.Command, faces remoteFaces) error {
	root, err := remoteRoot(cmd)
	if err != nil {
		return err
	}

	now := time.Now()

	plan, err := resolveRemoteToken(cmd, root, now)
	if err != nil {
		return err
	}

	token := plan.token

	audit := slog.New(slog.NewTextHandler(os.Stderr, nil))

	service, err := remote.NewService(remote.Config{
		Root:           root,
		Shell:          remote.ParseShell(cmd.String("shell")),
		DefaultTimeout: cmd.Duration("exec-timeout"),
		MaxTimeout:     cmd.Duration("max-exec-timeout"),
		TokenExpiresAt: token.ExpiresAt(),
		Audit:          audit,
	})
	if err != nil {
		return err
	}

	err = writeTokenFile(cmd.String("token-file"), token.Value())
	if err != nil {
		return err
	}

	mux := http.NewServeMux()

	if faces.connect {
		// protovalidate runs BEFORE the token check for the same reason it does on the server: the
		// contract's own rules are one place, and re-typing max_len as an `if` here would create a
		// second limit free to drift from the proto.
		opts := connect.WithInterceptors(
			validate.NewInterceptor(),
			remote.NewAuthInterceptor(token, time.Now),
		)

		san_grpc.Register(mux, remote.NewRegister(mux, service, opts))
	}

	publicURL := strings.TrimRight(strings.TrimSpace(cmd.String("public-url")), "/")

	var mcpPath string

	if faces.mcp {
		mcpPath = mountMCP(mux, cmd, service, token, publicURL, audit)
	}

	addr := cmd.String("addr")

	// h2c the supported way — net/http has spoken unencrypted HTTP/2 natively since Go 1.24, and
	// x/net/http2/h2c is deprecated (HARD RULE 5).
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	srv := &http.Server{
		Addr:      addr,
		Handler:   mux,
		Protocols: protocols,

		// No write timeout, on purpose: the whole point is a stream that stays open for the length
		// of a build. ReadHeaderTimeout still guards the slow-header case.
		ReadHeaderTimeout: 10 * time.Second,
	}

	printRemoteBanner(service, addr, plan, faces, mcpPath, publicURL)

	// Bind BEFORE announcing readiness, so "address already in use" is an error at startup rather
	// than an agent connecting to somebody else's server on that port.
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	go func() {
		<-ctx.Done()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_ = srv.Shutdown(shutdownCtx)
	}()

	err = srv.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}

	return err
}

// mountMCP puts the MCP endpoint on the SAME mux and the same port as the Connect RPCs, and
// returns the path it used ("" when the operator turned it off).
//
// One port, because there is one tunnel. A second listener would mean a second hostname to
// publish, a second thing to remember to expose, and a second way to expose the wrong one.
//
// The two faces cannot collide: Connect routes on /<proto package>.<Service>/<Method>, which
// always contains a dot, and reflection has its own fully-qualified path.
func mountMCP(
	mux *http.ServeMux,
	cmd *cli.Command,
	service *remote.Service,
	token *remote.Token,
	publicURL string,
	audit *slog.Logger,
) string {
	path := strings.TrimSuffix(strings.TrimSpace(cmd.String("mcp-path")), "/")
	if path == "" {
		path = remote.DefaultMCPPath
	}

	handler := remote.NewMCPHandler(service, token, remote.MCPConfig{
		Path: path,

		// A public URL IS the declaration that a tunnel is in front — see MCPConfig.BehindTunnel.
		// Inferring it from the request's shape instead would mean silently dropping a rebinding
		// guard whenever somebody sent a Host header, which is not a decision to make on a
		// caller's behalf.
		BehindTunnel: publicURL != "",
		Audit:        audit,
	})

	// Both, because /mcp and /mcp/<token> are the two ways in and ServeMux treats a trailing
	// slash as a different pattern.
	mux.Handle(path, handler)
	mux.Handle(path+"/", handler)

	return path
}

// printRemoteBanner is the operator's whole view of what they just opened.
func printRemoteBanner(
	service *remote.Service,
	addr string,
	plan *tokenPlan,
	faces remoteFaces,
	mcpPath string,
	publicURL string,
) {
	token := plan.token

	expiry := "when this server stops"
	if !token.ExpiresAt().IsZero() {
		// .Local(), because the store round-trips UTC and a minted token carries the local zone —
		// printing them raw makes a reused token's expiry look like a different kind of deadline.
		expiry = token.ExpiresAt().Local().Format(time.RFC3339)
	}

	// The heading names WHICH command is running, because the two serve different surfaces and an
	// operator scrolling back through a terminal should not have to infer that from what follows.
	name := "san remote"
	if !faces.connect {
		name = "san remote mcp"
	}

	fmt.Fprintf(os.Stderr, "\n%s — serving %s\n", name, service.Root())
	fmt.Fprintf(os.Stderr, "  address    %s\n", addr)
	fmt.Fprintf(os.Stderr, "  shell      %s\n", strings.Join(service.Shell(), " "))
	fmt.Fprintf(os.Stderr, "  token      %s\n", token.Value())
	fmt.Fprintf(os.Stderr, "  expires    %s\n", expiry)

	printTokenStoreLines(plan)

	fmt.Fprintf(os.Stderr, "\n")

	// The RPC client is only worth suggesting when the RPCs are actually being served — pointing
	// at `remote exec` from an MCP-only server sends the operator to a connection refused.
	if faces.connect {
		// No --token in the suggestion when the token is stored: the client reads the same store,
		// and printing the flag anyway would teach a step that is no longer needed.
		auth := " --token " + token.Value()
		if plan.store != "" {
			auth = ""
		}

		fmt.Fprintf(os.Stderr, "  try it:    go run ./tools/san remote exec%s -- \"go build ./...\"\n\n", auth)
	}

	printMCPBanner(addr, token, mcpPath, publicURL)

	if !isLoopback(addr) {
		fmt.Fprintf(os.Stderr,
			"  ⚠ %s IS NOT LOOPBACK. Anyone who can reach this port and holds the token has a\n"+
				"    shell on this machine. Prefer an SSH tunnel to an open port.\n\n", addr)
	}
}

// printMCPBanner is the half of the banner an operator actually copies out of.
//
// It prints the URL for BOTH kinds of client, because which one you need is decided by the client
// and not by the server: a locally-configured agent takes a URL plus a header, and a hosted one
// takes a URL and nothing else. Printing only the first would leave the case this endpoint was
// built for looking unsupported.
func printMCPBanner(addr string, token *remote.Token, mcpPath, publicURL string) {
	if mcpPath == "" {
		fmt.Fprintf(os.Stderr, "  mcp        off (--no-mcp)\n\n")

		return
	}

	local := "http://" + addr + mcpPath

	fmt.Fprintf(os.Stderr, "  mcp        %s\n", local)
	fmt.Fprintf(os.Stderr, "             ↳ with a header:  Authorization: Bearer %s\n", token.Value())

	if publicURL == "" {
		fmt.Fprintf(os.Stderr,
			"\n  ⚠ NO --public-url. Tunnel this and every MCP request will be refused with 403:\n"+
				"    the endpoint drops its DNS-rebinding guard only when you name the public URL.\n"+
				"    Restart with --public-url https://your.tunnel.example.com\n\n")

		return
	}

	// The token is IN this URL on purpose — it is the only form a hosted client can accept. The
	// warning below is the price, and it is printed every single time rather than documented once.
	fmt.Fprintf(os.Stderr, "             ↳ url only:       %s%s/%s\n\n", publicURL, mcpPath, token.Value())
	fmt.Fprintf(os.Stderr,
		"  ⚠ That second URL CONTAINS THE TOKEN. Anyone who reads it — a screenshot, a browser\n"+
			"    history, your tunnel provider's access log — has a shell on this machine until you\n"+
			"    stop this server.\n\n")
}

// isLoopback answers for the HOST half of the listen address. An empty host means every
// interface, which is the case worth warning about most and the easiest one to type by accident.
func isLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}

	if host == "" {
		return false
	}

	if host == "localhost" {
		return true
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}

	return ip.IsLoopback()
}
