package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// UpdateProfile's subject is the TOKEN HOLDER — it reads the identity from ctx, never a request
// field. A name-only edit must leave the email alone.
func TestUpdateProfile_EditsSelfAndPreservesEmail(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "selfedit", "pw12345678")
	ctx := ctxWithIdentity(uid, "selfedit")

	res, err := svc.UpdateProfile(ctx, connect.NewRequest(&userv1.UpdateProfileRequest{
		Name: proto.String("Self Edited"),
	}))
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	if res.Msg.GetUser().GetName() != "Self Edited" {
		t.Errorf("name = %q, want Self Edited", res.Msg.GetUser().GetName())
	}

	if res.Msg.GetUser().GetEmail() != "selfedit@x.local" {
		t.Errorf("email = %q, want it preserved", res.Msg.GetUser().GetEmail())
	}
}

func TestUpdateProfile_RequiresIdentity(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// No identity in ctx (as on an allow_all route) — must be Unauthenticated, never a silent
	// edit of "whoever".
	_, err := svc.UpdateProfile(t.Context(), connect.NewRequest(&userv1.UpdateProfileRequest{
		Name: proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated with no identity", connect.CodeOf(err))
	}
}
