package settlement_v1_test

import (
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// What the settlement importer writes: an imported shop row counts for the shop's primary CS, which
// settlement asks the shop for itself (#settlement-asks-the-shop-for-its-primary-cs), and the five types
// of 2026-09-24 post and count (#withdrawal-counts-in-the-position).

// uploader is whoever posted the file — the actor on every row it posts.
const uploader uint64 = 44

func importedShopRow(uniqueID string, settlementType settlementv1.SettlementType, change int64) settlement_v1.PostInput {
	return settlement_v1.PostInput{
		UniqueID:       uniqueID,
		SettlementType: settlementType,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         change,
		ActorID:        uploader,
	}
}

func assertNoLog(t *testing.T, db *gorm.DB) {
	t.Helper()

	var count int64

	err := db.Model(&settlement_service_models.SettlementLog{}).Count(&count).Error
	if err != nil {
		t.Fatalf("count logs: %v", err)
	}

	if count != 0 {
		t.Fatalf("%d log rows written, want none", count)
	}
}

// An imported shop row is written with the shop's primary CS as its user_id — asked once, before the
// write — while the actor stays the uploader: two people, never collapsed.
func TestSettlementPost_AnImportedShopRowCountsForThePrimaryCS(t *testing.T) {
	db := san_testdb.DB(t)
	primary := primaryIs(shopPrimaryCS)
	svc := settlement_v1.NewService(db, nil, nil, primary)

	result, err := postShop(t, svc, importedShopRow("tiktok:withdrawal_records:w1",
		settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -500_000))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	if result.Entry.UserID != shopPrimaryCS {
		t.Errorf("user_id = %d, want the primary CS %d", result.Entry.UserID, shopPrimaryCS)
	}

	if result.Entry.ActorID != uploader {
		t.Errorf("actor_id = %d, want the uploader %d — the primary must never be written into the actor",
			result.Entry.ActorID, uploader)
	}

	if primary.asked != 1 {
		t.Errorf("the shop was asked %d times, want 1", primary.asked)
	}

	// ⚠ A withdrawal COUNTS in the position (#withdrawal-counts-in-the-position).
	if result.Entry.Balance != -500_000 || result.ShopState.LastBalance != -500_000 {
		t.Errorf("balance = %d, last_balance = %d, want −500.000 both", result.Entry.Balance, result.ShopState.LastBalance)
	}
}

// Only an IMPORTED SHOP row asks: an order row counts for its creator, and a shop row posted by hand for
// its actor (#a-shop-addressed-row-is-attributed-to-its-actor).
func TestSettlementPost_OnlyAnImportedShopRowAsksTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	primary := primaryIs(shopPrimaryCS)
	svc := settlement_v1.NewService(db, nil, nil, primary)

	manual := shopOther("manual-shop-row", -1_000)
	manual.SourceType = settlementv1.SourceType_SOURCE_TYPE_MANUAL
	manual.ActorID = uploader

	result, err := postShop(t, svc, manual)
	if err != nil {
		t.Fatalf("manual shop row: %v", err)
	}

	if result.Entry.UserID != 0 {
		t.Errorf("a hand-posted shop row has user_id %d, want 0 — it counts for its actor", result.Entry.UserID)
	}

	sale := initialTotal("imported-order-sale")
	sale.SourceType = settlementv1.SourceType_SOURCE_TYPE_IMPORTER

	_, err = post(t, svc, sale)
	if err != nil {
		t.Fatalf("imported order row: %v", err)
	}

	if primary.asked != 0 {
		t.Fatalf("the shop was asked %d times for rows that never ask", primary.asked)
	}
}

// a-shop-with-no-primary-cs-cannot-import, settlement's half: a shop with none refuses the row — never
// counted for nobody, never for the uploader. Nothing is written.
func TestSettlementPost_RefusesAnImportedShopRowWhenTheShopHasNoPrimary(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, primaryIs(0))

	_, err := postShop(t, svc, importedShopRow("shopee:rincian_transaksi:x1",
		settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_ADJUSTMENT, -2_000))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	assertNoLog(t, db)
}

