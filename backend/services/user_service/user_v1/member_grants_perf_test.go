//go:build perfaudit

package user_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// The performance audit of the two grant RPCs once they gained their role checks (audit-rpc-performance).
//
// Volume: 10 000 users (an entity table) and 30 000 memberships over 300 teams. The role resolver runs on
// a MEMORY cache warmed by one Resolve before measuring — in the app the access interceptor has resolved
// the same (caller, team) a moment earlier, so the handler's own resolve is a cache hit.
func seedGrantVolume(t *testing.T) (*gorm.DB, *user_v1.Service, *san_perf.Probe, context.Context, context.Context, uint64) {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))

	users := make([]user_service_models.User, 10_000)
	for i := range users {
		users[i] = user_service_models.User{
			Username: fmt.Sprintf("perfuser%d", i),
			Email:    fmt.Sprintf("perfuser%d@x.local", i),
			Password: "x",
		}
	}
	san_perf.SeedRows(t, db, &users)

	memberships := make([]user_service_models.UserTeamRole, 0, 30_000)
	for i := range users {
		for k := 0; k < 3; k++ {
			memberships = append(memberships, user_service_models.UserTeamRole{
				TeamID: uint64(1000 + (i*3+k)%300),
				UserID: users[i].ID,
				Role:   int32(role_basev1.Role_ROLE_WAREHOUSE_STAFF),
			})
		}
	}
	san_perf.SeedRows(t, db, &memberships)

	cache := san_caches.NewMemoryCacheManager()
	resolver := access_interceptors.NewDBRoleResolver(db, cache)
	svc := user_v1.NewService(db, testSigner(), resolver, testTeams(), cache)

	root := asRoot(t, db)
	owner, ownerID := asMember(t, db, "perfowner", whTeam, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	target := users[5_000].ID

	// What the interceptor would have done for these callers.
	_, _ = resolver.Resolve(owner, ownerID, whTeam)
	_, _ = resolver.Resolve(root, identityIn(t, root), whTeam)

	return db, svc, probe, owner, root, target
}

