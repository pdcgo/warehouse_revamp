package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #169 — a cost is CORRECTABLE, because a person typed it.
//
// That is the one fact separating this service from revenue: a revenue row is written by the system
// from an order and frozen, so it has nothing to correct. This one is entered by hand.
func TestCostUpdate_CorrectsEveryField(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	original := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")

	res, err := svc.ExpenseUpdate(ctx, connect.NewRequest(&expensev1.ExpenseUpdateRequest{
		TeamId: teamA, ExpenseId: original.GetId(),
		Kind: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, Amount: 850_000,
		OccurredAt: "2026-07-09", ShopId: 5, Note: "electricity, corrected",
	}))
	if err != nil {
		t.Fatalf("ExpenseUpdate: %v", err)
	}

	got := res.Msg.GetExpense()

	if got.GetKind() != expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL || got.GetAmount() != 850_000 {
		t.Fatalf("corrected to %v / %d, want OPERATIONAL / 850000", got.GetKind(), got.GetAmount())
	}
	if got.GetOccurredAt() != "2026-07-09" || got.GetShopId() != 5 {
		t.Fatalf("corrected to %s / shop %d, want 2026-07-09 / shop 5", got.GetOccurredAt(), got.GetShopId())
	}

	// Read back through the list, so this proves the correction was STORED rather than echoed.
	back := list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA})
	if n := len(back.GetExpenses()); n != 1 {
		t.Fatalf("list holds %d rows after a correction, want 1 — an update must not insert", n)
	}
	if total := back.GetTotals().GetTotal(); total != 850_000 {
		t.Fatalf("total = %d after correcting 2000000 down to 850000", total)
	}
}

// #169 — CLEARING A FIELD IS AN EDIT, and the update must honour it.
//
// The handler writes with a COLUMN MAP rather than a struct, because GORM skips a struct's zero
// values: a struct update would silently keep the old shop and note while the form showed them gone.
// The same trap RestockRequestUpdate documents (#131).
func TestCostUpdate_ClearingAFieldActuallyClearsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	// Recorded WITH a shop and a note.
	created, err := svc.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, Amount: 800_000,
		OccurredAt: "2026-07-05", ShopId: 77, Note: "packing wages, Toko A",
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Corrected to name NO shop and carry NO note.
	_, err = svc.ExpenseUpdate(ctx, connect.NewRequest(&expensev1.ExpenseUpdateRequest{
		TeamId: teamA, ExpenseId: created.Msg.GetExpense().GetId(),
		Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, Amount: 800_000, OccurredAt: "2026-07-05",
		ShopId: 0, Note: "",
	}))
	if err != nil {
		t.Fatalf("ExpenseUpdate: %v", err)
	}

	// READ BACK FROM THE DATABASE, not from the update's own response.
	//
	// This is the whole test. The response is built from the in-memory struct the handler just
	// assigned, so it reports the cleared values whether or not they ever reached a column — asserting
	// on it proves the handler can assign to a local variable. Only a fresh read can tell you GORM
	// actually wrote the zero, which is precisely what a struct `Updates` would NOT have done.
	back := list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA})
	if n := len(back.GetExpenses()); n != 1 {
		t.Fatalf("list holds %d rows, want 1", n)
	}

	stored := back.GetExpenses()[0]

	if got := stored.GetShopId(); got != 0 {
		t.Fatalf("stored shop_id = %d after clearing it — a struct update keeps the old 77 because "+
			"GORM skips zero values", got)
	}
	if got := stored.GetNote(); got != "" {
		t.Fatalf("stored note = %q after clearing it", got)
	}
}

// #169 — another team's cost is NotFound, never PermissionDenied. The error itself must not confirm
// that an id exists.
func TestCostUpdate_AnotherTeamsCostIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 1000, "2026-07-01")

	_, err := svc.ExpenseUpdate(context.Background(), connect.NewRequest(&expensev1.ExpenseUpdateRequest{
		TeamId: 3, ExpenseId: mine.GetId(),
		Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 5, OccurredAt: "2026-07-01",
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("another team editing = %v, want NotFound", code)
	}
}
