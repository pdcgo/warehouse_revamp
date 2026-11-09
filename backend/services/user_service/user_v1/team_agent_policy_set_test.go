package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The owner turns it on, then off — one row, upserted, stamped with who did it.
func TestTeamAgentPolicySet(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newAgentService(t, db)

	owner := insertUser(t, db, "owner", "pw")
	ctx := ctxWithIdentity(owner, "owner")

	for _, want := range []bool{true, false} {
		res, err := svc.TeamAgentPolicySet(ctx, connect.NewRequest(&userv1.TeamAgentPolicySetRequest{TeamId: 5, MembersMayConnect: want}))
		if err != nil {
			t.Fatalf("set %v: %v", want, err)
		}

		if res.Msg.GetMembersMayConnect() != want {
			t.Fatalf("answered %v, want %v", res.Msg.GetMembersMayConnect(), want)
		}

		var rows []user_service_models.TeamAgentPolicy
		db.Where("team_id = ?", 5).Find(&rows)

		if len(rows) != 1 || rows[0].MembersMayConnect != want || rows[0].UpdatedByUserID == nil || *rows[0].UpdatedByUserID != owner {
			t.Fatalf("rows = %+v, want one, %v, stamped by %d", rows, want, owner)
		}
	}
}
