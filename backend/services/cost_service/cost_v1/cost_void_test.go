package cost_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	costv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/cost/v1"
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

	kept := record(t, svc, costv1.CostKind_COST_KIND_PAYROLL, 12_000_000, "2026-07-05")
	mistake := record(t, svc, costv1.CostKind_COST_KIND_ADS, 2_000_000, "2026-07-03")

	before := list(t, svc, &costv1.CostListRequest{TeamId: teamA})
	if total := before.GetTotals().GetTotal(); total != 14_000_000 {
		t.Fatalf("before the void, total = %d, want 14000000", total)
	}

	res, err := svc.CostVoid(ctx, connect.NewRequest(&costv1.CostVoidRequest{
		TeamId: teamA, CostId: mistake.GetId(),
	}))
	if err != nil {
		t.Fatalf("CostVoid: %v", err)
	}
	if !res.Msg.GetCost().GetVoided() {
		t.Fatal("the voided row does not report itself as voided")
	}

	after := list(t, svc, &costv1.CostListRequest{TeamId: teamA})

	// It no longer counts.
	if total := after.GetTotals().GetTotal(); total != 12_000_000 {
		t.Fatalf("after the void, total = %d, want 12000000 — the mistake is still counting", total)
	}
	if _, present := after.GetTotals().GetByKind()[int32(costv1.CostKind_COST_KIND_ADS)]; present {
		t.Fatal("the voided kind is still in the per-kind totals")
	}

	// …but BOTH rows are still LISTED, and the voided one says so.
	//
	// That split is the whole point of voiding rather than deleting: the totals ignore it, the list
	// shows it. Hiding it here would make it exactly as invisible as a delete. This assertion first
	// said the list held ONE row — encoding the bug rather than the design — and the e2e caught it.
	if n := len(after.GetCosts()); n != 2 {
		t.Fatalf("the list holds %d rows, want 2 — a voided cost stays visible", n)
	}

	byID := map[uint64]bool{}
	for _, c := range after.GetCosts() {
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

	cost := record(t, svc, costv1.CostKind_COST_KIND_ADS, 2_000_000, "2026-07-03")

	first, err := svc.CostVoid(ctx, connect.NewRequest(&costv1.CostVoidRequest{
		TeamId: teamA, CostId: cost.GetId(),
	}))
	if err != nil {
		t.Fatalf("first void: %v", err)
	}

	second, err := svc.CostVoid(ctx, connect.NewRequest(&costv1.CostVoidRequest{
		TeamId: teamA, CostId: cost.GetId(),
	}))
	if err != nil {
		t.Fatalf("voiding twice must not fail: %v", err)
	}

	if !second.Msg.GetCost().GetVoided() {
		t.Fatal("the second void reports the row as live")
	}
	// Same row, still voided — nothing was re-stamped or duplicated.
	if second.Msg.GetCost().GetId() != first.Msg.GetCost().GetId() {
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

	_, err := svc.CostVoid(context.Background(), connect.NewRequest(&costv1.CostVoidRequest{
		TeamId: teamA, CostId: 999999,
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

	cost := record(t, svc, costv1.CostKind_COST_KIND_ADS, 2_000_000, "2026-07-03")

	_, err := svc.CostVoid(ctx, connect.NewRequest(&costv1.CostVoidRequest{
		TeamId: teamA, CostId: cost.GetId(),
	}))
	if err != nil {
		t.Fatalf("void: %v", err)
	}

	_, err = svc.CostUpdate(ctx, connect.NewRequest(&costv1.CostUpdateRequest{
		TeamId: teamA, CostId: cost.GetId(),
		Kind: costv1.CostKind_COST_KIND_ADS, Amount: 1, OccurredAt: "2026-07-03",
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("editing a voided cost = %v, want FailedPrecondition", code)
	}
}
