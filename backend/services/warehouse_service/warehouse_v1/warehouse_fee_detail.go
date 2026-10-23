package warehouse_v1

import (
	"context"

	"connectrpc.com/connect"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// WarehouseFeeDetail is the warehouse's own fee configuration, for its settings screen. A warehouse that never set one
// gets an ABSENT fee, not NotFound: it is a normal state — the one that takes no orders, and the screen asks to fix it.
func (s *Service) WarehouseFeeDetail(
	ctx context.Context,
	req *connect.Request[warehousev1.WarehouseFeeDetailRequest],
) (*connect.Response[warehousev1.WarehouseFeeDetailResponse], error) {
	var rows []warehouse_service_models.WarehouseFee

	// Find, not First: no row is an answer, not ErrRecordNotFound.
	err := s.db.
		WithContext(ctx).
		Where("warehouse_id = ?", req.Msg.GetTeamId()).
		Limit(1).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	res := &warehousev1.WarehouseFeeDetailResponse{}
	if len(rows) > 0 {
		res.Fee = feeToProto(&rows[0])
	}

	return connect.NewResponse(res), nil
}