// A shop that cannot answer refuses the row — never a quiet fallback to the actor. The importer holds
// the line, and the same file again posts it.
func TestSettlementPost_RefusesAnImportedShopRowWhenTheShopCannotAnswer(t *testing.T) {
	db := san_testdb.DB(t)

	for _, tc := range []struct {
		name   string
		answer error
		want   connect.Code
	}{
		{"the shop service is down", errors.New("connection refused"), connect.CodeUnavailable},
		{"the shop is not the team's", connect.NewError(connect.CodeNotFound, errors.New("shop not found")), connect.CodeNotFound},
	} {
		svc := settlement_v1.NewService(db, nil, nil, &stubPrimary{err: tc.answer})

		_, err := postShop(t, svc, importedShopRow("shopee:rincian_transaksi:"+tc.name,
			settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -1_000))
		if connect.CodeOf(err) != tc.want {
			t.Fatalf("%s: code = %v, want %v", tc.name, connect.CodeOf(err), tc.want)
		}
	}

	assertNoLog(t, db)
}

// A retry of an imported shop row ALREADY WRITTEN is answered from the ledger, whatever the shop says now:
// its person was settled when it was first written. Refusing it broke the retry SettlementPost exists to
// absorb, and the re-post that republishes a lost event — the performance audit found that.
func TestSettlementPost_ARetryOfAStoredImportedShopRowNeedsNoAnswerFromTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	row := importedShopRow("shopee:rincian_transaksi:retry",
		settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -5_000)

	first, err := postShop(t, settlement_v1.NewService(db, nil, nil, primaryIs(shopPrimaryCS)), row)
	if err != nil {
		t.Fatalf("first post: %v", err)
	}

	for _, tc := range []struct {
		name  string
		shops *stubPrimary
	}{
		{"the shop service is down", &stubPrimary{err: errors.New("connection refused")}},
		{"the shop is not the team's", &stubPrimary{err: connect.NewError(connect.CodeNotFound, errors.New("shop not found"))}},
		{"its primary was removed", primaryIs(0)},
	} {
		got, err := postShop(t, settlement_v1.NewService(db, nil, nil, tc.shops), row)
		if err != nil {
			t.Fatalf("%s: the retry was refused: %v", tc.name, err)
		}

		if got.Created || got.Entry.ID != first.Entry.ID || got.Entry.UserID != shopPrimaryCS {
			t.Fatalf("%s: created=%v id=%d user=%d, want the stored row %d, counted for %d",
				tc.name, got.Created, got.Entry.ID, got.Entry.UserID, first.Entry.ID, shopPrimaryCS)
		}
	}
}

// withdrawal names no order (#withdrawal-is-a-settlement-type).
func TestSettlementPost_RefusesAWithdrawalOnAnOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, primaryIs(shopPrimaryCS))

	in := initialTotal("withdrawal-on-an-order")
	in.SettlementType = settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL
	in.SourceType = settlementv1.SourceType_SOURCE_TYPE_IMPORTER
	in.Change = -1_000

	_, err := post(t, svc, in)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// The event carries the person, so the fold counts the row for them without asking again — and a replay
// folds the person the row was written with.
func TestSettlementPost_TheEventCarriesTheUser(t *testing.T) {
	db := san_testdb.DB(t)
	capture := &captureEvents{}
	svc := settlement_v1.NewService(db, capture.send, nil, primaryIs(shopPrimaryCS))

	_, err := postShop(t, svc, importedShopRow("tiktok:order_details:adj1",
		settlementv1.SettlementType_SETTLEMENT_TYPE_PLATFORM_REIMBURSEMENT, 12_000))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	if len(capture.sent) != 1 || capture.sent[0].GetSettlementLogPosted().GetUserId() != shopPrimaryCS {
		t.Fatalf("events = %v, want one carrying user_id %d", capture.sent, shopPrimaryCS)
	}
}

// Every one of the five types of 2026-09-24 posts — SettlementPost refused all five before.
func TestSettlementPost_TakesTheFiveNewTypes(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, primaryIs(shopPrimaryCS))

	for i, settlementType := range []settlementv1.SettlementType{
		settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL,
		settlementv1.SettlementType_SETTLEMENT_TYPE_SHIPMENT_ADJUSTMENT,
		settlementv1.SettlementType_SETTLEMENT_TYPE_LOGISTIC_REIMBURSEMENT,
		settlementv1.SettlementType_SETTLEMENT_TYPE_PLATFORM_REIMBURSEMENT,
		settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_PROGRAM,
	} {
		result, err := postShop(t, svc, importedShopRow("new-type-"+settlementType.String(), settlementType, int64(1000*(i+1))))
		if err != nil {
			t.Fatalf("%v: %v", settlementType, err)
		}

		if !result.Created {
			t.Fatalf("%v: not created", settlementType)
		}
	}
}
