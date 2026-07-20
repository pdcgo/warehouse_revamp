package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockAccessRevoke takes back a selling team's right to draw this warehouse's stock (#147).
//
// SOFT, so the revocation is auditable: "who was allowed to take our stock, and when did that stop" is
// exactly the question someone asks after a discrepancy, and a deleted row cannot answer it. The
// partial unique index means the pair can be granted again later without losing that it once lapsed.
//
// Revoked by the PAIR rather than by row id, because "stop letting team 7 draw from us" is the sentence
// a person actually means — and it stays correct even if the row was re-created since they last looked.
func (s *Service) StockAccessRevoke(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAccessRevokeRequest],
) (*connect.Response[inventoryv1.StockAccessRevokeResponse], error) {
	// The warehouse_id clause is the scope check — it is what stops one warehouse revoking another's
	// arrangements by guessing a selling team id.
	res := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockAccessGrant{}).
		Where("warehouse_id = ? AND selling_team_id = ? AND revoked = ?",
			req.Msg.GetTeamId(), req.Msg.GetSellingTeamId(), false).
		Updates(map[string]any{"revoked": true, "updated_at": time.Now()})
	if res.Error != nil {
		return nil, stockAccessErr(res.Error)
	}

	// Revoking something that was never granted is NotFound, not a silent success: a caller must not be
	// told "they can no longer draw from you" when they never could.
	if res.RowsAffected == 0 {
		return nil, stockAccessErr(errStockAccessMissing)
	}

	return connect.NewResponse(&inventoryv1.StockAccessRevokeResponse{}), nil
}
