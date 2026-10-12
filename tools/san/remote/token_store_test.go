package remote

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// The store exists for ONE property: the same token comes back next run. Every test here is a
// restart — write, then read as if the process had been stopped and started.

func TestSaveThenLoadReturnsTheSameToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	minted, err := MintToken(24*time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, minted, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	loaded, err := LoadToken(path, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}

	if loaded.Value() != minted.Value() {
		t.Fatalf("a restart got a different token: %q, want %q", loaded.Value(), minted.Value())
	}

	// The whole point of persisting: the credential the far side already holds still verifies.
	err = loaded.Verify(minted.Value(), now.Add(time.Hour))
	if err != nil {
		t.Fatalf("the reused token no longer verifies: %v", err)
	}
}

// The deadline must be the one that was WRITTEN. Re-stamping it as now+ttl on each load would let
// a daily-restarted server carry one token forever.
func TestLoadKeepsTheORIGINALExpiry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	minted, err := MintToken(48*time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, minted, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	loaded, err := LoadToken(path, now.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}

	if !loaded.ExpiresAt().Equal(minted.ExpiresAt().UTC()) {
		t.Fatalf("expiry slid to %s, want the stored %s", loaded.ExpiresAt(), minted.ExpiresAt().UTC())
	}
}

func TestLoadRefusesAnExpiredToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	minted, err := MintToken(time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, minted, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	_, err = LoadToken(path, now.Add(2*time.Hour))
	if !errors.Is(err, ErrStoredTokenExpired) {
		t.Fatalf("an expired store gave %v, want ErrStoredTokenExpired", err)
	}
}

// A token with seconds left is worse than no token: it is pasted into a client that then dies
// mid-command for a reason nothing on screen explains.
func TestLoadRefusesATokenInsideTheRefreshMargin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	minted, err := MintToken(time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, minted, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	almost := now.Add(time.Hour - TokenRefreshMargin/2)

	_, err = LoadToken(path, almost)
	if !errors.Is(err, ErrStoredTokenExpired) {
		t.Fatalf("a nearly-dead token gave %v, want ErrStoredTokenExpired", err)
	}
}

func TestLoadOnAMissingStoreIsNotAnError(t *testing.T) {
	_, err := LoadToken(filepath.Join(t.TempDir(), "absent.json"), time.Now())
	if !errors.Is(err, ErrNoStoredToken) {
		t.Fatalf("a missing store gave %v, want ErrNoStoredToken", err)
	}
}

func TestLoadOnGarbageSaysSo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")

	err := os.WriteFile(path, []byte("not json at all"), 0o600)
	if err != nil {
		t.Fatalf("writing: %v", err)
	}

	_, err = LoadToken(path, time.Now())
	if err == nil {
		t.Fatal("a corrupt store loaded cleanly")
	}

	// Deliberately NOT ErrNoStoredToken: "there is nothing here" and "there is something here I
	// cannot read" are different things to tell an operator.
	if errors.Is(err, ErrNoStoredToken) {
		t.Fatalf("a corrupt store was reported as absent: %v", err)
	}
}

// Whoever reads this file has a shell on the machine, so "every process on the box" is not an
// acceptable audience.
func TestSaveWritesTheStorePrivately(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix permission bits do not carry on windows")
	}

	dir := filepath.Join(t.TempDir(), "nested")
	path := filepath.Join(dir, "remote-token.json")
	now := time.Now()

	minted, err := MintToken(time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, minted, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}

	if info.Mode().Perm() != 0o600 {
		t.Fatalf("token store is %v, want 0600", info.Mode().Perm())
	}

	dirInfo, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("stat dir: %v", err)
	}

	if dirInfo.Mode().Perm() != 0o700 {
		t.Fatalf("token store directory is %v, want 0700", dirInfo.Mode().Perm())
	}
}

// Saving twice must leave ONE store holding the newer token — the rename path has to work over an
// existing file, which is the case Windows refuses without the remove first.
func TestSaveReplacesAnExistingStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Now()

	first, err := MintToken(time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, first, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	second, err := MintToken(time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, second, now)
	if err != nil {
		t.Fatalf("re-saving: %v", err)
	}

	loaded, err := LoadToken(path, now)
	if err != nil {
		t.Fatalf("loading: %v", err)
	}

	if loaded.Value() != second.Value() {
		t.Fatalf("the store kept the old token %q", loaded.Value())
	}

	// The temp file must not survive as a second copy of a live credential.
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatalf("reading dir: %v", err)
	}

	if len(entries) != 1 {
		t.Fatalf("%d files left in the store directory, want just the store", len(entries))
	}
}

