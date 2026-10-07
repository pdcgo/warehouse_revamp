package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestShopCreate_CreatesInTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ShopCreate(context.Background(), connect.NewRequest(&sellingv1.ShopCreateRequest{
		TeamId: 2, Name: "My Shop", ShopCode: "SHOP-1",
		Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE, Description: "a shop",
	}))
	if err != nil {
		t.Fatalf("ShopCreate: %v", err)
	}

	got := resp.Msg.GetShop()
	if got.GetId() == 0 || got.GetTeamId() != 2 || got.GetShopCode() != "SHOP-1" || got.GetName() != "My Shop" {
		t.Fatalf("unexpected shop: %+v", got)
	}
	// The marketplace enum must round-trip through the text column.
	if got.GetMarketplace() != marketplacev1.Marketplace_MARKETPLACE_SHOPEE {
		t.Fatalf("marketplace = %v, want SHOPEE", got.GetMarketplace())
	}
}

// shop_code is unique per team among active shops.
func TestShopCreate_DuplicateCodeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[sellingv1.ShopCreateRequest] {
		return connect.NewRequest(&sellingv1.ShopCreateRequest{
			TeamId: 2, Name: "First", ShopCode: "DUP", Marketplace: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA,
		})
	}

	_, err := svc.ShopCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.ShopCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// The same code is fine in a DIFFERENT team.
func TestShopCreate_SameCodeDifferentTeamOk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShopCreate(context.Background(), connect.NewRequest(&sellingv1.ShopCreateRequest{
		TeamId: 2, Name: "A", ShopCode: "SHARED", Marketplace: marketplacev1.Marketplace_MARKETPLACE_LAZADA,
	}))
	if err != nil {
		t.Fatalf("team 2 create: %v", err)
	}

	_, err = svc.ShopCreate(context.Background(), connect.NewRequest(&sellingv1.ShopCreateRequest{
		TeamId: 3, Name: "B", ShopCode: "SHARED", Marketplace: marketplacev1.Marketplace_MARKETPLACE_LAZADA,
	}))
	if err != nil {
		t.Fatalf("team 3 create with same code should succeed: %v", err)
	}
}
