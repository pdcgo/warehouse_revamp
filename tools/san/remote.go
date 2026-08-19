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
		Usage:     "serve this checkout to a coding agent over Connect RPC",
		ArgsUsage: " ",
		Description: "Runs an RPC server that executes shell commands in this workspace and STREAMS\n" +
			"their output back, so an AI agent working on this project from elsewhere sees a\n" +
			"build fail as it fails rather than when it finishes.\n\n" +
			"EVERY RUN MINTS A FRESH TOKEN. It is printed once, at startup, and it is the only\n" +
			"thing authorizing a caller — hand it to the agent and to nothing else. Stopping the\n" +
			"server ends the access.\n\n" +
			"⚠ THIS IS NOT A SANDBOX. Whoever holds the token can run whatever you can run. The\n" +
			"server binds to loopback for that reason; exposing it further is a decision to make\n" +
			"deliberately, and behind a tunnel rather than an open port.",
		// Declared on the parent so they are persistent: `san remote --addr X` and
		// `san remote serve --addr X` are the same command with the same flags.
		Flags:    remoteFlags(),
		Action:   runRemoteServe,
		Commands: []*cli.Command{remoteServeCommand(), remoteExecCommand()},
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
		&cli.DurationFlag{
			Name:  "token-ttl",
			Usage: "expire the token after this long (default: it lives as long as the server)",
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

// runRemoteServe deliberately does NOT go through withSan.
//
// It is the first san command that touches no database, so prompting Local/Production for it
// would ask an operator to answer a question that has no bearing on what happens next — and
// would mean a shell server could not start without a Postgres running.
func runRemoteServe(ctx context.Context, cmd *cli.Command) error {
	root := cmd.String("root")
	if root == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return err
		}

		root = cwd
	}

	now := time.Now()
	ttl := cmd.Duration("token-ttl")

	token, err := resolveRemoteToken(cmd.String("token"), ttl, now)
	if err != nil {
		return err
	}

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

	// protovalidate runs BEFORE the token check for the same reason it does on the server: the
	// contract's own rules are one place, and re-typing max_len as an `if` here would create a
	// second limit free to drift from the proto.
	opts := connect.WithInterceptors(
		validate.NewInterceptor(),
		remote.NewAuthInterceptor(token, time.Now),
	)

	san_grpc.Register(mux, remote.NewRegister(mux, service, opts))

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

	printRemoteBanner(service, addr, token)

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

// resolveRemoteToken mints unless the operator supplied one.
func resolveRemoteToken(supplied string, ttl time.Duration, now time.Time) (*remote.Token, error) {
	supplied = strings.TrimSpace(supplied)
	if supplied != "" {
		return remote.NewToken(supplied, ttl, now), nil
	}

	return remote.MintToken(ttl, now)
}

// writeTokenFile drops the token where a supervisor can read it — 0600, because a token in a
// world-readable file is a token every process on the box has.
func writeTokenFile(path, token string) error {
	if path == "" {
		return nil
	}

	return os.WriteFile(path, []byte(token+"\n"), 0o600)
}

// printRemoteBanner is the operator's whole view of what they just opened.
func printRemoteBanner(service *remote.Service, addr string, token *remote.Token) {
	expiry := "when this server stops"
	if !token.ExpiresAt().IsZero() {
		expiry = token.ExpiresAt().Format(time.RFC3339)
	}

	fmt.Fprintf(os.Stderr, "\nsan remote — serving %s\n", service.Root())
	fmt.Fprintf(os.Stderr, "  address    %s\n", addr)
	fmt.Fprintf(os.Stderr, "  shell      %s\n", strings.Join(service.Shell(), " "))
	fmt.Fprintf(os.Stderr, "  token      %s\n", token.Value())
	fmt.Fprintf(os.Stderr, "  expires    %s\n\n", expiry)
	fmt.Fprintf(os.Stderr, "  try it:    go run ./tools/san remote exec --token %s -- \"go build ./...\"\n\n", token.Value())

	if !isLoopback(addr) {
		fmt.Fprintf(os.Stderr,
			"  ⚠ %s IS NOT LOOPBACK. Anyone who can reach this port and holds the token has a\n"+
				"    shell on this machine. Prefer an SSH tunnel to an open port.\n\n", addr)
	}
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
