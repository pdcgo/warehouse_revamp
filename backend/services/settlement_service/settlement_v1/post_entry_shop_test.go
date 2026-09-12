package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// THE SECOND GRAIN (#an-entry-names-an-order-or-a-shop). A row addressed to a SHOP names no order —
// a platform withdrawal, or a system adjustment repairing a report-level error that spans many of them.
//
// ⚠ These tests cannot use `post`: that helper fills in `order` when OrderID is 0, which is exactly the
// value that means "shop-addressed" here.
func postShop(
	t *testing.T,
	svc *settlement_v1.Service,
	in settlement_v1.PostInput,
) (settlement_v1.PostResult, error) {
	t.Helper()

	if in.TeamID == 0 {
		in.TeamID = team
	}

	if in.ShopID == 0 {
		in.ShopID = shop
	}

	if in.OccurredOn == "" {
		in.OccurredOn = "2026-08-28"
	}

	return svc.PostEntry(context.Background(), in)
}

func shopOther(uniqueID string, change int64) settlement_v1.PostInput {
	return settlement_v1.PostInput{
		UniqueID:       uniqueID,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
		Change:         change,
	}
}

// A shop-addressed row opens `shop_settlements` and runs its own balance, and returns NO order account
// — because there is none. An empty OrderSettlement would read as an account whose every figure is 0.
func TestSettlementPost_ShopAddressedOpensItsOwnAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	result, err := postShop(t, svc, shopOther("shop-30-withdrawal", -20_000))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	if result.Entry.OrderID != nil {
		t.Errorf("log order_id = %d, want NULL — the column is the grain, and 0 is a wire convention only", *result.Entry.OrderID)
	}

	if result.State != nil {
		t.Error("an order account was returned for a shop-addressed row — there is none to return")
	}

	if result.ShopState == nil {
		t.Fatal("no shop account returned — the row has to have moved one")
	}

	if result.ShopState.LastBalance != -20_000 {
		t.Errorf("shop last_balance = %d, want -20.000", result.ShopState.LastBalance)
	}

	if result.Entry.Balance != -20_000 {
		t.Errorf("entry balance = %d, want -20.000 — the shop's chain starts here", result.Entry.Balance)
	}

	// The row it locks must actually be on disk, or the next writer has nothing to serialise on.
	var stored settlement_service_models.ShopSettlement

	err = db.Where("shop_id = ?", shop).Take(&stored).Error
	if err != nil {
		t.Fatalf("shop_settlements row: %v", err)
	}

	if stored.TeamID != team {
		t.Errorf("shop account team = %d, want %d", stored.TeamID, team)
	}
}

// ⚠ THE TWO CHAINS ARE SEPARATE, and this is the test that pins it.
//
// Both grains carry the same `shop_id` and both fold into the same daily report — so it is tempting to
// read `shop_settlements.last_balance` as "the shop's position". It is not: it holds the shop's DIRECT
// movements only, and the order rows are a different chain entirely.
func TestSettlementPost_TheTwoChainsDoNotMix(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	shopResult, err := postShop(t, svc, shopOther("shop-30-withdrawal", -20_000))
	if err != nil {
		t.Fatalf("shop row: %v", err)
	}

	// The shop chain opened at 0 and knows nothing of the order's −120.000.
	if shopResult.ShopState.LastBalance != -20_000 {
		t.Errorf("shop last_balance = %d, want -20.000 — the order's balance must not leak in",
			shopResult.ShopState.LastBalance)
	}

	// And the order's account is untouched by the shop row.
	var account settlement_service_models.OrderSettlement

	err = db.Where("order_id = ?", order).Take(&account).Error
	if err != nil {
		t.Fatalf("order_settlements row: %v", err)
	}

	if account.LastBalance != -sale {
		t.Errorf("order last_balance = %d, want %d — the shop row must not move it", account.LastBalance, -sale)
	}
}

// A shop-addressed row is idempotent on the same key, exactly as an order-addressed one is.
func TestSettlementPost_ShopAddressedIsIdempotent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	first, err := postShop(t, svc, shopOther("shop-30-withdrawal", -20_000))
	if err != nil {
		t.Fatalf("first post: %v", err)
	}

	second, err := postShop(t, svc, shopOther("shop-30-withdrawal", -20_000))
	if err != nil {
		t.Fatalf("retry: %v", err)
	}

	if second.Created {
		t.Error("created = true on the retry — the duplicate was written a second time")
	}

	if second.Entry.ID != first.Entry.ID {
		t.Errorf("retry returned entry %d, want the original %d", second.Entry.ID, first.Entry.ID)
	}

	if second.ShopState.LastBalance != -20_000 {
		t.Errorf("shop last_balance = %d, want -20.000 — a retry must not move the account twice",
			second.ShopState.LastBalance)
	}
}

// ⚠ THE GRAIN IS DECIDED BY THE TYPE, not by the caller. A sale belongs to an order: with no order
// there is no account to open, and the row would never reach the detail panel that explains it.
func TestSettlementPost_RefusesAnInitialTotalWithNoOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "shop-30-sale",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         -sale,
	})
	if err == nil {
		t.Fatal("a sale with no order was accepted — it has no account to open")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("code = %v, want invalid_argument", connect.CodeOf(err))
	}
}

// And the other direction: a repair that spans many orders must not be filed against one of them,
// where it would move that order's balance for something the marketplace never did.
func TestSettlementPost_RefusesASystemAdjustmentOnAnOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "repair-aug",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
		Change:         -5_000,
	})
	if err == nil {
		t.Fatal("a system_adjustment naming an order was accepted — the repair is shop-wide")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("code = %v, want invalid_argument", connect.CodeOf(err))
	}
}

// A shop-addressed row belonging to another team is refused for the same reason an order-addressed one
// is: the scope proves the caller's team, never the account's.
func TestSettlementPost_RefusesAnotherTeamsShopAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := postShop(t, svc, shopOther("shop-30-withdrawal", -20_000))
	if err != nil {
		t.Fatalf("open: %v", err)
	}

	_, err = postShop(t, svc, settlement_v1.PostInput{
		TeamID:         team + 1,
		UniqueID:       "shop-30-intruder",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
		Change:         -1_000,
	})
	if err == nil {
		t.Fatal("another team appended to this shop's ledger")
	}

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("code = %v, want permission_denied", connect.CodeOf(err))
	}
}
