package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// No row reads as OFF — CS and staff connect nothing until the owner turns it on.
func TestTeamAgentPolicyDetail(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := newAgentService(t, db)
	ctx := ctxWithIdentity(1, "root")

	res, err := svc.TeamAgentPolicyDetail(ctx, connect.NewRequest(&userv1.TeamAgentPolicyDetailRequest{TeamId: 5}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if res.Msg.GetMembersMayConnect() {
		t.Fatal("a team with no row reads as on, want off")
	}

	db.Create(&user_service_models.TeamAgentPolicy{TeamID: 5, MembersMayConnect: true})

	res, _ = svc.TeamAgentPolicyDetail(ctx, connect.NewRequest(&userv1.TeamAgentPolicyDetailRequest{TeamId: 5}))
	if !res.Msg.GetMembersMayConnect() {
		t.Fatal("the switch is on, and the detail reads off")
	}
}
