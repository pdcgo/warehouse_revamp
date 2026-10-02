package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Pins the prototype state: the contract exists, the handler does not. When erase-keeps-the-row is
// built this test is replaced by the real ones.
func TestUserErase_NotBuilt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.UserErase(context.Background(), connect.NewRequest(&userv1.UserEraseRequest{UserId: 2}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("code = %v, want Unimplemented", connect.CodeOf(err))
	}
}
