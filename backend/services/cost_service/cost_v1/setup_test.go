package cost_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	costv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/cost/v1"
	cost_v1 "github.com/pdcgo/warehouse_revamp/backend/services/cost_service/cost_v1"
)

const teamA uint64 = 2

func newService(t *testing.T, db *gorm.DB) *cost_v1.Service {
	t.Helper()

	return cost_v1.NewService(db)
}

func page1() *commonv1.PageFilter {
	return &commonv1.PageFilter{Page: 1, Limit: 50}
}

// record enters one cost, so a test reads as the money it is describing rather than as message
// construction.
func record(
	t *testing.T,
	svc *cost_v1.Service,
	kind costv1.CostKind,
	amount int64,
	on string,
) *costv1.CostRecord {
	t.Helper()

	res, err := svc.CostCreate(context.Background(), connect.NewRequest(&costv1.CostCreateRequest{
		TeamId: teamA, Kind: kind, Amount: amount, OccurredAt: on,
	}))
	if err != nil {
		t.Fatalf("CostCreate(%v, %d, %s): %v", kind, amount, on, err)
	}

	return res.Msg.GetCost()
}
