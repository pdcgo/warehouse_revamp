package remote

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// TokenRefreshMargin is how close to expiry a stored token is treated as already gone.
//
// Handing back a credential with nine seconds left is worse than minting a new one: the operator
// pastes it into a client, the client connects, and the session dies mid-command for a reason
// nothing on screen explains.
const TokenRefreshMargin = time.Minute

// DefaultTokenStorePath is where the credential is kept between runs, relative to the workspace
// root. Under a dot-directory rather than at the top, because a workspace root is a checkout and
// a stray secret in its listing is one `git add .` away from being published.
const DefaultTokenStorePath = ".san/remote-token.json"

var (
	// ErrNoStoredToken is "there is nothing here yet", the normal first-run answer — never an
	// error worth failing a startup over.
	ErrNoStoredToken = errors.New("remote: no stored token")

	// ErrStoredTokenExpired is a store that HAS a token whose time is up. Distinct from the above
	// so the operator is told a credential rotated rather than left guessing why the URL they
	// bookmarked stopped working.
	ErrStoredTokenExpired = errors.New("remote: stored token expired")
)

// storedToken is the on-disk shape. JSON, because the expiry has to travel WITH the value: a bare
// token in a file cannot say when it dies, and a reader that guesses from the file's mtime is a
// reader that guesses wrong the first time the file is copied.
type storedToken struct {
	Token     string     `json:"token"`
	IssuedAt  time.Time  `json:"issued_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

// LoadToken reads a token back from the store, or says why it could not.
//
// ⚠ The expiry it returns is the one that was WRITTEN, never now+ttl. Re-stamping it on each
// start would make the deadline slide forward every time the server ran, so a token used daily
// would never expire at all — which is the opposite of what a TTL is for.
func LoadToken(path string, now time.Time) (*Token, error) {
	stored, err := readStore(path)
	if err != nil {
		return nil, err
	}

	if stored.ExpiresAt == nil {
		return NewTokenAt(stored.Token, time.Time{}), nil
	}

	if !now.Add(TokenRefreshMargin).Before(*stored.ExpiresAt) {
		return nil, ErrStoredTokenExpired
	}

	return NewTokenAt(stored.Token, *stored.ExpiresAt), nil
}

// readStore is the file half, with no opinion about expiry.
//
// Separate from LoadToken because RefreshToken needs the value of a token that has ALREADY lapsed
// — extending a dead deadline is the whole point of a refresh, and LoadToken deliberately refuses
// to hand that token to a caller who would then serve with it.
func readStore(path string) (storedToken, error) {
	var stored storedToken

	if path == "" {
		return stored, ErrNoStoredToken
	}

	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return stored, ErrNoStoredToken
	}

	if err != nil {
		return stored, fmt.Errorf("reading token store %q: %w", path, err)
	}

	err = json.Unmarshal(raw, &stored)
	if err != nil {
		return stored, fmt.Errorf("token store %q is not readable JSON: %w", path, err)
	}

	if stored.Token == "" {
		return stored, ErrNoStoredToken
	}

	return stored, nil
}

// RefreshOutcome says what a refresh actually did, which is the difference between "carry on" and
// "go and re-paste this into every client".
type RefreshOutcome string

const (
	// RefreshExtended is the ordinary one: the SAME token, a later deadline. Nothing to re-paste.
	RefreshExtended RefreshOutcome = "extended"

	// RefreshRotated is a new value, which invalidates every client holding the old.
	RefreshRotated RefreshOutcome = "rotated"

	// RefreshMinted is a refresh that found nothing to extend — an empty or unreadable store.
	RefreshMinted RefreshOutcome = "minted"
)

// RefreshToken pushes the stored token's deadline out, WITHOUT changing its value.
//
// That is what makes it worth having. Rotation is easy — mint and overwrite — but it costs a trip
// to every client's settings screen, and the token most likely to expire is the one pasted into a
// connector precisely because nobody wants to go back there. A refresh keeps the credential and
// moves only the date.
//
// It extends an ALREADY-EXPIRED token on purpose: lapsing is the normal reason to run this, and
// refusing would leave rotation as the only cure for the case rotation is least wanted. The caller
// is the operator at a terminal, not a request from the network — nothing reachable over HTTP can
// renew its own access, which is why this is a CLI command and not an RPC.
//
// Pass rotate to get a new value instead: the answer to a leak, not to a deadline.
func RefreshToken(path string, ttl time.Duration, now time.Time, rotate bool) (*Token, RefreshOutcome, error) {
	stored, err := readStore(path)
	had := err == nil

	switch {
	case had && !rotate:
		token := NewToken(stored.Token, ttl, now)

		err = SaveToken(path, token, now)
		if err != nil {
			return nil, "", err
		}

		return token, RefreshExtended, nil

	case had:
		// A rotation over a store that WAS readable — the old value is deliberately dropped.

	case errors.Is(err, ErrNoStoredToken):
		// Nothing to extend. Minting is the only thing a refresh can usefully mean here.

	default:
		// An unreadable store is reported, not silently replaced: unlike a server start, there is
		// nothing here that has to keep running, and overwriting a file we could not parse might
		// be throwing away a token that was merely mangled.
		return nil, "", err
	}

	token, err := MintToken(ttl, now)
	if err != nil {
		return nil, "", err
	}

	err = SaveToken(path, token, now)
	if err != nil {
		return nil, "", err
	}

	// "rotated" only when something was actually replaced — over an empty store there was nothing
	// to rotate, and telling the operator to re-paste would be inventing a reason to.
	if had {
		return token, RefreshRotated, nil
	}

	return token, RefreshMinted, nil
}

// SaveToken writes the store 0600, inside a 0700 directory.
//
// Both modes matter and neither is decoration: whoever reads this file has a shell on this
// machine, so "every process on the box" is not an acceptable audience.
func SaveToken(path string, token *Token, now time.Time) error {
	if path == "" {
		return nil
	}

	dir := filepath.Dir(path)

	err := os.MkdirAll(dir, 0o700)
	if err != nil {
		return fmt.Errorf("creating token store directory %q: %w", dir, err)
	}

	stored := storedToken{Token: token.Value(), IssuedAt: now.UTC()}

	if expires := token.ExpiresAt(); !expires.IsZero() {
		utc := expires.UTC()
		stored.ExpiresAt = &utc
	}

	body, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}

	// Written through a temp file in the same directory and renamed, so a reader never catches a
	// half-written store — and so a crash mid-write cannot destroy the token that was working.
	temp, err := os.CreateTemp(dir, ".remote-token-*.json")
	if err != nil {
		return fmt.Errorf("creating token store %q: %w", path, err)
	}

	tempName := temp.Name()

	defer func() { _ = os.Remove(tempName) }()

	err = temp.Chmod(0o600)
	if err != nil && !errors.Is(err, os.ErrInvalid) {
		_ = temp.Close()

		return fmt.Errorf("securing token store %q: %w", path, err)
	}

	_, err = temp.Write(append(body, '\n'))
	if err != nil {
		_ = temp.Close()

		return fmt.Errorf("writing token store %q: %w", path, err)
	}

	err = temp.Close()
	if err != nil {
		return fmt.Errorf("writing token store %q: %w", path, err)
	}

	// Windows will not rename onto an existing file, so the old store goes first. It has already
	// been read by this point — the token in hand is either the one it held or its replacement.
	_ = os.Remove(path)

	err = os.Rename(tempName, path)
	if err != nil {
		return fmt.Errorf("replacing token store %q: %w", path, err)
	}

	return os.Chmod(path, 0o600)
}
