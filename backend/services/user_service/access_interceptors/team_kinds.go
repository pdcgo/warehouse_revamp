package access_interceptors

import "context"

// TeamKinds answers whether a team is one the admin team MONITORS — a warehouse or a selling team
// (the-admin-team-monitors-all-and-manages-its-own). team_service owns a team's type; the composition root answers it.
type TeamKinds interface {
	Monitorable(ctx context.Context, teamID uint64) (bool, error)
}

// WithTeamKinds lets the admin team monitor (step 8b). Without it nobody monitors: a monitor's read is refused like any
// outsider's — the check fails closed rather than letting the admin team into a team of a kind it does not watch.
func WithTeamKinds(kinds TeamKinds) Option {
	return func(i *interceptor) {
		i.kinds = kinds
	}
}

// monitorable is the scoped team's half of step 8b. No reader wired is no monitoring.
func (i *interceptor) monitorable(ctx context.Context, teamID uint64) (bool, error) {
	if i.kinds == nil {
		return false, nil
	}

	return i.kinds.Monitorable(ctx, teamID)
}
