// Package san_auth holds the GENERIC primitives of the authorization system: identity tokens
// (mint, parse, expiry), reading the (request_policy) / (use_scope) proto options, and the
// startup descriptor check.
//
// It knows nothing about users, roles or teams — it has no user_service coupling, which is why
// it can live in pkgs/. The ENFORCEMENT that uses these primitives (the access interceptor and
// the role resolvers) belongs to user_service, which owns identity and roles:
// services/user_service/access_interceptors.
package san_auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

// RootTeamID is the super-admin scope: ROLE_ROOT / ROLE_ADMIN *in this team* bypass every
// other check. team_service's migration seeds team 1 as type='root' and constrains
// (type = 'root') = (id = 1), so the constant and the data cannot drift apart.
const RootTeamID uint64 = 1

var (
	ErrNoToken      = errors.New("san_auth: missing token")
	ErrInvalidToken = errors.New("san_auth: invalid token")
	ErrTokenExpired = errors.New("san_auth: token expired")
)

// tokenClaims carries the Identity as a protobuf blob inside a JWT.
//
// RegisteredClaims is populated — notably ExpiresAt. The source embedded it and never filled
// it in, so jwt.ParseWithClaims would happily accept a token expired years ago; expiry
// survived only because a separate check happened to exist.
type tokenClaims struct {
	Data []byte `json:"d"`

	jwt.RegisteredClaims
}

// Signer mints and parses identity tokens.
type Signer struct {
	secret []byte
	ttl    time.Duration
}

func NewSigner(secret string, ttl time.Duration) *Signer {
	return &Signer{secret: []byte(secret), ttl: ttl}
}

// TTL is the token lifetime.
//
// Exposed so a caller can recover a token's ISSUE time (expired_at - ttl). We do not carry
// issued_at on the Identity, and the issue time is what a password reset must be compared
// against: every token minted before the reset must die.
func (s *Signer) TTL() time.Duration {
	return s.ttl
}

// Sign mints a token for the identity, stamping expiry in BOTH places: the JWT's standard
// `exp` (so the library enforces it) and Identity.expired_at (so callers can read it).
func (s *Signer) Sign(identity *role_basev1.Identity, now time.Time) (string, error) {
	expiry := now.Add(s.ttl)

	identity.ExpiredAt = timestamppb.New(expiry)

	data, err := proto.Marshal(identity)
	if err != nil {
		return "", err
	}

	claims := tokenClaims{
		Data: data,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiry),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}

	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.secret)
}

// Parse validates the signature and returns the identity.
//
// It does NOT check expiry — Verify does, so that CheckAccess can deliberately parse an
// expired-but-valid token in order to renew it.
func (s *Signer) Parse(token string) (*role_basev1.Identity, error) {
	claims := &tokenClaims{}

	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		// Pin the algorithm. Without this, a token signed with "none" — or an RS256 token
		// whose "key" is our public secret — would be accepted.
		_, ok := t.Method.(*jwt.SigningMethodHMAC)
		if !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}

		return s.secret, nil
	}, jwt.WithoutClaimsValidation()) // expiry is our call, not the library's
	if err != nil || !parsed.Valid {
		return nil, ErrInvalidToken
	}

	identity := &role_basev1.Identity{}

	err = proto.Unmarshal(claims.Data, identity)
	if err != nil {
		return nil, ErrInvalidToken
	}

	return identity, nil
}

// IsExpired fails CLOSED: an identity with no expiry counts as expired. A missing expiry must
// never mean "never expires".
func IsExpired(identity *role_basev1.Identity, now time.Time) bool {
	expiry := identity.GetExpiredAt()
	if expiry == nil {
		return true
	}

	return now.After(expiry.AsTime())
}

// Verify parses a token and rejects it if expired.
func (s *Signer) Verify(token string, now time.Time) (*role_basev1.Identity, error) {
	identity, err := s.Parse(token)
	if err != nil {
		return nil, err
	}

	if IsExpired(identity, now) {
		return nil, ErrTokenExpired
	}

	return identity, nil
}

// BearerToken extracts the token from an Authorization header.
//
// The scheme check is case-insensitive AND mandatory. The source used a bare
// strings.TrimPrefix(h, "Bearer "), which is a no-op on an unprefixed value — so a raw token
// with no scheme was silently accepted.
func BearerToken(header string) string {
	const scheme = "bearer "

	if len(header) < len(scheme) || !strings.EqualFold(header[:len(scheme)], scheme) {
		return ""
	}

	return strings.TrimSpace(header[len(scheme):])
}

type identityCtxKey struct{}

type scopeCtxKey struct{}

// GetIdentity returns the authenticated caller. It errors on allow_all routes, which never
// populate it.
func GetIdentity(ctx context.Context) (*role_basev1.Identity, error) {
	identity, ok := ctx.Value(identityCtxKey{}).(*role_basev1.Identity)
	if !ok || identity == nil {
		return nil, errors.New("san_auth: no identity in context")
	}

	return identity, nil
}

func WithIdentity(ctx context.Context, identity *role_basev1.Identity) context.Context {
	return context.WithValue(ctx, identityCtxKey{}, identity)
}

// GetScope returns the team id the request was scoped to, or 0.
func GetScope(ctx context.Context) uint64 {
	scope, _ := ctx.Value(scopeCtxKey{}).(uint64)

	return scope
}

func WithScope(ctx context.Context, teamID uint64) context.Context {
	return context.WithValue(ctx, scopeCtxKey{}, teamID)
}

type bearerCtxKey struct{}

// GetBearer returns the caller's raw token, so a handler can FORWARD it when calling another
// service on the caller's behalf.
//
// Forwarding the caller's own token — rather than a service credential — means the downstream
// service applies the caller's permissions, not ours. A service that calls another with its own
// privileges is a confused deputy.
func GetBearer(ctx context.Context) string {
	token, _ := ctx.Value(bearerCtxKey{}).(string)

	return token
}

// WithBearer stores the caller's raw token. The interceptor calls this; handlers read it back
// via GetBearer.
//
// The key lives HERE, not in the interceptor's package, so that setter and getter cannot drift
// into different context keys — a mismatch that would compile fine and silently return "".
func WithBearer(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, bearerCtxKey{}, token)
}
