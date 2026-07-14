package user_v1

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
)

// teamByIdsMax mirrors the contract's max_items on TeamByIdsRequest.ids.
const teamByIdsMax = 200

// teamCacheTTL — teams are near-static (admin-only writes; type and team_code are immutable
// after create), so the worst staleness here is a display name.
const teamCacheTTL = time.Minute

// teamResolver replaces the cross-service SQL JOIN.
//
// The source did `JOIN teams ON teams.id = user_team_roles.team_id` — reaching into another
// service's table by raw name. Per-service independence forbids it, so team data is fetched over
// RPC and cached instead.
type teamResolver struct {
	client teamv1connect.TeamServiceClient
	cache  san_caches.CacheManager
}

func newTeamResolver(client teamv1connect.TeamServiceClient, cache san_caches.CacheManager) *teamResolver {
	return &teamResolver{client: client, cache: cache}
}

type cachedTeam struct {
	Name string `json:"name"`
	Type int32  `json:"type"`
}

func teamCacheKey(id uint64) san_caches.StringKey {
	return san_caches.StringKey(fmt.Sprintf("team:byid:%d", id))
}

// resolve returns the teams for the given ids.
//
// IT NEVER RETURNS AN ERROR. If team_service is unreachable, the caller gets an empty map and
// the display name degrades to "" — because a team-name lookup must not be able to take down
// login. The memberships themselves (team_id, role) come from THIS service's own table and are
// always correct.
//
// Ids that come back absent from team_service (unknown or soft-deleted) are simply absent here.
func (r *teamResolver) resolve(ctx context.Context, bearer string, ids []uint64) map[uint64]cachedTeam {
	out := make(map[uint64]cachedTeam, len(ids))

	var missing []uint64

	for _, id := range ids {
		var cached cachedTeam

		err := r.cache.Get(ctx, teamCacheKey(id), &cached)
		if err == nil {
			out[id] = cached

			continue
		}

		missing = append(missing, id)
	}

	if len(missing) == 0 {
		return out
	}

	for chunk := range chunks(missing, teamByIdsMax) {
		req := connect.NewRequest(&teamv1.TeamByIdsRequest{Ids: chunk})
		if bearer != "" {
			req.Header().Set("Authorization", "Bearer "+bearer)
		}

		res, err := r.client.TeamByIds(ctx, req)
		if err != nil {
			// DEGRADE. Do not fail, and do NOT cache the degraded value — caching "" here would
			// turn a 30-second team_service blip into a full minute of blank names after it
			// recovers.
			slog.Warn("team_service unreachable; team names will be blank",
				slog.String("err", err.Error()),
			)

			return out
		}

		for id, team := range res.Msg.GetData() {
			entry := cachedTeam{Name: team.GetName(), Type: int32(team.GetType())}

			out[id] = entry
			_ = r.cache.Set(ctx, teamCacheKey(id), entry, teamCacheTTL)
		}
	}

	return out
}

// chunks yields slices of at most size elements.
func chunks(ids []uint64, size int) func(func([]uint64) bool) {
	return func(yield func([]uint64) bool) {
		for start := 0; start < len(ids); start += size {
			end := min(start+size, len(ids))

			if !yield(ids[start:end]) {
				return
			}
		}
	}
}
