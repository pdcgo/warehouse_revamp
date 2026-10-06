//go:build raceaudit

package user_v1

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The concurrency audit of TeamUserUpdate (audit-sql). The check reads the target's CURRENT role and
// refuses anything at or above the caller's own, so the question is whether that role can change
// between the read and the write:
//
//	the Owner demotes Ani (Admin → Staff)  ‖  Root promotes Ani (Admin → Owner)
//
// Every serial order ends with Ani an Owner: either the demotion lands and Root promotes after it, or
// Root lands first and the demotion is refused. Ani ending as Staff means an Owner demoted an Owner.

const raceTeam uint64 = 990_001

// raceTeams is a team_service that knows one warehouse team. Only TeamByIds is called.
type raceTeams struct {
	teamv1connect.TeamServiceClient
}

func (raceTeams) TeamByIds(context.Context, *connect.Request[teamv1.TeamByIdsRequest]) (*connect.Response[teamv1.TeamByIdsResponse], error) {
	row := &teamv1.TeamRowItem{Id: raceTeam, Type: teamv1.TeamType_TEAM_TYPE_WAREHOUSE, Name: "race"}

	return connect.NewResponse(&teamv1.TeamByIdsResponse{Items: map[uint64]*teamv1.TeamByIdsResponseList{
		raceTeam: {Items: []*teamv1.TeamByIdsResponseItem{{
			D: &teamv1.TeamByIdsResponseItem_Team{Team: &teamv1.TeamRowMapItem{MapData: map[uint64]*teamv1.TeamRowItem{raceTeam: row}}},
		}}},
	}}), nil
}

type raceCast struct {
	root, owner, ani uint64
}

// seedCast commits three people, and removes exactly them afterwards. Not san_race's table DELETE:
// `users` holds the accounts every other test package relies on.
func seedCast(t *testing.T, db *gorm.DB) raceCast {
	t.Helper()

	suffix := time.Now().UnixNano() % 1_000_000_000

	mk := func(name string) uint64 {
		u := user_service_models.User{Username: fmt.Sprintf("race%s%d", name, suffix), Password: "x"}

		err := db.Create(&u).Error
		if err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}

		return u.ID
	}

	cast := raceCast{root: mk("root"), owner: mk("owner"), ani: mk("ani")}

	t.Cleanup(func() {
		ids := []uint64{cast.root, cast.owner, cast.ani}
		db.Where("user_id IN ?", ids).Delete(&user_service_models.UserTeamRole{})
		db.Where("id IN ?", ids).Delete(&user_service_models.User{})
	})

	grant := func(teamID, userID uint64, role role_basev1.Role) {
		err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "team_id"}, {Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"role"}),
		}).Create(&user_service_models.UserTeamRole{TeamID: teamID, UserID: userID, Role: int32(role)}).Error
		if err != nil {
			t.Fatalf("seed membership: %v", err)
		}
	}

	grant(san_auth.RootTeamID, cast.root, role_basev1.Role_ROLE_ROOT)
	grant(raceTeam, cast.owner, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	grant(raceTeam, cast.ani, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)

	return cast
}

func signedIn(id uint64) context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: id})
}

func aniRole(t *testing.T, db *gorm.DB, ani uint64) role_basev1.Role {
	t.Helper()

	var roles []int32

	db.Model(&user_service_models.UserTeamRole{}).Where("team_id = ? AND user_id = ?", raceTeam, ani).Pluck("role", &roles)

	if len(roles) == 0 {
		return role_basev1.Role_ROLE_UNSPECIFIED
	}

	return role_basev1.Role(roles[0])
}

// Race: the two writes released together, many rounds. A pass proves nothing on its own — the
// Interleave below is the proof — but a single round ending in Staff is the bug.
func TestRace_TeamUserUpdate_DemoteWhilePromoted(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	cast := seedCast(t, db)

	svc := NewService(db, nil,
		access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager()),
		raceTeams{}, san_caches.NewSkipCacheManager())

	addAni := func(role role_basev1.Role) *connect.Request[userv1.TeamUserUpdateRequest] {
		return connect.NewRequest(&userv1.TeamUserUpdateRequest{
			TeamId: raceTeam,
			Action: &userv1.TeamUserUpdateRequest_Add{Add: &userv1.AddTeamUser{UserId: cast.ani, Role: role}},
		})
	}

	const rounds = 40

	ownerWon := 0

	for round := 0; round < rounds; round++ {
		db.Model(&user_service_models.UserTeamRole{}).
			Where("team_id = ? AND user_id = ?", raceTeam, cast.ani).
			Update("role", int32(role_basev1.Role_ROLE_WAREHOUSE_ADMIN))

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := svc.TeamUserUpdate(signedIn(cast.root), addAni(role_basev1.Role_ROLE_WAREHOUSE_OWNER))
				return err
			}

			_, err := svc.TeamUserUpdate(signedIn(cast.owner), addAni(role_basev1.Role_ROLE_WAREHOUSE_STAFF))
			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() == 0 {
			ownerWon++ // the demotion landed first, then Root promoted — both succeeded
		}

		got := aniRole(t, db, cast.ani)
		if got != role_basev1.Role_ROLE_WAREHOUSE_OWNER {
			t.Fatalf("round %d: Ani ended as %s — an Owner demoted an Owner", round, got)
		}
	}

	t.Logf("%d rounds: Ani always ended an Owner; the demotion landed first in %d of them", rounds, ownerWon)
}

