//go:build raceaudit

// Concurrency audit for SettlementPost (the audit-sql skill).
//
// WHY THIS RPC. It is a read-modify-write on money with THREE writers who genuinely collide: the
// exporter loading a statement, a person on the order page, and `order_service` on create or cancel.
// Every one of them retries, and the account is one row they all update.
//
// Two distinct bugs are possible here and this file proves both are absent:
//
//  1. A LOST UPDATE on the running balance. Two posters read `last_balance`, both add their own
//     change to the value they read, and the second write erases the first. The money simply
//     disappears, and nothing in an append-only ledger would ever reveal it.
//  2. A DOUBLE CREDIT through the idempotency key. Two retries of the SAME post race the existence
//     check — both find nothing, both insert — and the account is credited twice for one event.
//     This is the exact failure `the-cancel-key-is-order-plus-act-date` exists to prevent, so it
//     must be prevented by the DATABASE and not merely by the key recipe.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS, and a committing
// test sharing a database with transaction-per-test ones would leave rows the others can see.
//
//	go test -tags raceaudit -run TestRace_Settlement -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"fmt"
	"testing"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

var settlementTables = []string{
	"settlement_logs",
	"order_settlements",
}

// ⚠ THE BUG THIS PROVES IS ABSENT: N DIFFERENT postings against one account must all land, and the
// balance must equal their sum. A lost update here is money that vanishes with no trace anywhere —
// the log would show every row and the projection would disagree with it.
func TestRace_SettlementPost_DoesNotLoseAnUpdate(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db)
	ctx := context.Background()

	const posters = 8
	const each int64 = 1_000

	// Each caller posts its own DISTINCT row, so nothing is de-duplicated and all 8 must apply.
	res := h.Race(t, posters, func(i int) error {
		_, err := svc.PostEntry(ctx, settlement_v1.PostInput{
			TeamID:         team,
			ShopID:         shop,
			OrderID:        order,
			UniqueID:       fmt.Sprintf("racer-%d", i),
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
			Change:         each,
			OccurredOn:     "2026-08-28",
		})

		return err
	})

	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d distinct posts failed — every one of them was a legitimate entry", res.Failed(), posters)
	}

	var balance int64

	err := db.Raw(`SELECT last_balance FROM order_settlements WHERE order_id = ?`, order).
		Scan(&balance).
		Error
	if err != nil {
		t.Fatalf("read the account: %v", err)
	}

	want := each * posters
	if balance != want {
		t.Fatalf("last_balance = %d after %d concurrent posts of %d, want %d — %d was lost to a "+
			"read-modify-write race", balance, posters, each, want, want-balance)
	}

	// THE PROJECTION MUST STILL EQUAL THE LOG. A balance that is right by luck is not the claim;
	// recomputing from the entries is.
	var summed int64

	err = db.Raw(`SELECT COALESCE(SUM(change), 0) FROM settlement_logs WHERE order_id = ?`, order).
		Scan(&summed).
		Error
	if err != nil {
		t.Fatalf("sum the log: %v", err)
	}

	if summed != balance {
		t.Fatalf("the log sums to %d but the account says %d — the projection has drifted from its "+
			"own source, which is the one thing that makes this ledger auditable", summed, balance)
	}
}

// ⚠ THE BUG THIS PROVES IS ABSENT: N retries of the SAME post must credit the account ONCE.
//
// This is the cancel-retry scenario in its worst form — not two calls a second apart, but eight in
// the same instant, all racing the existence check. Only the unique index can settle it; an
// application-level "does it already exist" read cannot.
func TestRace_SettlementPost_AbsorbsConcurrentRetries(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db)
	ctx := context.Background()

	const retries = 8

	res := h.Race(t, retries, func(int) error {
		_, err := svc.PostEntry(ctx, settlement_v1.PostInput{
			TeamID:         team,
			ShopID:         shop,
			OrderID:        order,
			UniqueID:       "order-5001-cancel",
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
			Change:         sale,
			OccurredOn:     "2026-08-28",
		})

		return err
	})

	res.Report(t)

	// ⚠ EXACTLY ONE ROW. Not "one succeeded" — retries are meant to SUCCEED idempotently, so the
	// count that matters is rows written, not callers refused.
	var rows int64

	err := db.Raw(`SELECT COUNT(*) FROM settlement_logs WHERE order_id = ? AND unique_id = ?`,
		order, "order-5001-cancel").
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("count the cancel rows: %v", err)
	}

	if rows != 1 {
		t.Fatalf("%d cancel rows for one unique_id after %d concurrent retries, want 1 — the account "+
			"has been credited %d times for one cancellation", rows, retries, rows)
	}

	var balance int64

	err = db.Raw(`SELECT last_balance FROM order_settlements WHERE order_id = ?`, order).
		Scan(&balance).
		Error
	if err != nil {
		t.Fatalf("read the account: %v", err)
	}

	if balance != sale {
		t.Fatalf("last_balance = %d after %d retries of one cancel, want %d — the retries were not "+
			"absorbed", balance, retries, sale)
	}
}
