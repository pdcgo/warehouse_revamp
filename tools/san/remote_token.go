package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/tools/san/remote"
)

// defaultPersistedTokenTTL bounds a token that OUTLIVES its process.
//
// A run-lifetime token needs no deadline — Ctrl-C is the deadline. A persisted one has none, so
// without a TTL the default would be a permanent shell credential on disk. A month is long enough
// that a client configured once keeps working, and short enough that a URL leaked into a
// screenshot or a tunnel provider's log stops being a way in. `--token-ttl` overrides it, and
// `--new-token` rotates on demand.
const defaultPersistedTokenTTL = 30 * 24 * time.Hour

// tokenPlan is what the run decided about its credential, and why — the banner prints it, because
// "the token changed" is exactly the thing an operator must not have to guess about.
type tokenPlan struct {
	token *remote.Token

	// store is where the token is kept between runs — the default. Empty means the operator asked
	// for a credential that dies with the process (--no-persist-token), or supplied their own.
	store string

	// supplied is true when the operator handed the token in (--token / SAN_REMOTE_TOKEN). The
	// store plays no part in that case, in either direction.
	supplied bool

	// reused is true when this token came BACK from the store rather than being minted now: the
	// URL an agent already holds still works.
	reused bool

	// note explains a token the operator was not expecting — an expired store, an unreadable one.
	note string
}

// resolveRemoteToken decides this run's credential, in strict precedence.
//
//	--token / SAN_REMOTE_TOKEN   the operator supplied one, so nothing else gets a vote
//	the store                    a persisted token that is still good — the point of persisting
//	a fresh mint                 first run, an expired store, or --new-token
//
// A SUPPLIED token is never written to the store. It came from somewhere the operator already
// manages, and copying a secret to a second place is how one of the two copies goes stale.
func resolveRemoteToken(cmd *cli.Command, root string, now time.Time) (*tokenPlan, error) {
	// A supplied token is decided before anything else looks at the store — including the TTL,
	// which stays the operator's own business. Handing someone else's credential a 30-day deadline
	// it never asked for would expire a token this server does not own.
	supplied := strings.TrimSpace(cmd.String("token"))
	if supplied != "" {
		return &tokenPlan{
			token:    remote.NewToken(supplied, cmd.Duration("token-ttl"), now),
			supplied: true,
			note:     "--token was given, so the store was neither read nor written",
		}, nil
	}

	store := tokenStorePath(cmd, root)
	ttl := tokenTTL(cmd, store)

	// Naming a store and turning persistence off in the same command is a typo worth surfacing —
	// silently honouring one of them would leave the operator expecting a file that never appears.
	if store == "" && cmd.IsSet("token-store") {
		return nil, errors.New("--token-store and --no-persist-token contradict each other: pick one")
	}

	plan := &tokenPlan{store: store}

	if store != "" && !cmd.Bool("new-token") {
		token, err := remote.LoadToken(store, now)

		switch {
		case err == nil:
			plan.token = token
			plan.reused = true

			return plan, nil

		case errors.Is(err, remote.ErrNoStoredToken):
			// First run against this store. Nothing to say — a mint is the expected answer.

		case errors.Is(err, remote.ErrStoredTokenExpired):
			plan.note = "the stored token had expired — this is a NEW one, so re-paste it into any client holding the old"

		default:
			// An unreadable store is not a reason to refuse to start: the operator still gets a
			// working server, and a replaced file is recoverable where a failed startup at 2am is
			// merely annoying. It is loud, though.
			plan.note = fmt.Sprintf("the token store could not be read (%v) — it has been replaced", err)
		}
	}

	if store != "" && cmd.Bool("new-token") {
		plan.note = "--new-token: rotated, so any client holding the old one must be re-pasted"
	}

	token, err := remote.MintToken(ttl, now)
	if err != nil {
		return nil, err
	}

	plan.token = token

	err = remote.SaveToken(store, token, now)
	if err != nil {
		return nil, err
	}

	return plan, nil
}

