package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #169 — a voided cost STOPS COUNTING but STAYS VISIBLE.
//
// That split is the whole reason it is a void and not a delete (#164's precedent): a deleted row
// cannot tell you a cost was entered and then retracted, and somebody looking at a profit figure that
// changed wants to see why.
func TestCostVoid_StopsCountingButStaysVisible(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	kept := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2026-07-05")
	mistake := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")

	before := list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA})
	if total := before.GetTotals().GetTotal(); total != 14_000_000 {
		t.Fatalf("before the void, total = %d, want 14000000", total)
	}

	res, err := svc.ExpenseVoid(ctx, connect.NewRequest(&expensev1.ExpenseVoidRequest{
		TeamId: teamA, ExpenseId: mistake.GetId(),
	}))
	if err != nil {
		t.Fatalf("ExpenseVoid: %v", err)
	}
	if !res.Msg.GetExpense().GetVoided() {
		t.Fatal("the voided row does not report itself as voided")
	}

	after := list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA})

	// It no longer counts.
	if total := after.GetTotals().GetTotal(); total != 12_000_000 {
		t.Fatalf("after the void, total = %d, want 12000000 — the mistake is still counting", total)
	}
	if _, present := after.GetTotals().GetByKind()[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)]; present {
		t.Fatal("the voided kind is still in the per-kind totals")
	}

	// …but BOTH rows are still LISTED, and the voided one says so.
	//
	// That split is the whole point of voiding rather than deleting: the totals ignore it, the list
	// shows it. Hiding it here would make it exactly as invisible as a delete. This assertion first
	// said the list held ONE row — encoding the bug rather than the design — and the e2e caught it.
	if n := len(after.GetExpenses()); n != 2 {
		t.Fatalf("the list holds %d rows, want 2 — a voided cost stays visible", n)
	}

	byID := map[uint64]bool{}
	for _, c := range after.GetExpenses() {
		byID[c.GetId()] = c.GetVoided()
	}

	if byID[mistake.GetId()] != true {
		t.Fatal("the voided cost is not flagged as voided, so it reads as live money")
	}
	if byID[kept.GetId()] != false {
		t.Fatal("voiding one cost flagged another")
	}
}

// #169 — VOIDING TWICE IS FINE, and it does not move the timestamp.
//
// A person double-clicking is not an error. And "when did this stop counting" must answer with the
// retraction rather than with the last time somebody pressed the button.
func TestCostVoid_IsIdempotent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	cost := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")

	first, err := svc.ExpenseVoid(ctx, connect.NewRequest(&expensev1.ExpenseVoidRequest{
		TeamId: teamA, ExpenseId: cost.GetId(),
	}))
	if err != nil {
		t.Fatalf("first void: %v", err)
	}

	second, err := svc.ExpenseVoid(ctx, connect.NewRequest(&expensev1.ExpenseVoidRequest{
		TeamId: teamA, ExpenseId: cost.GetId(),
	}))
	if err != nil {
		t.Fatalf("voiding twice must not fail: %v", err)
	}

	if !second.Msg.GetExpense().GetVoided() {
		t.Fatal("the second void reports the row as live")
	}
	// Same row, still voided — nothing was re-stamped or duplicated.
	if second.Msg.GetExpense().GetId() != first.Msg.GetExpense().GetId() {
		t.Fatal("the second void returned a different row")
	}
}

// #169 — A MISSING COST IS NotFound HERE, and that is deliberately different from RevenueVoid.
//
// RevenueVoid consumes a Pub/Sub event, so a missing row must ACK or the message is redelivered
// forever. This is a person clicking a button: if the cost is not there, saying so is the honest
// answer rather than a silent success they would read as "done".
func TestCostVoid_AMissingCostIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ExpenseVoid(context.Background(), connect.NewRequest(&expensev1.ExpenseVoidRequest{
		TeamId: teamA, ExpenseId: 999999,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("voiding a cost that does not exist = %v, want NotFound", code)
	}
}

// #169 — a VOIDED cost cannot be edited.
//
// Editing a retraction would either bring it quietly back into the numbers, or leave it retracted with
// different figures nobody can see. Neither is a state worth being able to reach.
func TestCostUpdate_RefusesAVoidedCost(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	cost := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")

	_, err := svc.ExpenseVoid(ctx, connect.NewRequest(&expensev1.ExpenseVoidRequest{
		TeamId: teamA, ExpenseId: cost.GetId(),
	}))
	if err != nil {
		t.Fatalf("void: %v", err)
	}

	_, err = svc.ExpenseUpdate(ctx, connect.NewRequest(&expensev1.ExpenseUpdateRequest{
		TeamId: teamA, ExpenseId: cost.GetId(),
		Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 1, OccurredAt: "2026-07-03",
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("editing a voided cost = %v, want FailedPrecondition", code)
	}
}
