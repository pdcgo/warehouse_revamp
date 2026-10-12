package financial_account_v1_test

import (
	"context"
	"testing"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func settlementEvent(eventID string, team, shop uint64, settlementType settlementv1.SettlementType, change int64, on string) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    eventID,
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_SettlementLogPosted{SettlementLogPosted: &eventsv1.SettlementLogPosted{
			TeamId:         team,
			ShopId:         shop,
			ActorId:        ani,
			SettlementType: settlementType,
			Change:         change,
			PostedOn:       on,
			OccurredOn:     on,
		}},
	}
}

// withdraw delivers settlement's withdrawal row — NEGATIVE there, money leaving the marketplace wallet.
func withdraw(t *testing.T, svc *financial_account_v1.Service, eventID string, team, shop uint64, change int64, on string) {
	t.Helper()

	err := svc.WithdrawalHandler()(context.Background(), settlementEvent(eventID, team, shop, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, change, on))
	if err != nil {
		t.Fatalf("withdrawal %s: %v", eventID, err)
	}
}

// revenue-stays-in-settlement: the sign turned — money leaving the wallet is money arriving here — into the
// account the shop names, on the day the money moved.
func TestWithdrawal_PostsIntoTheShopsAccountSignTurned(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9500000001", 1_000))
	if _, err := shopSet(svc, teamA, 501, ops.GetId()); err != nil {
		t.Fatalf("shop set: %v", err)
	}

	withdraw(t, svc, "evt-w-1", teamA, 501, -3_500_000, day(3))

	rows := logs(t, db, ops.GetId())
	last := rows[len(rows)-1]

	if last.ChangeType != m.ChangeWithdrawal || last.Change != 3_500_000 || last.ActorID != ani || last.Description != "Withdrawal from shop #501" {
		t.Fatalf("withdrawal row = %+v", last)
	}

	if last.OccurredAt.In(jakarta).Format("2006-01-02") != day(3) {
		t.Fatalf("occurred = %v, want %s", last.OccurredAt, day(3))
	}

	if balance(t, db, ops.GetId()) != 3_501_000 {
		t.Fatalf("balance = %v", balance(t, db, ops.GetId()))
	}
}

// one-contract-for-both-handler-types: a redelivered withdrawal posts ONCE.
func TestWithdrawal_ARedeliveryPostsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	withdraw(t, svc, "evt-w-dup", teamA, 501, -1_000, day(1))
	withdraw(t, svc, "evt-w-dup", teamA, 501, -1_000, day(1))

	var link m.ShopAccount
	if err := db.Where("shop_id = ?", 501).Take(&link).Error; err != nil {
		t.Fatalf("link: %v", err)
	}

	if n := len(logs(t, db, link.AccountID)); n != 1 {
		t.Fatalf("posted %d times", n)
	}
}

// a-shop-with-no-account-gets-an-unknown-one: nothing is held — an unknown account is made, linked, and the
// money waits there.
func TestWithdrawal_AShopWithNoAccountGetsAnUnknownOne(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	withdraw(t, svc, "evt-w-new", teamA, 502, -1_700_000, day(12))
	withdraw(t, svc, "evt-w-new-2", teamA, 502, -2_500_000, day(4))

	var link m.ShopAccount
	if err := db.Where("shop_id = ?", 502).Take(&link).Error; err != nil {
		t.Fatalf("no link: %v", err)
	}

	var unknown m.FinancialAccount
	if err := db.Where("id = ?", link.AccountID).Take(&unknown).Error; err != nil {
		t.Fatalf("no account: %v", err)
	}

	if unknown.Type != m.TypeUnknown || unknown.Provider != m.ProviderUnknown || unknown.TeamID != teamA || unknown.Balance != 4_200_000 {
		t.Fatalf("unknown = %+v", unknown)
	}

	// No opening row — its first row is the withdrawal itself.
	if rows := logs(t, db, unknown.ID); len(rows) != 2 || rows[0].ChangeType != m.ChangeWithdrawal {
		t.Fatalf("rows = %+v", rows)
	}
}

// Every other settlement type is ignored — revenue stays in settlement, and its ads never reach an account.
func TestWithdrawal_IgnoresEveryOtherSettlementType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	err := svc.WithdrawalHandler()(context.Background(), settlementEvent("evt-fund", teamA, 501, settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 250_000, day(1)))
	if err != nil {
		t.Fatalf("fund: %v", err)
	}

	var count int64
	db.Model(&m.ShopAccount{}).Where("shop_id = ?", 501).Count(&count)

	if count != 0 {
		t.Fatal("a fund row reached the accounts")
	}
}

// A reversal of a withdrawal — positive in settlement — takes the money back out.
func TestWithdrawal_AReversalComesBackOut(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	withdraw(t, svc, "evt-w-orig", teamA, 501, -900, day(2))
	withdraw(t, svc, "evt-w-rev", teamA, 501, 900, day(1))

	var link m.ShopAccount
	if err := db.Where("shop_id = ?", 501).Take(&link).Error; err != nil {
		t.Fatalf("link: %v", err)
	}

	if balance(t, db, link.AccountID) != 0 {
		t.Fatalf("balance = %v", balance(t, db, link.AccountID))
	}
}
