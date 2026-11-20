package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// CustomShipmentDetail is one parcel in full — its lines and its trail — for the selling team that owns it, the
// warehouse that ships it, or the root team. The warehouse reads NO seller money in any field: the sample's value, each
// line's value, the team's account and a TEAM payer's cost are left unset; a WAREHOUSE payer's cost is the ongkir it paid
// (a-warehouse-sees-no-seller-money, the-warehouse-sees-the-ongkir-it-paid, the-custom-shipments-prototype-is-accepted).
// A parcel the team is no side of reads as NotFound. A sample's racks are its take's: StockPickLocations(warehouse_id,
// transaction_id).
func (s *Service) CustomShipmentDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentDetailRequest],
) (*connect.Response[inventoryv1.CustomShipmentDetailResponse], error) {
	wire, err := customShipmentForWire(s.db.WithContext(ctx), req.Msg.GetId(), req.Msg.GetTeamId())
	if err != nil {
		return nil, customShipmentErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentDetailResponse{CustomShipment: wire}), nil
}
