package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// A WRITTEN-OFF BATCH IS FILED AS STOCK_LOSS, NOT OPERATIONAL (owner, 2026-08-14).
//
// This test exists because nothing else could catch the kind being wrong. inventory_service's own tests
// inject a `recordingExpense` fake and assert the AMOUNT, which is all they can see — the fake never
// reaches expense_service, so the kind the real adapter chooses is invisible to them. This is the only
// place the two halves meet a database together.
//
// It matters because the kind is the whole point of the change. Shrinkage used to land in OPERATIONAL
// beside rent and electricity, so "how much did we break this month" had no answer — and that is most of
// what a warehouse's own P&L is made of. A silent regression to OPERATIONAL would not fail anything, it
// would just quietly stop answering the question again.
func TestExpensePoster_FilesAStockWriteOffUnderItsOwnKind(t *testing.T) {
	db := san_testdb.DB(t)
	expenses := expense_v1.NewService(db)
	poster := NewExpensePoster(expenses)

	// Synthetic, for the reason spelled out in the test below: this asserts a total, and a committed
	// row left in `warehouse_test` by a seed would quietly change it.
	const warehouse uint64 = 9_000_010

	err := poster.PostStockLoss(context.Background(), warehouse, 1_250_000, "broken on the forklift")
	if err != nil {
		t.Fatalf("PostStockLoss: %v", err)
	}

	res, err := expenses.ExpenseList(context.Background(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: warehouse,
		Filter: &expensev1.ExpenseListFilter{Kind: expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ExpenseList: %v", err)
	}

	if got := res.Msg.GetTotals().GetTotal(); got != 1_250_000 {
		t.Fatalf("stock-loss total = %d, want 1250000 — the write-off did not land under STOCK_LOSS", got)
	}

	// And it is NOT ALSO sitting in Operational. The two must be disjoint, or the statement's
	// "of which stock written off" line would double-count against its own expenses total.
	res, err = expenses.ExpenseList(context.Background(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: warehouse,
		Filter: &expensev1.ExpenseListFilter{Kind: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ExpenseList(operational): %v", err)
	}

	if got := res.Msg.GetTotals().GetTotal(); got != 0 {
		t.Fatalf("operational total = %d, want 0 — a stock write-off must not also count as operational", got)
	}
}

// The write-off lands on the WAREHOUSE's own books, never on the team that owned the goods.
//
// A warehouse holds stock it does not own, so "who bears the loss" is a real question with a decided
// answer: the warehouse does (owner). Nothing recharges it onward — expense_records carries ONE team per
// row by design — and this pins that down, because posting it to the goods' owner instead would be an
// easy and entirely plausible mistake.
func TestExpensePoster_TheLossLandsOnTheWarehouseNotTheGoodsOwner(t *testing.T) {
	db := san_testdb.DB(t)
	expenses := expense_v1.NewService(db)
	poster := NewExpensePoster(expenses)

	// ⚠ SYNTHETIC IDS, deliberately far from the dev fixture's.
	//
	// san_testdb rolls this test's own writes back, but it cannot roll back rows somebody COMMITTED
	// earlier — and `warehouse_test` is a real database that a seed or a screenshot session may have
	// left data in. This test asserts a team was charged NOTHING, which is exactly the shape of
	// assertion a stray committed row turns into a false failure. Team 2 is Dev Warehouse in the
	// fixture; reading it here failed the moment anything had been seeded against it.
	const (
		warehouse  uint64 = 9_000_001
		goodsOwner uint64 = 9_000_002
		writtenOff int64  = 400_000
	)

	err := poster.PostStockLoss(context.Background(), warehouse, writtenOff, "lost in the racks")
	if err != nil {
		t.Fatalf("PostStockLoss: %v", err)
	}

	owner, err := expenses.ExpenseList(context.Background(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: goodsOwner,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ExpenseList(goods owner): %v", err)
	}

	if got := owner.Msg.GetTotals().GetTotal(); got != 0 {
		t.Fatalf("the goods' owner was charged %d for stock the warehouse lost", got)
	}

	// And the warehouse WAS charged. Without this the test would still pass if PostStockLoss silently
	// wrote nothing at all — "nobody was charged" is not the same claim as "the right team was".
	held, err := expenses.ExpenseList(context.Background(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: warehouse,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ExpenseList(warehouse): %v", err)
	}

	if got := held.Msg.GetTotals().GetTotal(); got != writtenOff {
		t.Fatalf("the warehouse bears %d of the loss, want %d", got, writtenOff)
	}
}