// Interleave: Root holds the lock and promotes; the Owner's lock MUST wait, and once it has it the
// Owner must read the NEW role and be refused. Blocking alone is not enough — a check made on the
// role read before blocking would wait politely and then demote an Owner anyway.
func TestInterleave_TeamUserUpdate_TheOwnerWaitsThenSeesTheOwner(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	cast := seedCast(t, db)

	var seenByOwner role_basev1.Role

	owner := callerReach{id: cast.owner, inTeam: role_basev1.Role_ROLE_WAREHOUSE_OWNER}

	sched := h.Interleave(t,
		san_race.Do("ROOT", "Root locks Ani's user row and reads her role", func(tx *gorm.DB) error {
			_, err := lockMembership(tx, cast.ani, raceTeam)
			return err
		}),
		san_race.Do("ROOT", "Root makes Ani an Owner", func(tx *gorm.DB) error {
			return tx.Model(&user_service_models.UserTeamRole{}).
				Where("team_id = ? AND user_id = ?", raceTeam, cast.ani).
				Update("role", int32(role_basev1.Role_ROLE_WAREHOUSE_OWNER)).Error
		}),
		san_race.Block("OWNER", "the Owner locks Ani's user row", func(tx *gorm.DB) error {
			role, err := lockMembership(tx, cast.ani, raceTeam)
			seenByOwner = role
			return err
		}),
		san_race.Commit("ROOT"),
		san_race.Do("OWNER", "the Owner checks the role it read under the lock", func(tx *gorm.DB) error {
			err := checkMemberWrite(owner, memberWrite{
				teamType: teamv1.TeamType_TEAM_TYPE_WAREHOUSE,
				target:   cast.ani,
				current:  seenByOwner,
				next:     role_basev1.Role_ROLE_WAREHOUSE_STAFF,
			})
			if connect.CodeOf(err) != connect.CodePermissionDenied {
				return errors.New("the Owner was allowed to demote an Owner")
			}
			return nil
		}),
		san_race.Rollback("OWNER"),
	)
	sched.Report(t)

	lock := sched.Get("the Owner locks Ani's user row")
	if !lock.Blocked || !lock.Released {
		t.Fatalf("the Owner's lock did not wait for Root (blocked=%v released=%v) — the row lock is not held", lock.Blocked, lock.Released)
	}

	if seenByOwner != role_basev1.Role_ROLE_WAREHOUSE_OWNER {
		t.Fatalf("under the lock the Owner read %s, want the Owner Root just committed", seenByOwner)
	}

	if err := sched.Get("the Owner checks the role it read under the lock").Err; err != nil {
		t.Fatal(err)
	}
}

// SuspendUser takes the same lock: Root makes Ani an Administrator while the Administrator suspends her.
// The suspend must wait, then see an Administrator — whom only Root may suspend — and be refused.
func TestInterleave_SuspendUser_WaitsForAPromotion(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	cast := seedCast(t, db)

	var seen role_basev1.Role

	administrator := callerReach{id: cast.owner, root: role_basev1.Role_ROLE_ADMINISTRATOR}

	sched := h.Interleave(t,
		san_race.Do("ROOT", "Root locks Ani's user row", func(tx *gorm.DB) error {
			_, err := lockMembership(tx, cast.ani, san_auth.RootTeamID)
			return err
		}),
		san_race.Do("ROOT", "Root makes Ani an Administrator", func(tx *gorm.DB) error {
			return tx.Create(&user_service_models.UserTeamRole{
				TeamID: san_auth.RootTeamID, UserID: cast.ani, Role: int32(role_basev1.Role_ROLE_ADMINISTRATOR),
			}).Error
		}),
		san_race.Block("ADMIN", "the suspend locks Ani's user row", func(tx *gorm.DB) error {
			role, err := lockMembership(tx, cast.ani, san_auth.RootTeamID)
			seen = role
			return err
		}),
		san_race.Commit("ROOT"),
		san_race.Do("ADMIN", "the suspend checks the role it read under the lock", func(*gorm.DB) error {
			if checkSuspend(administrator, cast.ani, seen) == nil {
				return errors.New("the Administrator was allowed to suspend an Administrator")
			}
			return nil
		}),
		san_race.Rollback("ADMIN"),
	)
	sched.Report(t)

	lock := sched.Get("the suspend locks Ani's user row")
	if !lock.Blocked || !lock.Released {
		t.Fatalf("the suspend did not wait for Root (blocked=%v released=%v)", lock.Blocked, lock.Released)
	}

	if err := sched.Get("the suspend checks the role it read under the lock").Err; err != nil {
		t.Fatal(err)
	}
}

