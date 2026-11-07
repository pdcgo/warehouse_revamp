package settlement_v1_test

import (
	"context"
	"fmt"
	"math"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// The one order every test below settles, and the team and shop that own it.
const (
	team  uint64 = 2
	shop  uint64 = 30
	order uint64 = 5001
)

// The worked example from the design: the buyer paid 120.000, 110.000 arrived, and a 20.000 ads fee
// was charged against it. The platform kept the difference and never said so.
const (
	sale    float64 = 120_000
	arrived float64 = 110_000
	adsFee  float64 = -20_000
)

func post(
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

	if in.OrderID == 0 {
		in.OrderID = order
	}

	if in.OccurredOn == "" {
		in.OccurredOn = "2026-08-28"
	}

	return svc.PostEntry(context.Background(), in)
}

// initialTotal is the opening row: the sale, with the sign flipped, because POSITIVE IS MONEY TOWARD
// US and the platform owes us at this point.
func initialTotal(uniqueID string) settlement_v1.PostInput {
	return settlement_v1.PostInput{
		UniqueID:       uniqueID,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         -sale,
	}
}

// THE SIGN FLIP LIVES IN EXACTLY ONE PLACE, and this is the test that pins it there.
//
// The log records `change = −120.000` (the platform owes us) while the projection stores
// `initial_total = +120.000` (the sale, as a person says it). If either side drifted, every screen's
// `net received` would read as a subtraction and report the opposite of the truth.
func TestSettlementPost_OpensTheAccountWithThePositiveSale(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	result, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	if !result.Created {
		t.Fatal("created = false on the first post — the account was opened, so it must be true")
	}

	if result.Entry.Change != -sale {
		t.Errorf("log change = %v, want %v — the log keeps the NEGATIVE, money is owed to us", result.Entry.Change, -sale)
	}

	if result.State.InitialTotal != sale {
		t.Errorf("initial_total = %v, want %v — the projection holds the sale POSITIVE", result.State.InitialTotal, sale)
	}

	if result.State.LastBalance != -sale {
		t.Errorf("last_balance = %v, want %v — nothing has arrived yet", result.State.LastBalance, -sale)
	}
}

// THE WHOLE POINT OF THE LEDGER, on the design's own worked example: what the buyer paid, minus what
// reached us, is the platform's take — and nothing else in this system can produce that number.
func TestSettlementPost_ProjectsTheWorkedExample(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "stmt-aug-fund",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         arrived,
	})
	if err != nil {
		t.Fatalf("fund: %v", err)
	}

	result, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "stmt-aug-ads",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         adsFee,
	})
	if err != nil {
		t.Fatalf("ads fee: %v", err)
	}

	// −120.000 + 110.000 − 20.000
	wantBalance := -sale + arrived + adsFee
	if result.State.LastBalance != wantBalance {
		t.Errorf("last_balance = %v, want %v", result.State.LastBalance, wantBalance)
	}

	// net received = last_balance + initial_total, a single-row read. −30.000 + 120.000 = 90.000
	netReceived := result.State.LastBalance + result.State.InitialTotal
	if netReceived != arrived+adsFee {
		t.Errorf("net received = %v, want %v", netReceived, arrived+adsFee)
	}

	// ⚠ AND IT DOES NOT REACH ZERO. That is not a bug to chase — the residual IS the platform's take.
	if result.State.LastBalance == 0 {
		t.Error("balance reached zero — the design says it never should, so this assertion guards the whole premise")
	}
}

// ⚠ THE RETRY THAT WOULD OTHERWISE DOUBLE-CREDIT. `order_service` retries a cancel across a network
// timeout, and the second call must change nothing and SAY it changed nothing.
func TestSettlementPost_IsIdempotentAndReportsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	first, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("first post: %v", err)
	}

	second, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("retry: %v", err)
	}

	if second.Created {
		t.Error("created = true on a retry — a caller with a broken key recipe would never learn it")
	}

	if second.Entry.ID != first.Entry.ID {
		t.Errorf("retry wrote a new row (%d, was %d) — the account has been credited twice", second.Entry.ID, first.Entry.ID)
	}

	if second.State.InitialTotal != sale {
		t.Errorf("initial_total = %v after a retry, want %v — the sale was counted twice", second.State.InitialTotal, sale)
	}
}

// A CANCEL ZEROES THE LIVE SALE, and it needs no special case to do it: its `change` is the exact
// opposite of the sale's, so the projection's running sum returns to zero on its own.
func TestSettlementPost_CancelZeroesTheLiveSale(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	result, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "order-5001-cancel",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         sale,
	})
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if result.State.InitialTotal != 0 {
		t.Errorf("initial_total = %v after a cancel, want 0 — the list screen would rank this as the shop's best order", result.State.InitialTotal)
	}

	if result.State.LastBalance != 0 {
		t.Errorf("last_balance = %v after a cancel, want 0", result.State.LastBalance)
	}

	// THE LOG KEEPS BOTH ROWS. Zeroing is a projection, never a deletion.
	var logged int64

	err = db.Table("settlement_logs").Where("order_id = ?", order).Count(&logged).Error
	if err != nil {
		t.Fatalf("count logs: %v", err)
	}

	if logged != 2 {
		t.Errorf("%d log rows, want 2 — the ledger is append-only and a cancel adds, never removes", logged)
	}
}

// ⚠ THE ONE RULE THE DATA ENFORCES. A hand-posted cancel would zero the sale of an order the order
// service still believes is live, and nothing on any screen would show the disagreement.
func TestSettlementPost_RefusesAHandPostedCancel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	for _, source := range []settlementv1.SourceType{
		settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
	} {
		_, err := post(t, svc, settlement_v1.PostInput{
			UniqueID:       "cancel-from-" + source.String(),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
			SourceType:     source,
			Change:         sale,
		})
		if err == nil {
			t.Fatalf("%s posted a cancel — only order_service may", source)
		}

		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Errorf("%s: code = %v, want PermissionDenied", source, connect.CodeOf(err))
		}
	}
}

