package expense_v1

import (
	"context"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseCreate records money that went out (#168).
//
// The row says WHO TYPED IT, taken from the caller's identity rather than the request. A client
// supplying its own `created_by` could file somebody else's name against a number that moves profit,
// and the one thing this field exists for is to answer "whose number is this".
func (s *Service) ExpenseCreate(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseCreateRequest],
) (*connect.Response[expensev1.ExpenseCreateResponse], error) {
	// The date the cost BELONGS TO. Re-checked here rather than trusted from the pattern: unit tests
	// bypass the validation interceptor, and a pattern cannot tell "2026-02-31" from a real day.
	occurred, err := parseDate(req.Msg.GetOccurredAt())
	if err != nil {
		return nil, costErr(err)
	}

	row := expense_service_models.ExpenseRecord{
		TeamID:     req.Msg.GetTeamId(),
		ShopID:     req.Msg.GetShopId(),
		Kind:       int32(req.Msg.GetKind()),
		Amount:     req.Msg.GetAmount(),
		OccurredAt: occurred,
		Note:       req.Msg.GetNote(),
		CreatedBy:  actorFrom(ctx),
	}

	err = s.db.WithContext(ctx).Create(&row).Error
	if err != nil {
		return nil, costErr(err)
	}

	return connect.NewResponse(&expensev1.ExpenseCreateResponse{Expense: costToProto(&row)}), nil
}
