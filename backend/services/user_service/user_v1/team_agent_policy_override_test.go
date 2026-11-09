package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): Root setting a team's agent policy from outside the
// team says so; the owner's next set clears it, because the flag follows the last setter as updated_by_user_id does.
func TestTeamAgentPolicySet_StampsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newAgentService(t, db)

	const team uint64 = 5

	root := insertUser(t, db, "override-root", "pw")
	owner := insertUser(t, db, "override-owner", "pw")

	rootCtx := san_auth.WithCallerRole(san_auth.WithScope(ctxWithIdentity(root, "override-root"), team), role_basev1.Role_ROLE_UNSPECIFIED)
	ownerCtx := san_auth.WithCallerRole(san_auth.WithScope(ctxWithIdentity(owner, "override-owner"), team), role_basev1.Role_ROLE_SELLING_OWNER)

	for _, step := range []struct {
		name   string
		caller uint64
		set    func() error
		want   bool
	}{
		{"Root turns it on", root, func() error {
			_, err := svc.TeamAgentPolicySet(rootCtx, connect.NewRequest(&userv1.TeamAgentPolicySetRequest{TeamId: team, MembersMayConnect: true}))
			return err
		}, true},
		{"the owner turns it off", owner, func() error {
			_, err := svc.TeamAgentPolicySet(ownerCtx, connect.NewRequest(&userv1.TeamAgentPolicySetRequest{TeamId: team, MembersMayConnect: false}))
			return err
		}, false},
	} {
		err := step.set()
		if err != nil {
			t.Fatalf("%s: %v", step.name, err)
		}

		var row user_service_models.TeamAgentPolicy

		err = db.Where("team_id = ?", team).Take(&row).Error
		if err != nil {
			t.Fatalf("%s: read the policy: %v", step.name, err)
		}

		if row.UpdatedByUserID == nil || *row.UpdatedByUserID != step.caller || row.IsOverride != step.want {
			t.Errorf("%s: updated by %v, is_override %v — want %d, %v", step.name, row.UpdatedByUserID, row.IsOverride, step.caller, step.want)
		}
	}
}