// A refresh is worth having only if the VALUE survives it — the token that is about to lapse is
// the one sitting in a settings screen, and a "refresh" that changed it would be a rotation.
func TestRefreshExtendsTheDeadlineAndKeepsTheToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	original, err := MintToken(24*time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, original, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	later := now.Add(12 * time.Hour)

	refreshed, outcome, err := RefreshToken(path, 30*24*time.Hour, later, false)
	if err != nil {
		t.Fatalf("refreshing: %v", err)
	}

	if outcome != RefreshExtended {
		t.Fatalf("outcome %q, want %q", outcome, RefreshExtended)
	}

	if refreshed.Value() != original.Value() {
		t.Fatal("a refresh changed the token — that is a rotation, not a refresh")
	}

	if !refreshed.ExpiresAt().After(original.ExpiresAt()) {
		t.Fatalf("the deadline did not move: %s", refreshed.ExpiresAt())
	}

	// And it is the STORE that changed, not just the value in hand.
	reloaded, err := LoadToken(path, later)
	if err != nil {
		t.Fatalf("loading: %v", err)
	}

	if !reloaded.ExpiresAt().Equal(refreshed.ExpiresAt().UTC()) {
		t.Fatalf("the store kept %s, want %s", reloaded.ExpiresAt(), refreshed.ExpiresAt().UTC())
	}
}

// Lapsing is the ORDINARY reason to run a refresh. Refusing an expired token would leave rotation
// as the only cure for exactly the case rotation is least wanted.
func TestRefreshRevivesAnExpiredToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)

	original, err := MintToken(time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, original, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	// A week after it died.
	later := now.Add(7 * 24 * time.Hour)

	refreshed, outcome, err := RefreshToken(path, 24*time.Hour, later, false)
	if err != nil {
		t.Fatalf("refreshing: %v", err)
	}

	if outcome != RefreshExtended {
		t.Fatalf("outcome %q, want %q", outcome, RefreshExtended)
	}

	if refreshed.Value() != original.Value() {
		t.Fatal("reviving an expired token changed its value")
	}

	err = refreshed.Verify(original.Value(), later)
	if err != nil {
		t.Fatalf("the revived token does not verify: %v", err)
	}
}

func TestRefreshWithRotateReplacesTheValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Now()

	original, err := MintToken(24*time.Hour, now)
	if err != nil {
		t.Fatalf("minting: %v", err)
	}

	err = SaveToken(path, original, now)
	if err != nil {
		t.Fatalf("saving: %v", err)
	}

	rotated, outcome, err := RefreshToken(path, 24*time.Hour, now, true)
	if err != nil {
		t.Fatalf("rotating: %v", err)
	}

	if outcome != RefreshRotated {
		t.Fatalf("outcome %q, want %q", outcome, RefreshRotated)
	}

	if rotated.Value() == original.Value() {
		t.Fatal("--rotate handed back the same token")
	}

	// The old one must be gone from the store, not merely shadowed.
	reloaded, err := LoadToken(path, now)
	if err != nil {
		t.Fatalf("loading: %v", err)
	}

	if reloaded.Value() != rotated.Value() {
		t.Fatal("the rotated token was not written back")
	}
}

func TestRefreshOnAnEmptyStoreMints(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")
	now := time.Now()

	token, outcome, err := RefreshToken(path, time.Hour, now, false)
	if err != nil {
		t.Fatalf("refreshing: %v", err)
	}

	// Not "rotated": there was nothing to rotate, and telling the operator to re-paste would be
	// inventing a reason to.
	if outcome != RefreshMinted {
		t.Fatalf("outcome %q, want %q", outcome, RefreshMinted)
	}

	if token.Value() == "" {
		t.Fatal("nothing was minted")
	}
}

// Unlike a server start, a refresh has nothing that must keep running — so a store it cannot parse
// is reported rather than overwritten, in case the file is merely mangled and still recoverable.
func TestRefreshRefusesToOverwriteACorruptStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "remote-token.json")

	err := os.WriteFile(path, []byte("{ not json"), 0o600)
	if err != nil {
		t.Fatalf("writing: %v", err)
	}

	_, _, err = RefreshToken(path, time.Hour, time.Now(), false)
	if err == nil {
		t.Fatal("a corrupt store was silently replaced by the refresh")
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading: %v", err)
	}

	if string(body) != "{ not json" {
		t.Fatalf("the corrupt store was overwritten: %q", body)
	}
}
