package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameSessionDetail is one count's header and progress. Another warehouse's count reads as not found. A counter's read
// of an unfinished count carries no difference count (a-count-is-blind-then-revealed).
func (s *Service) OpnameSessionDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameSessionDetailRequest],
) (*connect.Response[inventoryv1.OpnameSessionDetailResponse], error) {
	db := s.db.WithContext(ctx)

	session, err := opnameSessionOf(db, req.Msg.GetTeamId(), req.Msg.GetSessionId(), "")
	if err != nil {
		return nil, opnameErr(err)
	}

	progress, err := opnameProgressOf(db, []models.OpnameSession{session})
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameSessionDetailResponse{
		Session: opnameSessionProto(session, progress[session.ID], isCounterRead(ctx)),
	}), nil
}
