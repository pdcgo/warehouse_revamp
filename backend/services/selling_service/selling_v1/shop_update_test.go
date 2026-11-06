package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestShopUpdate_ChangesFields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Old name", "S1", "shopee")

	mp := marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA
	resp, err := svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
		TeamId: 2, ShopId: id, Name: proto.String("New name"), Marketplace: &mp,
	}))
	if err != nil {
		t.Fatalf("ShopUpdate: %v", err)
	}

	got := resp.Msg.GetShop()
	if got.GetName() != "New name" || got.GetShopCode() != "S1" ||
		got.GetMarketplace() != marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA {
		t.Fatalf("unexpected after update: %+v", got)
	}
}

func TestShopUpdate_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
		TeamId: 2, ShopId: 9999, Name: proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// A shop belongs to team 2; team 3 must not update it via its own scope.
func TestShopUpdate_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Team 2 shop", "S2", "shopee")

	_, err := svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
		TeamId: 3, ShopId: id, Name: proto.String("hijacked"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update code = %v, want NotFound", connect.CodeOf(err))
	}
}

// A CLOSED shop is locked (a-closed-shop-locks-all-but-its-grants): an edit is refused — FailedPrecondition, "reopen
// the shop first" — and writes nothing. Reopened, it edits again.
func TestShopUpdate_AClosedShopIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertShop(t, db, 2, "Melati Store", "MLT", "shopee")
	closeShop(t, svc, 2, id)

	before := storedShop(t, db, id)

	_, err := svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
		TeamId: 2, ShopId: id, Name: proto.String("Renamed"), ShopCode: proto.String("NEW"),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "reopen the shop first") {
		t.Fatalf("edit of a closed shop: %v, want FailedPrecondition, reopen the shop first", err)
	}

	after := storedShop(t, db, id)
	if after.Name != before.Name || after.ShopCode != before.ShopCode || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("a refused edit wrote the shop: %+v", after)
	}

	_, err = reopenShop(svc, 2, id)
	if err != nil {
		t.Fatalf("ShopReopen: %v", err)
	}

	resp, err := svc.ShopUpdate(context.Background(), connect.NewRequest(&sellingv1.ShopUpdateRequest{
		TeamId: 2, ShopId: id, Name: proto.String("Renamed"),
	}))
	if err != nil || resp.Msg.GetShop().GetName() != "Renamed" {
		t.Fatalf("edit after the reopen: %v", err)
	}
}
