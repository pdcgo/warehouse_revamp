package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

const teamA uint64 = 2

func newService(t *testing.T, db *gorm.DB) *expense_v1.Service {
	t.Helper()

	return expense_v1.NewService(db)
}

func page1() *commonv1.PageFilter {
	return &commonv1.PageFilter{Page: 1, Limit: 50}
}

// record enters one cost, so a test reads as the money it is describing rather than as message
// construction.
func record(
	t *testing.T,
	svc *expense_v1.Service,
	kind expensev1.ExpenseKind,
	amount int64,
	on string,
) *expensev1.ExpenseRecord {
	t.Helper()

	res, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: kind, Amount: amount, OccurredAt: on,
	}))
	if err != nil {
		t.Fatalf("ExpenseCreate(%v, %d, %s): %v", kind, amount, on, err)
	}

	return res.Msg.GetExpense()
}
