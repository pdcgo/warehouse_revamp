package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// settlement-and-expense-ask-the-shop-first through the composition root's adapters, over selling's REAL
// ShopAccessCheck on a loopback server shaped like the root's client (NewShopClient). The services' own tests stub the
// shop; these prove what the real answer does: the team's own shop — a CLOSED one included — is answered, another
// team's shop and one that never existed are NotFound.

// The teams and the person the shop scope tests post as.
const (
	scopeTeam      uint64 = 2
	scopeOtherTeam uint64 = 3
	scopePrimary   uint64 = 10
)

// scopeShops are the shops the scope tests name: two of scopeTeam's (one closed), one of scopeOtherTeam's, and an id
// no shop has.
type scopeShops struct {
	open, closed, others, unknown uint64
}

// shopScopeServer seeds the shops and serves selling's real ShopService on a loopback server, returning a client to it.
func shopScopeServer(t *testing.T, db *gorm.DB) (sellingv1connect.ShopServiceClient, scopeShops) {
	t.Helper()

	selling := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	seed := func(team uint64, name, code string) uint64 {
		shop := selling_service_models.Shop{TeamID: team, Name: name, ShopCode: code, Marketplace: "shopee"}

		err := db.Create(&shop).Error
		if err != nil {
			t.Fatalf("seed shop %s: %v", name, err)
		}

		err = db.Create(&selling_service_models.ShopUser{ShopID: shop.ID, UserID: scopePrimary, IsPrimary: true}).Error
		if err != nil {
			t.Fatalf("seed grant on %s: %v", name, err)
		}

		return shop.ID
	}

	shops := scopeShops{
		open:   seed(scopeTeam, "Scope Open", "SCO"),
		closed: seed(scopeTeam, "Scope Closed", "SCC"),
		others: seed(scopeOtherTeam, "Scope Theirs", "SCT"),
	}
	// Past every shop just seeded, so no shop has it.
	shops.unknown = shops.others + 1_000

	// Closed the way a person closes one, so its status and close date agree.
	_, err := selling.ShopClose(context.Background(), connect.NewRequest(&sellingv1.ShopCloseRequest{TeamId: scopeTeam, ShopId: shops.closed}))
	if err != nil {
		t.Fatalf("ShopClose: %v", err)
	}

	mux := http.NewServeMux()
	path, handler := sellingv1connect.NewShopServiceHandler(selling)
	mux.Handle(path, handler)

	srv := httptest.NewServer(mux)
	// Registered after san_testdb's rollback, so it runs FIRST: no handler is left on the transaction.
	t.Cleanup(srv.Close)

	return sellingv1connect.NewShopServiceClient(http.DefaultClient, srv.URL), shops
}

// shopLedgerCount is what settlement holds for a shop: its log rows plus its account rows.
func shopLedgerCount(t *testing.T, db *gorm.DB, shopID uint64) int64 {
	t.Helper()

	var rows, accounts int64

	err := db.
		Model(&settlement_service_models.SettlementLog{}).
		Where("shop_id = ?", shopID).
		Count(&rows).
		Error
	if err != nil {
		t.Fatalf("count rows: %v", err)
	}

	err = db.
		Model(&settlement_service_models.ShopSettlement{}).
		Where("shop_id = ?", shopID).
		Count(&accounts).
		Error
	if err != nil {
		t.Fatalf("count accounts: %v", err)
	}

	return rows + accounts
}

// A shop row posted through settlement with the real ShopPrimary: the team's open and CLOSED shops take money rows
// (a-closed-shop-refuses-only-new-selling) — an imported row on the closed one still counts for its primary CS — while
// another team's shop and an unknown one are NotFound, with nothing written.
func TestSettlementShopScope_TheRealShopAnswersForTheTeam(t *testing.T) {
	db := san_testdb.DB(t)
	client, shops := shopScopeServer(t, db)
	settlement := settlement_v1.NewService(db, nil, nil, NewShopPrimary(client), nil, nil, nil)

	row := func(shopID uint64, key string, source settlementv1.SourceType) settlement_v1.PostInput {
		return settlement_v1.PostInput{
			TeamID:         scopeTeam,
			ShopID:         shopID,
			UniqueID:       "scope-root-" + key,
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
			SourceType:     source,
			Change:         -1_500,
			OccurredOn:     "2026-11-18",
			ActorID:        scopePrimary,
		}
	}

	open, err := settlement.PostEntry(context.Background(), row(shops.open, "open", settlementv1.SourceType_SOURCE_TYPE_MANUAL))
	if err != nil || !open.Created {
		t.Fatalf("the team's open shop: created=%v, %v — want a new row", open.Created, err)
	}

	closed, err := settlement.PostEntry(context.Background(), row(shops.closed, "closed", settlementv1.SourceType_SOURCE_TYPE_IMPORTER))
	if err != nil {
		t.Fatalf("the team's CLOSED shop: %v — a closed shop still takes money rows", err)
	}

	if !closed.Created || closed.Entry.UserID != scopePrimary {
		t.Errorf("the closed shop's imported row: created=%v user=%d — want a new row counted for %d",
			closed.Created, closed.Entry.UserID, scopePrimary)
	}

	for _, refused := range []struct {
		name string
		shop uint64
	}{
		{"another team's shop", shops.others},
		{"a shop that never existed", shops.unknown},
	} {
		before := shopLedgerCount(t, db, refused.shop)

		_, err = settlement.PostEntry(context.Background(), row(refused.shop, refused.name, settlementv1.SourceType_SOURCE_TYPE_MANUAL))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Errorf("%s: code = %v (%v), want not_found", refused.name, connect.CodeOf(err), err)
		}

		after := shopLedgerCount(t, db, refused.shop)
		if after != before {
			t.Errorf("%s: %d settlement rows before the refusal, %d after — want nothing written", refused.name, before, after)
		}
	}
}