// tokenStorePath answers where the credential is kept between runs, or "" when the operator asked
// for a token that dies with the process.
//
// Persisting is the DEFAULT because of who holds this token: a hosted MCP connector keeps the URL
// — token and all — in a settings screen, and a credential that changed on every restart would
// break that configuration silently, every time. A token per run is right when it is pasted into
// a terminal, which is now the case you opt into.
func tokenStorePath(cmd *cli.Command, root string) string {
	if cmd.Bool("no-persist-token") {
		return ""
	}

	path := strings.TrimSpace(cmd.String("token-store"))
	if path == "" {
		path = remote.DefaultTokenStorePath
	}

	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}

	// Relative to the WORKSPACE, not to the shell's working directory: `san remote --root X` run
	// from anywhere must reach the same store, or a second directory quietly gets a second token.
	return filepath.Join(root, path)
}

// tokenTTL gives a persisted token a deadline even when the operator did not ask for one.
func tokenTTL(cmd *cli.Command, store string) time.Duration {
	ttl := cmd.Duration("token-ttl")
	if ttl > 0 {
		return ttl
	}

	if store == "" {
		return 0
	}

	return defaultPersistedTokenTTL
}

// clientStoredToken is how `remote exec` and the file commands find the token when the operator
// did not paste one: the same store the server wrote.
//
// It returns "" for every failure. A client with no token gets the flag's own error message,
// which says what to do — a store-reading error at this point would be a worse one.
func clientStoredToken(cmd *cli.Command, now time.Time) string {
	root, err := remoteRoot(cmd)
	if err != nil {
		return ""
	}

	// "" here means --no-persist-token, and a client told not to persist must not go reading a
	// store either — LoadToken("") is ErrNoStoredToken, so this falls through to the flag's error.
	store := tokenStorePath(cmd, root)

	token, err := remote.LoadToken(store, now)
	if err != nil {
		return ""
	}

	return token.Value()
}

// writeTokenFile drops the token where a supervisor can read it — 0600, because a token in a
// world-readable file is a token every process on the box has.
//
// This is NOT the token store: it is a bare value, write-only, rewritten every run. The store
// carries the expiry too and is read back on the next start.
func writeTokenFile(path, token string) error {
	if path == "" {
		return nil
	}

	return os.WriteFile(path, []byte(token+"\n"), 0o600)
}

// printTokenStoreLines is the banner's answer to the one question a persisted token creates:
// is this the same credential as last time, or do I have to re-paste it?
//
// A run-lifetime token needs no such line — it is always new, and the operator knows it. A
// persisted one is usually the same and occasionally is not, and "occasionally" is exactly the
// case that must not be silent.
func printTokenStoreLines(plan *tokenPlan) {
	switch {
	case plan.supplied:
		// Nothing to say about a store that was not consulted — the note covers it.

	case plan.store == "":
		// Said out loud, because it is now the case the operator ASKED for: this token is gone
		// when the process is, and a client configured with it will need a new one.
		fmt.Fprintf(os.Stderr, "  stored     no (--no-persist-token) — this token dies with the server\n")

	default:
		state := "minted and stored"
		if plan.reused {
			state = "REUSED from the store — clients holding it still work"
		}

		fmt.Fprintf(os.Stderr, "  stored     %s\n", plan.store)
		fmt.Fprintf(os.Stderr, "             ↳ %s\n", state)
	}

	if plan.note != "" {
		fmt.Fprintf(os.Stderr, "             ⚠ %s\n", plan.note)
	}
}

// remoteRoot is the workspace every remote command works against — the flag, or where you stand.
//
// One implementation, because the SERVER's root and the CLIENT's root decide the same thing: which
// workspace's token store this invocation belongs to. Two copies would eventually disagree, and a
// client looking in a different directory than the server wrote to fails as "no token", which
// reads as a missing credential rather than a missing directory.
func remoteRoot(cmd *cli.Command) (string, error) {
	root := strings.TrimSpace(cmd.String("root"))
	if root != "" {
		return root, nil
	}

	return os.Getwd()
}