// a-suspended-user-is-never-picked, under concurrency: Root suspends Ani while someone adds her to a team.
// Both serial orders are legal — added then suspended leaves a suspended MEMBER, suspended then added is
// refused — and they end in the same rows, so no final state tells a stale read apart. The Interleave
// below is the proof; this Race only shows the pair never deadlocks or fails any other way.
func TestRace_TeamUserUpdate_AddWhileSuspended(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	cast := seedCast(t, db)

	svc := NewService(db, nil,
		access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager()),
		raceTeams{}, san_caches.NewSkipCacheManager())

	const rounds = 40

	refused := 0

	for round := 0; round < rounds; round++ {
		db.Where("team_id = ? AND user_id = ?", raceTeam, cast.ani).Delete(&user_service_models.UserTeamRole{})
		db.Model(&user_service_models.User{}).Where("id = ?", cast.ani).Update("is_suspended", false)

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := svc.SuspendUser(signedIn(cast.root), connect.NewRequest(&userv1.SuspendUserRequest{
					UserId: cast.ani, Suspended: true,
				}))
				return err
			}

			_, err := svc.TeamUserUpdate(signedIn(cast.root), connect.NewRequest(&userv1.TeamUserUpdateRequest{
				TeamId: raceTeam,
				Action: &userv1.TeamUserUpdateRequest_Add{Add: &userv1.AddTeamUser{UserId: cast.ani, Role: role_basev1.Role_ROLE_WAREHOUSE_STAFF}},
			}))
			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				refused++ // the suspend landed first — the legal refusal
				return nil
			}
			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: a call failed in a way neither serial order allows", round)
		}
	}

	t.Logf("%d rounds, no deadlock, no unexpected error; the suspend landed first in %d", rounds, refused)
}

// Interleave: the suspend holds Ani's row and sets her suspended; the add's lock MUST wait, and once it
// has it the add must read the suspension and refuse. A suspended check made before the lock — or from
// the snapshot the lock waited behind — would add a suspended person.
func TestInterleave_TeamUserUpdate_TheAddWaitsThenSeesTheSuspension(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	cast := seedCast(t, db)

	db.Where("team_id = ? AND user_id = ?", raceTeam, cast.ani).Delete(&user_service_models.UserTeamRole{})

	sched := h.Interleave(t,
		san_race.Do("SUSPEND", "the suspend locks Ani's user row", func(tx *gorm.DB) error {
			_, err := lockMembership(tx, cast.ani, san_auth.RootTeamID)
			return err
		}),
		san_race.Do("SUSPEND", "the suspend marks Ani suspended", func(tx *gorm.DB) error {
			return tx.Model(&user_service_models.User{}).Where("id = ?", cast.ani).Update("is_suspended", true).Error
		}),
		san_race.Block("ADD", "the add locks Ani's user row", func(tx *gorm.DB) error {
			_, err := lockMembership(tx, cast.ani, raceTeam)
			return err
		}),
		san_race.Commit("SUSPEND"),
		san_race.Do("ADD", "the add reads the suspension under the lock", func(tx *gorm.DB) error {
			err := refuseSuspendedNewcomer(tx, cast.ani)
			if connect.CodeOf(err) != connect.CodeFailedPrecondition {
				return fmt.Errorf("a suspended person was let into a team (err = %v)", err)
			}
			return nil
		}),
		san_race.Rollback("ADD"),
	)
	sched.Report(t)

	lock := sched.Get("the add locks Ani's user row")
	if !lock.Blocked || !lock.Released {
		t.Fatalf("the add did not wait for the suspend (blocked=%v released=%v) — the row lock is not held", lock.Blocked, lock.Released)
	}

	if err := sched.Get("the add reads the suspension under the lock").Err; err != nil {
		t.Fatal(err)
	}
}
