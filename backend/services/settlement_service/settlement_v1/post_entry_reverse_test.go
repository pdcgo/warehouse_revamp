package settlement_v1_test

import (
	"strconv"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// REVERSE ON A SHOP ENTRY (a-shop-entry-reverses-inline) is the order ledger's reverse: SettlementPost of the opposite
// row, same type, `reverses_id` set, keyed `reverse-<id>` — on the shop's own account.

func shopRow(t *testing.T, svc *settlement_v1.Service, key string, change float64) settlement_v1.PostResult {
	t.Helper()

	row, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       key,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         change,
	})
	if err != nil {
		t.Fatalf("shop row %s: %v", key, err)
	}

	return row
}

func reverseShop(t *testing.T, svc *settlement_v1.Service, of settlement_v1.PostResult, key string) (settlement_v1.PostResult, error) {
	t.Helper()

	if key == "" {
		key = "reverse-" + strconv.FormatUint(of.Entry.ID, 10)
	}

	return postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       key,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -of.Entry.Change,
		ReversesID:     of.Entry.ID,
		ShopID:         of.Entry.ShopID,
	})
}

// The opposite row lands on the same shop, the shop's position returns, and the totals with it.
func TestSettlementPost_ReversesAShopEntry(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	wrong := shopRow(t, svc, "wrong", -45_000)

	fixed, err := reverseShop(t, svc, wrong, "")
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	if !san_money.IsZero(fixed.ShopState.LastBalance) || fixed.Entry.OrderID != nil || fixed.Entry.ShopID != shop {
		t.Errorf("after the reversal: shop balance %v, order %v, shop %d — want 0, none, %d",
			fixed.ShopState.LastBalance, fixed.Entry.OrderID, fixed.Entry.ShopID, shop)
	}
}

// A ROW IS REVERSED ONCE: a second Reverse under another key is refused; the same key again is the first one's retry.
func TestSettlementPost_RefusesASecondReversal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	wrong := shopRow(t, svc, "wrong", -45_000)

	first, err := reverseShop(t, svc, wrong, "")
	if err != nil {
		t.Fatalf("first reverse: %v", err)
	}

	retry, err := reverseShop(t, svc, wrong, "")
	if err != nil || retry.Created || retry.Entry.ID != first.Entry.ID {
		t.Fatalf("same-key retry = (%v, created %v, id %d), want the first row back unwritten", err, retry.Created, retry.Entry.ID)
	}

	_, err = reverseShop(t, svc, wrong, "reverse-again")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("second reversal: got %v, want FailedPrecondition", err)
	}

	// The order ledger holds the same rule.
	_, err = post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	fee, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "fee",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -4_500,
	})
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	for i, key := range []string{"fee-back", "fee-back-again"} {
		_, err = post(t, svc, settlement_v1.PostInput{
			UniqueID:       key,
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
			Change:         4_500,
			ReversesID:     fee.Entry.ID,
		})
		if i == 0 && err != nil {
			t.Fatalf("order reversal: %v", err)
		}

		if i == 1 && connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("second order reversal: got %v, want FailedPrecondition", err)
		}
	}
}

// A reversal is THE NEGATION, SAME TYPE (a-correction-is-a-new-row) — another amount or kind is refused.
func TestSettlementPost_RefusesAReversalThatIsNotTheOpposite(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	wrong := shopRow(t, svc, "wrong", -45_000)

	for _, in := range []settlement_v1.PostInput{
		{UniqueID: "half", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, Change: 20_000},
		{UniqueID: "kind", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, Change: 45_000},
	} {
		in.SourceType = settlementv1.SourceType_SOURCE_TYPE_MANUAL
		in.ReversesID = wrong.Entry.ID

		_, err := postShop(t, svc, in)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: got %v, want InvalidArgument", in.UniqueID, err)
		}
	}
}

// A shop reversal reaches only the shop's own rows: never an order's sale (nor its cancel — a person may not post that
// kind at all), and never another shop's row.
func TestSettlementPost_AShopReversalReachesOnlyItsShopsRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	sale, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	_, err = postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "reverse-" + strconv.FormatUint(sale.Entry.ID, 10),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -sale.Entry.Change,
		ReversesID:     sale.Entry.ID,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("a shop reversal of an order's sale: got %v, want InvalidArgument", err)
	}

	elsewhere, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "elsewhere",
		ShopID:         shop + 1,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -1_000,
	})
	if err != nil {
		t.Fatalf("another shop's row: %v", err)
	}

	_, err = postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "reverse-" + strconv.FormatUint(elsewhere.Entry.ID, 10),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         1_000,
		ReversesID:     elsewhere.Entry.ID,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("a reversal on another shop's row: got %v, want InvalidArgument", err)
	}

	_, err = postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "a-cancel",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         sale.Entry.Change,
		ReversesID:     sale.Entry.ID,
	})
	if err == nil {
		t.Error("a person posted a cancel reversal")
	}

}
