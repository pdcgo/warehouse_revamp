package san_auth

import (
	"context"
	"sync"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

type streamScopeCtxKey struct{}

// StreamScope carries a SERVER STREAM's scope, caller role and monitor mark into its handler. A unary call has them in
// ctx before the handler runs; a server stream's one request is read — and authorized — inside connect-go, after the
// handler's ctx already exists. So the interceptor puts this holder in that ctx first and fills it the moment the
// request is authorized, which is still before the handler's body sees the request. GetScope, GetCallerRole and
// IsMonitor read it when the ctx carries no value of its own.
//
// Without it a stream's writes could not say who acted as what — an import Root runs read as nobody's override
// (an-override-is-stamped-in-every-service).
type StreamScope struct {
	mu      sync.Mutex
	scope   uint64
	role    role_basev1.Role
	monitor bool
}

// WithStreamScope puts an empty holder in a stream's ctx. The interceptor calls it.
func WithStreamScope(ctx context.Context) (context.Context, *StreamScope) {
	holder := &StreamScope{}

	return context.WithValue(ctx, streamScopeCtxKey{}, holder), holder
}

// Fill copies what the authorization resolved — read off the ctx it returned — into the holder.
//
// ⚠ READ FIRST, LOCK AFTER. The authorized ctx descends from the one holding this holder, so a value it lacks (the
// monitor mark, for a member) falls back to this very holder — and reading it under the lock would wait on itself.
func (s *StreamScope) Fill(authorized context.Context) {
	scope := GetScope(authorized)
	role := GetCallerRole(authorized)
	monitor := IsMonitor(authorized)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.scope, s.role, s.monitor = scope, role, monitor
}

func (s *StreamScope) values() (uint64, role_basev1.Role, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.scope, s.role, s.monitor
}

func streamScopeOf(ctx context.Context) *StreamScope {
	holder, _ := ctx.Value(streamScopeCtxKey{}).(*StreamScope)

	return holder
}