func measure(t *testing.T, probe *san_perf.Probe, name string, call func(i int) error) {
	t.Helper()

	err := call(-1) // warm-up: schema reflection, the pool, the team-type cache
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)
	counts := map[int]bool{}

	for i := range 5 {
		probe.Reset()

		var callErr error

		wall, dbTime := probe.Measure(func() { callErr = call(i) })
		if callErr != nil {
			t.Fatalf("%s: %v", name, callErr)
		}

		walls = append(walls, wall)
		counts[probe.Count()] = true
		t.Logf("%s wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("%s median wall %v, query counts seen %v", name, san_perf.Median(walls), counts)
	probe.Report(t, name)
}

func TestPerf_TeamUserUpdate(t *testing.T) {
	db, svc, probe, owner, _, target := seedGrantVolume(t)

	measure(t, probe, "TeamUserUpdate", func(int) error {
		_, err := svc.TeamUserUpdate(owner, connect.NewRequest(&userv1.TeamUserUpdateRequest{
			TeamId: whTeam,
			Action: &userv1.TeamUserUpdateRequest_Add{Add: &userv1.AddTeamUser{UserId: target, Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF}},
		}))

		return err
	})

	// The two reads the lock path adds, against the seeded volume.
	t.Log(san_perf.Explain(t, db, fmt.Sprintf(`SELECT "id" FROM "users" WHERE id = %d FOR UPDATE`, target)))
}

func TestPerf_CreateUser(t *testing.T) {
	_, svc, probe, _, root, _ := seedGrantVolume(t)

	measure(t, probe, "CreateUser", func(i int) error {
		_, err := svc.CreateUser(root, connect.NewRequest(&userv1.CreateUserRequest{
			TeamId:   whTeam,
			Username: fmt.Sprintf("perfnew%d", i+1),
			Password: "perfpass123",
			Name:     "Perf",
			Role:     role_basev1.Role_ROLE_WAREHOUSE_STAFF,
		}))

		return err
	})
}


func TestPerf_UpdateUserUsername(t *testing.T) {
	_, svc, probe, _, root, target := seedGrantVolume(t)

	measure(t, probe, "UpdateUser", func(i int) error {
		name := fmt.Sprintf("renamed%d", i+1)

		_, err := svc.UpdateUser(root, connect.NewRequest(&userv1.UpdateUserRequest{UserId: target, Username: &name}))

		return err
	})
}

// TeamCreate's grant: Root adds a NEW person as a team's Owner — a new person each call, so every call
// takes the newcomer path and its suspended check (refuseSuspendedNewcomer), not the change-role path the
// test above settles into after its warm-up.
func TestPerf_TeamUserUpdateNewOwner(t *testing.T) {
	db, svc, probe, _, root, _ := seedGrantVolume(t)

	var ids []uint64

	err := db.Model(&user_service_models.User{}).Where("username LIKE ?", "perfuser7%").Order("id").Limit(10).Pluck("id", &ids).Error
	if err != nil || len(ids) < 6 {
		t.Fatalf("newcomers: %v (%d)", err, len(ids))
	}

	measure(t, probe, "TeamUserUpdate (new Owner)", func(i int) error {
		_, err := svc.TeamUserUpdate(root, connect.NewRequest(&userv1.TeamUserUpdateRequest{
			TeamId: whTeam,
			Action: &userv1.TeamUserUpdateRequest_Add{Add: &userv1.AddTeamUser{UserId: ids[i+1], Role: role_basev1.Role_ROLE_WAREHOUSE_OWNER}},
		}))

		return err
	})

	t.Log(san_perf.Explain(t, db, fmt.Sprintf(`SELECT "is_suspended" FROM "users" WHERE id = %d`, ids[1])))
}

// UserList with the MEMBERSHIP slice — the Users screen's role column. Measured at two page sizes: the role
// read must stay ONE query whatever the page holds (an N+1 here would grow with it).
func TestPerf_UserListMembership(t *testing.T) {
	_, svc, probe, _, root, _ := seedGrantVolume(t)

	for _, limit := range []uint32{20, 100} {
		measure(t, probe, fmt.Sprintf("UserList+MEMBERSHIP limit=%d", limit), func(int) error {
			_, err := svc.UserList(root, connect.NewRequest(&userv1.UserListRequest{
				TeamId: 1000, // 100 members in the seeded volume
				DataRequest: []userv1.UserListDataType{
					userv1.UserListDataType_USER_LIST_DATA_TYPE_USER,
					userv1.UserListDataType_USER_LIST_DATA_TYPE_MEMBERSHIP,
				},
				Page: &commonv1.CommonPagination{Page: 1, Limit: limit},
			}))

			return err
		})
	}
}

// TeamMemberLogList — the Users screen's History tab. The log is a TRANSACTION table, so 50 000 rows over the
// 300 seeded teams plus one busy team; measured at two page sizes, and filtered to one person.
func TestPerf_TeamMemberLogList(t *testing.T) {
	db, svc, probe, _, root, target := seedGrantVolume(t)

	actor := identityIn(t, root)
	logs := make([]user_service_models.TeamMemberLog, 50_000)

	for i := range logs {
		team := uint64(1000 + i%300)
		if i%5 == 0 {
			team = whTeam // a busy team: 10 000 rows
		}

		logs[i] = user_service_models.TeamMemberLog{
			TeamID:      team,
			ActorUserID: &actor,
			UserID:      target,
			Action:      int16(userv1.TeamMemberLogAction_TEAM_MEMBER_LOG_ACTION_ADD),
			RoleAfter:   int32(role_basev1.Role_ROLE_WAREHOUSE_STAFF),
		}
	}
	san_perf.SeedRows(t, db, &logs)

	for _, tc := range []struct {
		name   string
		limit  uint32
		person uint64
	}{
		{"limit=20", 20, 0},
		{"limit=200", 200, 0},
		{"one person, limit=20", 20, target},
	} {
		measure(t, probe, "TeamMemberLogList "+tc.name, func(int) error {
			_, err := svc.TeamMemberLogList(root, connect.NewRequest(&userv1.TeamMemberLogListRequest{
				TeamId: whTeam,
				Filter: &userv1.TeamMemberLogListFilter{UserId: tc.person},
				Page:   &commonv1.CommonPagination{Page: 1, Limit: tc.limit},
			}))

			return err
		})
	}

	t.Log(san_perf.Explain(t, db, fmt.Sprintf(`SELECT * FROM "team_member_logs" WHERE team_id = %d ORDER BY id DESC LIMIT 20`, whTeam)))
	t.Log(san_perf.Explain(t, db, fmt.Sprintf(`SELECT count(*) FROM "team_member_logs" WHERE team_id = %d`, whTeam)))
}
