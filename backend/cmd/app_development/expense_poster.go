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
// Same shape as settlementPoster beside it — the composition root is the one place allowed to know
// two services at once, inventory declares the interface it needs, and this adapter is the whole
// dependency. It calls the RPC handler directly (an internal call, so the policy interceptor does not
// run); the acting user rides in the ctx, so the expense records who wrote it off.
type expensePoster struct {
	expense *expense_v1.Service
}

func NewExpensePoster(expense *expense_v1.Service) inventory_v1.ExpensePoster {
	return &expensePoster{expense: expense}
}

func (p *expensePoster) PostStockLoss(ctx context.Context, warehouseID uint64, amount int64, note string) error {
	_, err := p.expense.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId:     warehouseID,
		Kind:       expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL,
		Amount:     amount,
		OccurredAt: time.Now().Format("2006-01-02"),
		Note:       note,
	}))

	return err
}