// KNOWING AN ORDER ID IS NOT ENOUGH. The scope proves the caller belongs to the team it named; it says
// nothing about whether the ACCOUNT does.
func TestSettlementPost_RefusesAnotherTeamsAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		TeamID:         team + 1,
		UniqueID:       "intruder",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         arrived,
	})
	if err == nil {
		t.Fatal("another team appended to this account")
	}

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}
}

// An order does not move between shops, so a later post naming a different one is a caller with the
// wrong order — not a shop change to accept quietly.
func TestSettlementPost_RefusesAShopMismatch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		ShopID:         shop + 1,
		UniqueID:       "wrong-shop",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         arrived,
	})
	if err == nil {
		t.Fatal("a post for another shop was accepted onto this account")
	}
}

// An append-only ledger cannot repair a dangling pointer later, so it is refused at write time.
func TestSettlementPost_RefusesAReversalOfNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "reverses-a-ghost",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_ADJUSTMENT,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         1_000,
		ReversesID:     99_999,
	})
	if err == nil {
		t.Fatal("a reversal pointing at no entry was accepted")
	}
}

// A CORRECTION IS A NEW ROW. The reversal offsets the original and both stay on the log — because a
// ledger you can edit is not evidence of anything.
func TestSettlementPost_ReversalOffsetsRatherThanEdits(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	wrong, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "typo",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -50_000,
	})
	if err != nil {
		t.Fatalf("the mistaken entry: %v", err)
	}

	fixed, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "typo-reversed",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         50_000,
		ReversesID:     wrong.Entry.ID,
	})
	if err != nil {
		t.Fatalf("the reversal: %v", err)
	}

	if fixed.State.LastBalance != -sale {
		t.Errorf("last_balance = %v, want %v — the reversal did not cancel the mistake out", fixed.State.LastBalance, -sale)
	}

	if fixed.Entry.ReversesID == nil || *fixed.Entry.ReversesID != wrong.Entry.ID {
		t.Error("the reversal does not point back at what it undid")
	}
}

// POSTING IS THE FREEZE POINT, EXACT (the-backend-never-rounds-money): a fractional change is stored as it is posted,
// never rounded — the row, its running balance and the account carry the exact figure, and the account equals the sum
// of its rows within the tolerance. Three payouts of 10.000,4 are 30.001,2.
func TestSettlementPost_StoresAFractionExact(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	var payout settlement_v1.PostResult

	for i := 1; i <= 3; i++ {
		payout, err = post(t, svc, settlement_v1.PostInput{
			UniqueID:       fmt.Sprintf("stmt-fund-%d", i),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
			Change:         10_000.4,
		})
		if err != nil {
			t.Fatalf("fund %d: %v", i, err)
		}

		if payout.Entry.Change != 10_000.4 {
			t.Fatalf("fund %d posted %v, want 10.000,4 — stored exact", i, payout.Entry.Change)
		}
	}

	if !san_money.Equal(payout.State.LastBalance, -sale+30_001.2) {
		t.Fatalf("last_balance = %v, want %v — three exact payouts", payout.State.LastBalance, -sale+30_001.2)
	}

	fee, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "stmt-ads",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         -2_500.5,
	})
	if err != nil {
		t.Fatalf("ads fee: %v", err)
	}

	if fee.Entry.Change != -2_500.5 || !san_money.Equal(fee.Entry.Balance, -sale+30_001.2-2_500.5) ||
		!san_money.Equal(fee.State.LastBalance, -sale+30_001.2-2_500.5) {
		t.Fatalf("fee = %v balance %v, account %v — −2.500,5 posts as −2.500,5", fee.Entry.Change, fee.Entry.Balance, fee.State.LastBalance)
	}

	// THE STORED ROWS are exact, and the account is their sum within the tolerance.
	rows := []settlement_service_models.SettlementLog{}

	err = db.Where("order_id = ? AND team_id = ?", order, team).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatal(err)
	}

	var sum float64

	for _, row := range rows {
		sum += row.Change
	}

	if len(rows) != 5 || !san_money.Equal(sum, fee.State.LastBalance) || rows[4].Change != -2_500.5 {
		t.Fatalf("%d rows summing to %v, account %v — the account is the log's sum", len(rows), sum, fee.State.LastBalance)
	}

	// A RETRY of the same fractional post finds the same row and changes nothing.
	again, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "stmt-ads",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         -2_500.5,
	})
	if err != nil {
		t.Fatalf("retry: %v", err)
	}

	if again.Created || again.Entry.ID != fee.Entry.ID || again.State.LastBalance != fee.State.LastBalance {
		t.Fatalf("retry = %+v — the same row, nothing moved", again)
	}
}

// NaN and the infinities are not an amount of rupiah. The wire refuses them (double.finite); an in-process caller —
// an order event, the importer — is held to the same, and nothing is written.
func TestSettlementPost_RefusesAChangeThatIsNotFinite(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	for i, change := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		_, err := post(t, svc, settlement_v1.PostInput{
			UniqueID:       fmt.Sprintf("not-finite-%d", i),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
			Change:         change,
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("change %v: err = %v, want InvalidArgument", change, err)
		}
	}

	var written int64

	err := db.Model(&settlement_service_models.SettlementLog{}).Where("team_id = ?", team).Count(&written).Error
	if err != nil {
		t.Fatal(err)
	}

	if written != 0 {
		t.Fatalf("%d rows written for a refused change", written)
	}
}
