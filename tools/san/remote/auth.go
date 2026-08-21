package remote

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// tokenBytes is 256 bits of entropy. The token is the ONLY thing standing between a caller and a
// shell on the operator's machine, so it is not a memorable string and never will be.
const tokenBytes = 32

var (
	ErrNoToken      = errors.New("remote: missing bearer token")
	ErrInvalidToken = errors.New("remote: invalid token")
	ErrTokenExpired = errors.New("remote: token expired")
)

// Token is ONE RUN's credential.
//
// It is deliberately NOT a warehouse identity token. The caller is a program, not a person with
// roles in a team, so there is no identity to carry and no role to look up — and minting a fake
// user to satisfy the roling system would put a shell behind a credential the login screen also
// accepts. A random secret that dies with the process is both simpler and strictly narrower.
//
// It is also why streaming works here at all: the warehouse interceptor refuses streams because
// it reads its team scope from the request BODY, which has not arrived when an interceptor runs.
// A header credential has no such problem.
type Token struct {
	value string

	// expiresAt zero = the token lives exactly as long as the server process. That is the
	// default because the process IS the session: closing the terminal must end the access.
	expiresAt time.Time
}

// MintToken generates a fresh token. Called once per `san remote serve`, which is the whole
// point — a token that outlives the run it was minted for is a token nobody remembers issuing.
func MintToken(ttl time.Duration, now time.Time) (*Token, error) {
	raw := make([]byte, tokenBytes)

	_, err := rand.Read(raw)
	if err != nil {
		return nil, err
	}

	return NewToken(encodeToken(raw), ttl, now), nil
}

// NewToken adopts a token the operator supplied (--token / SAN_REMOTE_TOKEN), for the case where
// a supervisor process generates the credential and starts the server with it.
func NewToken(value string, ttl time.Duration, now time.Time) *Token {
	token := &Token{value: value}

	if ttl > 0 {
		token.expiresAt = now.Add(ttl)
	}

	return token
}

// NewTokenAt adopts a token with an ALREADY-DECIDED expiry, which is what reading one back from
// the token store needs: the deadline belongs to the token, not to the run that loaded it.
//
// NewToken cannot serve that case — it computes now+ttl, so every restart would push the expiry
// out and a persisted token would in practice never expire.
func NewTokenAt(value string, expiresAt time.Time) *Token {
	return &Token{value: value, expiresAt: expiresAt}
}

func (t *Token) Value() string { return t.value }

// ExpiresAt is zero when the token lives as long as the process.
func (t *Token) ExpiresAt() time.Time { return t.expiresAt }

// Verify is constant-time over a HASH of both sides, not over the raw strings.
//
// subtle.ConstantTimeCompare returns early when the lengths differ, so comparing the raw values
// would leak the token's length. Hashing first makes both sides 32 bytes whatever was presented.
func (t *Token) Verify(candidate string, now time.Time) error {
	if candidate == "" {
		return ErrNoToken
	}

	want := sha256.Sum256([]byte(t.value))
	got := sha256.Sum256([]byte(candidate))

	if subtle.ConstantTimeCompare(want[:], got[:]) != 1 {
		return ErrInvalidToken
	}

	// Expiry is checked AFTER the match: an expired token and a wrong token are both refused,
	// but only the holder of the real one is told which.
	if !t.expiresAt.IsZero() && now.After(t.expiresAt) {
		return ErrTokenExpired
	}

	return nil
}

// NewAuthInterceptor guards every RPC of this service, unary AND streaming.
//
// Both, because the one RPC that matters here is a stream. This is the mirror image of the
// warehouse's access interceptor, which refuses streams outright — the difference is entirely
// where the credential lives. A team scope is a request FIELD and a stream has not delivered it
// yet; a bearer token is a HEADER and is there before the first message.
func NewAuthInterceptor(token *Token, now func() time.Time) connect.Interceptor {
	if now == nil {
		now = time.Now
	}

	return &authInterceptor{token: token, now: now}
}

type authInterceptor struct {
	token *Token
	now   func() time.Time
}

func (i *authInterceptor) check(header string) error {
	err := i.token.Verify(san_auth.BearerToken(header), i.now())
	if err != nil {
		// One code for every failure. Telling a caller apart "no token" from "wrong token" from
		// "expired" is a probing aid; the operator's audit log is where the detail belongs.
		return connect.NewError(connect.CodeUnauthenticated, err)
	}

	return nil
}

func (i *authInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// A connect.Interceptor runs on clients too. Guarding an outbound call would reject our
		// own request before it left the process.
		if req.Spec().IsClient {
			return next(ctx, req)
		}

		err := i.check(req.Header().Get("Authorization"))
		if err != nil {
			return nil, err
		}

		return next(ctx, req)
	}
}

func (i *authInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (i *authInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		err := i.check(conn.RequestHeader().Get("Authorization"))
		if err != nil {
			return err
		}

		return next(ctx, conn)
	}
}

// NewClientAuthInterceptor presents the token on every outbound call — what `san remote exec`
// and any agent's client uses.
func NewClientAuthInterceptor(token string) connect.Interceptor {
	return &clientAuthInterceptor{token: token}
}

type clientAuthInterceptor struct {
	token string
}

func (i *clientAuthInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		if req.Spec().IsClient {
			req.Header().Set("Authorization", "Bearer "+i.token)
		}

		return next(ctx, req)
	}
}

func (i *clientAuthInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		conn := next(ctx, spec)
		conn.RequestHeader().Set("Authorization", "Bearer "+i.token)

		return conn
	}
}

func (i *clientAuthInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

// encodeToken is base64url without padding: safe in a header, a URL, an env var and a filename,
// and it survives being copied out of a terminal.
func encodeToken(raw []byte) string {
	return base64.RawURLEncoding.EncodeToString(raw)
}
