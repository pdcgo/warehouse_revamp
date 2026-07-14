package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// commonPage is a default page filter for list tests.
var commonPage = commonv1.PageFilter{Page: 1, Limit: 50}

func TestUserByIDs_ReturnsPublicUserAndOmitsUnknown(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	uid := insertUser(t, db, "known", "pw12345678")

	res, err := svc.UserByIDs(context.Background(), connect.NewRequest(&userv1.UserByIDsRequest{
		Ids: []uint64{uid, 9_999_999},
	}))
	if err != nil {
		t.Fatalf("UserByIDs: %v", err)
	}

	data := res.Msg.GetData()

	got, ok := data[uid]
	if !ok {
		t.Fatalf("known id missing from result")
	}

	if got.GetUsername() != "known" {
		t.Errorf("username = %q, want known", got.GetUsername())
	}

	// PublicUser carries no email/phone by type — nothing to leak. Just confirm the unknown id
	// is omitted, not returned as a blank entry.
	if _, ok := data[9_999_999]; ok {
		t.Error("unknown id must be OMITTED from the map, not returned blank")
	}
}
