package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A CLOSED shop through the adapters other services hold (a-closed-shop-refuses-only-new-selling):
// ShopAccessCheck answers it with its status, and each caller decides — the settlement importer and settlement's
// primary-CS lookup accept it, so a closed shop's last statements still import; financial_account's ShopOfTeam refuses
// a new account link to it, NotFound (a-closed-shop-takes-no-new-account-link). And reopened, the link is taken again. Over selling's REAL ShopService on a loopback server, shaped like the
// composition root's client.
func TestShopCheckers_AClosedShopImportsButIsNotLinked(t *testing.T) {
	db := san_testdb.DB(t)

	const (
		team    = 2
		primary = 10
	)

	shop := selling_service_models.Shop{TeamID: team, Name: "Closed Store", ShopCode: "CLS", Marketplace: "shopee"}

	err := db.Create(&shop).Error
	if err != nil {
		t.Fatalf("seed shop: %v", err)
	}

	err = db.Create(&selling_service_models.ShopUser{ShopID: shop.ID, UserID: primary, IsPrimary: true}).Error
	if err != nil {
		t.Fatalf("seed grant: %v", err)
	}

	selling := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	_, err = selling.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{TeamId: team, ShopId: shop.ID}))
	if err != nil {
		t.Fatalf("ShopClose: %v", err)
	}

	mux := http.NewServeMux()
	path, handler := sellingv1connect.NewShopServiceHandler(selling)
	mux.Handle(path, handler)

	srv := httptest.NewServer(mux)
	// Registered after san_testdb's rollback, so it runs FIRST: no handler is left on the transaction.
	t.Cleanup(srv.Close)

	client := sellingv1connect.NewShopServiceClient(http.DefaultClient, srv.URL)
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: primary})

	// The importer: the closed shop is answered — the right shop, its primary, the uploader's grant.
	check, err := NewImporterShopChecker(client).CheckShop(ctx, team, shop.ID, primary)
	if err != nil {
		t.Fatalf("importer CheckShop on a closed shop: %v — its last statements must still import", err)
	}

	if check.ID != shop.ID || check.PrimaryUserID != primary || !check.HasAccess {
		t.Errorf("importer check = %+v, want shop %d, primary %d, access", check, shop.ID, primary)
	}

	// Settlement: a closed shop's imported row still finds its primary CS.
	got, err := NewShopPrimary(client).PrimaryUser(ctx, team, shop.ID, primary)
	if err != nil || got != primary {
		t.Errorf("settlement PrimaryUser = %d, %v — want %d", got, err, primary)
	}

	// financial_account: a new link to a closed shop is refused, NotFound.
	err = NewFinancialAccountShopChecker(client).ShopOfTeam(ctx, team, shop.ID)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("ShopOfTeam on a closed shop: %v, want NotFound", err)
	}

	// Reopened, it is a shop an account may be linked to again.
	_, err = selling.ShopReopen(context.Background(), connect.NewRequest(&sellingv1.ShopReopenRequest{TeamId: team, ShopId: shop.ID}))
	if err != nil {
		t.Fatalf("ShopReopen: %v", err)
	}

	err = NewFinancialAccountShopChecker(client).ShopOfTeam(ctx, team, shop.ID)
	if err != nil {
		t.Errorf("ShopOfTeam on the reopened shop: %v, want it accepted", err)
	}
}
