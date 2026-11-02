package san_auth

import "context"

type monitorCtxKey struct{}

// IsMonitor answers whether this request is the ADMIN TEAM MONITORING a team it is not in
// (docs/business/user/context_decision.md#the-admin-team-monitors-read-only): the caller holds ROLE_ADMIN_OWNER or
// ROLE_ADMIN_ADMINISTRATOR, no role in the scoped team, and the RPC is a marked read — the only kind the interceptor
// lets a monitor through on. GetCallerRole is ROLE_UNSPECIFIED beside it, as it is for Root's bypass; this is what
// tells the two apart.
//
// ⚠ IT IS NOT AN AUTHORIZATION CHECK. The interceptor has already decided; a handler may read this only to NARROW
// (never to admit), exactly as it may read GetCallerRole.
//
// A SERVER STREAM's handler reads it from its StreamScope, filled when its one request is authorized.
func IsMonitor(ctx context.Context) bool {
	monitor, ok := ctx.Value(monitorCtxKey{}).(bool)
	if ok {
		return monitor
	}

	if holder := streamScopeOf(ctx); holder != nil {
		_, _, monitor = holder.values()
	}

	return monitor
}

// WithMonitor marks the request as the admin team's monitor read. The interceptor calls it; handlers read it back
// with IsMonitor. The key lives here for the reason WithCallerRole's does: setter and getter in different packages
// would compile fine and silently disagree.
func WithMonitor(ctx context.Context) context.Context {
	return context.WithValue(ctx, monitorCtxKey{}, true)
}
