package shipment_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
)

// ShipmentChannelCreate adds a courier. A code already held by ANY row is refused, and when that row is
// deleted the message says to restore it (a-deleted-code-is-restored-not-recreated).
//
// The pre-check only chooses the MESSAGE. Two creates racing past it both reach the INSERT, and the
// unique index refuses the second as AlreadyExists (dbError) — correctness never rests on the check.
func (s *Service) ShipmentChannelCreate(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelCreateRequest],
) (*connect.Response[shipmentv1.ShipmentChannelCreateResponse], error) {
	code := req.Msg.GetCode()

	var existing []shipment_service_models.ShipmentChannel

	err := s.db.
		WithContext(ctx).
		Where("code = ?", code).
		Limit(1).
		Find(&existing).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if len(existing) > 0 {
		msg := fmt.Sprintf("code %q already exists", code)
		if existing[0].IsDeleted {
			msg = fmt.Sprintf("code %q belongs to a deleted channel — restore it instead", code)
		}

		return nil, connect.NewError(connect.CodeAlreadyExists, errors.New(msg))
	}

	channel := shipment_service_models.ShipmentChannel{
		Code: code,
		Name: req.Msg.GetName(),
		Desc: req.Msg.GetDesc(),
	}

	err = s.db.
		WithContext(ctx).
		Create(&channel).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&shipmentv1.ShipmentChannelCreateResponse{Channel: toProto(&channel)}), nil
}
