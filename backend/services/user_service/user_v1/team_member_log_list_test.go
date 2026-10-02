package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Pins the prototype state: the contract exists, the log table does not. When
// every-role-change-is-logged is built this test is replaced by the real ones.
func TestTeamMemberLogList_NotBuilt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.TeamMemberLogList(context.Background(), connect.NewRequest(&userv1.TeamMemberLogListRequest{TeamId: 1}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("code = %v, want Unimplemented", connect.CodeOf(err))
	}
}
