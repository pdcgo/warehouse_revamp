package user_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// ProfileDetail reads the TOKEN HOLDER's own row — email and phone included, which PublicUser never carries — so the
// profile form starts from what is stored, and a name-only save sends nothing else: email and phone stay.
func TestProfileDetail_ReadsOwnContactAndANameOnlySaveKeepsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "profself", "pw12345678")
	// A second account, so "the caller's row" is told apart from "a row".
	insertUser(t, db, "profother", "pw12345678")

	err := db.
		Model(&user_service_models.User{}).
		Where("id = ?", uid).
		Update("phone_number", "+6281234567890").
		Error
	if err != nil {
		t.Fatalf("seed phone: %v", err)
	}

	ctx := ctxWithIdentity(uid, "profself")

	res, err := svc.ProfileDetail(ctx, connect.NewRequest(&userv1.ProfileDetailRequest{}))
	if err != nil {
		t.Fatalf("ProfileDetail: %v", err)
	}

	me := res.Msg.GetUser()
	if me.GetId() != uid || me.GetEmail() != "profself@x.local" || me.GetPhoneNumber() != "+6281234567890" {
		t.Fatalf("ProfileDetail = id %d email %q phone %q, want the caller's own row", me.GetId(), me.GetEmail(), me.GetPhoneNumber())
	}

	// What the profile form sends on a name-only save: the name, nothing else (absent = leave alone).
	_, err = svc.UpdateProfile(ctx, connect.NewRequest(&userv1.UpdateProfileRequest{Name: proto.String("Renamed")}))
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	res, err = svc.ProfileDetail(ctx, connect.NewRequest(&userv1.ProfileDetailRequest{}))
	if err != nil {
		t.Fatalf("ProfileDetail after save: %v", err)
	}

	me = res.Msg.GetUser()
	if me.GetName() != "Renamed" || me.GetEmail() != "profself@x.local" || me.GetPhoneNumber() != "+6281234567890" {
		t.Fatalf("after a name-only save: name %q email %q phone %q, want Renamed with email and phone kept",
			me.GetName(), me.GetEmail(), me.GetPhoneNumber())
	}
}

func TestProfileDetail_RequiresIdentity(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ProfileDetail(t.Context(), connect.NewRequest(&userv1.ProfileDetailRequest{}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated with no identity", connect.CodeOf(err))
	}
}
