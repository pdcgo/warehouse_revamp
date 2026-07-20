package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockAccessGrant records that this WAREHOUSE lets a SELLING team draw its stock (#147).
//
// The warehouse is the one granting — `team_id` is the warehouse and carries use_scope — because it is
// the warehouse's stock being made drawable. A selling team cannot grant itself access to anyone.
//
// ⚠ Granting does nothing yet. Nothing consults these rows until #148 teaches the scope check to read
// them; this ships INERT on purpose, so the change that touches the access interceptor lands alone and
// reviewable rather than buried under a new table.
func (s *Service) StockAccessGrant(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAccessGrantRequest],
) (*connect.Response[inventoryv1.StockAccessGrantResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	sellingTeamID := req.Msg.GetSellingTeamId()

	// A warehouse already has full access to its own stock through its own roles, so this row would be
	// a no-op that reads like a permission. The DB CHECK is the backstop; this is the message.
	if warehouseID == sellingTeamID {
		return nil, stockAccessErr(errStockAccessSelf)
	}

	grant := inventory_service_models.StockAccessGrant{
		WarehouseID:   warehouseID,
		SellingTeamID: sellingTeamID,
	}

	// The partial unique index is what makes granting twice an AlreadyExists rather than a second row —
	// and, because it is partial on `revoked = FALSE`, a pair that was revoked can be granted again.
	err := s.db.WithContext(ctx).Create(&grant).Error
	if err != nil {
		return nil, stockAccessErr(err)
	}

	return connect.NewResponse(&inventoryv1.StockAccessGrantResponse{
		Grant: stockAccessGrantToProto(&grant),
	}), nil
}
