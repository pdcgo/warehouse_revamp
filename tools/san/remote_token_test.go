package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/tools/san/remote"
)

// These drive the FLAGS, not the functions, because the thing under test is the precedence an
// operator types: --token beats the store, the store beats a mint, --new-token beats the store.

// planFor runs the resolution the way `san remote …` does, without starting a server.
func planFor(t *testing.T, root string, args ...string) *tokenPlan {
	t.Helper()

	var plan *tokenPlan

	cmd := &cli.Command{
		Name:  "remote",
		Flags: remoteFlags(),
		Action: func(_ context.Context, c *cli.Command) error {
			var err error

			plan, err = resolveRemoteToken(c, root, time.Now())

			return err
		},
	}

	err := cmd.Run(context.Background(), append([]string{"remote"}, args...))
	if err != nil {
		t.Fatalf("resolving the token: %v", err)
	}

	return plan
}

// The default, and the reason for it: a client holds this token as configuration, so a restart
// must not invalidate it.
func TestTheTokenSurvivesARestartByDefault(t *testing.T) {
	root := t.TempDir()

	first := planFor(t, root)
	if first.reused {
		t.Fatal("the first run reused a token from an empty store")
	}

	second := planFor(t, root)
	if !second.reused {
		t.Fatal("the second run minted a new token instead of reusing the stored one")
	}

	if second.token.Value() != first.token.Value() {
		t.Fatalf("the token changed across a restart: %q then %q", first.token.Value(), second.token.Value())
	}
}

// The opt-out must be a real opt-out: nothing minted, nothing kept, nothing written.
func TestNoPersistTokenMintsAFreshOneEveryRun(t *testing.T) {
	root := t.TempDir()

	first := planFor(t, root, "--no-persist-token")
	second := planFor(t, root, "--no-persist-token")

	if first.token.Value() == second.token.Value() {
		t.Fatal("two runs shared a token under --no-persist-token")
	}

	if first.store != "" {
		t.Fatalf("a store was used despite --no-persist-token: %s", first.store)
	}

	// No store means no deadline is needed: stopping the process IS the deadline.
	if !first.token.ExpiresAt().IsZero() {
		t.Fatal("a run-lifetime token was given an expiry")
	}

	_, err := os.Stat(filepath.Join(root, remote.DefaultTokenStorePath))
	if err == nil {
		t.Fatal("a token file was written despite --no-persist-token")
	}
}

// The two flags cancel out, and a command that means two opposite things is a typo — surfaced,
// never silently resolved in favour of one of them.
func TestNoPersistTokenAndTokenStoreRefuseEachOther(t *testing.T) {
	cmd := &cli.Command{
		Name:  "remote",
		Flags: remoteFlags(),
		Action: func(_ context.Context, c *cli.Command) error {
			_, err := resolveRemoteToken(c, t.TempDir(), time.Now())

			return err
		},
	}

	err := cmd.Run(context.Background(), []string{
		"remote", "--no-persist-token", "--token-store", filepath.Join(t.TempDir(), "t.json"),
	})
	if err == nil {
		t.Fatal("--no-persist-token with --token-store was accepted")
	}
}

func TestNewTokenRotatesAStoredOne(t *testing.T) {
	root := t.TempDir()

	first := planFor(t, root)
	rotated := planFor(t, root, "--new-token")

	if rotated.token.Value() == first.token.Value() {
		t.Fatal("--new-token handed back the stored token")
	}

	if rotated.note == "" {
		t.Fatal("--new-token rotated silently — the operator must be told to re-paste")
	}

	// And the rotation STICKS: the next plain run gets the new one, not the one it replaced.
	after := planFor(t, root)
	if after.token.Value() != rotated.token.Value() {
		t.Fatal("the rotated token was not written back to the store")
	}
}

// A supplied token is the operator's own credential. Copying it into the store would create a
// second copy to go stale, and it is not ours to write down.
func TestASuppliedTokenWinsAndIsNeverStored(t *testing.T) {
	root := t.TempDir()

	plan := planFor(t, root, "--token", "supplied-not-a-secret")

	if plan.token.Value() != "supplied-not-a-secret" {
		t.Fatalf("--token was ignored, got %q", plan.token.Value())
	}

	if plan.store != "" {
		t.Fatalf("a supplied token named a store: %s", plan.store)
	}

	_, err := os.Stat(filepath.Join(root, remote.DefaultTokenStorePath))
	if err == nil {
		t.Fatal("a supplied token was written to the store")
	}
}

// A persisted token with no deadline is a permanent shell credential sitting in a file.
func TestPersistingGivesTheTokenADeadline(t *testing.T) {
	root := t.TempDir()

	plan := planFor(t, root)
	if plan.token.ExpiresAt().IsZero() {
		t.Fatal("a persisted token has no expiry")
	}

	explicit := planFor(t, t.TempDir(), "--token-ttl", "2h")

	within := explicit.token.ExpiresAt().Sub(time.Now().Add(2 * time.Hour))
	if within > time.Minute || within < -time.Minute {
		t.Fatalf("--token-ttl was not honoured: expiry is %s", explicit.token.ExpiresAt())
	}
}

// The path is an override, not a switch — the store exists either way.
func TestTokenStoreOverridesThePath(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(t.TempDir(), "elsewhere.json")

	plan := planFor(t, root, "--token-store", path)
	if plan.store != path {
		t.Fatalf("--token-store went to %q, want %q", plan.store, path)
	}

	_, err := os.Stat(path)
	if err != nil {
		t.Fatalf("--token-store did not write the store: %v", err)
	}
}

// The store follows the WORKSPACE, so `san remote --root X` run from two different shells reaches
// one credential rather than two.
func TestARelativeStoreIsResolvedAgainstTheRoot(t *testing.T) {
	root := t.TempDir()

	plan := planFor(t, root, "--token-store", "sub/token.json")

	want := filepath.Join(root, "sub", "token.json")
	if plan.store != want {
		t.Fatalf("store resolved to %q, want %q", plan.store, want)
	}
}

// An unreadable store must not stop a server starting — it is replaced, loudly.
func TestACorruptStoreIsReplacedNotFatal(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "token.json")

	err := os.WriteFile(path, []byte("{ this is not json"), 0o600)
	if err != nil {
		t.Fatalf("writing: %v", err)
	}

	plan := planFor(t, root, "--token-store", path)

	if plan.token.Value() == "" {
		t.Fatal("no token was minted over the corrupt store")
	}

	if plan.note == "" {
		t.Fatal("a corrupt store was replaced silently")
	}

	reread := planFor(t, root, "--token-store", path)
	if !reread.reused {
		t.Fatal("the replacement store is itself unreadable")
	}
}

// An expired store is the one case where the operator's URL stops working, so the banner must say
// why rather than leaving them to compare two 43-character strings.
func TestAnExpiredStoreExplainsTheNewToken(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "token.json")

	stale, err := remote.MintToken(time.Hour, time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = remote.SaveToken(path, stale, time.Now().Add(-2*time.Hour))
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	plan := planFor(t, root, "--token-store", path)

	if plan.token.Value() == stale.Value() {
		t.Fatal("an expired token was handed back")
	}

	if plan.note == "" {
		t.Fatal("an expired store was replaced silently")
	}
}
