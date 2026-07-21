package cost_v1

import (
	"context"

	"connectrpc.com/connect"

	costv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/cost/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/cost_service/cost_service_models"
)

// CostCreate records money that went out (#168).
//
// The row says WHO TYPED IT, taken from the caller's identity rather than the request. A client
// supplying its own `created_by` could file somebody else's name against a number that moves profit,
// and the one thing this field exists for is to answer "whose number is this".
func (s *Service) CostCreate(
	ctx context.Context,
	req *connect.Request[costv1.CostCreateRequest],
) (*connect.Response[costv1.CostCreateResponse], error) {
	// The date the cost BELONGS TO. Re-checked here rather than trusted from the pattern: unit tests
	// bypass the validation interceptor, and a pattern cannot tell "2026-02-31" from a real day.
	occurred, err := parseDate(req.Msg.GetOccurredAt())
	if err != nil {
		return nil, costErr(err)
	}

	row := cost_service_models.CostRecord{
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

	return connect.NewResponse(&costv1.CostCreateResponse{Cost: costToProto(&row)}), nil
}
