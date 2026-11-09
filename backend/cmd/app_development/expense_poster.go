package main

import (
	"context"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// expensePoster joins inventory_service to expense_service (#211): when a warehouse writes off a
// batch's units as damaged or lost, the money they were worth is recorded as an operational expense
// the warehouse bears.
//
// Same shape as liabilityPoster beside it — the composition root is the one place allowed to know
// two services at once, inventory declares the interface it needs, and this adapter is the whole
// dependency. It calls the RPC handler directly (an internal call, so the policy interceptor does not
// run); the acting user rides in the ctx, so the expense records who wrote it off.
type expensePoster struct {
	expense *expense_v1.Service
	// The clock the write-off is dated by. time.Now but in a test.
	now func() time.Time
}

func NewExpensePoster(expense *expense_v1.Service) inventory_v1.ExpensePoster {
	return &expensePoster{expense: expense, now: time.Now}
}

func (p *expensePoster) PostStockLoss(ctx context.Context, warehouseID uint64, amount float64, note string) error {
	_, err := p.expense.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: warehouseID,
		// STOCK_LOSS, not OPERATIONAL (owner, 2026-08-14). Shrinkage used to land in the same bucket as
		// rent and electricity, which made "how much did we break this month" unanswerable — and that
		// is the question a warehouse's own P&L is largely made of.
		Kind:   expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS,
		Amount: amount,
		// THE JAKARTA DAY of the write-off (the-system-runs-on-jakarta-time), never the host's: a UTC host reads 00:00–07:00
		// WIB as the day before, so a loss counted at 00:30 would land on yesterday's books.
		OccurredAt: expense_v1.JakartaDay(p.now()),
		Note:       note,
	}))

	return err
}
