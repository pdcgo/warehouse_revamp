package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestDetail returns ONE request in full, with its lines (#125).
//
// Scoped exactly like List, and the scope IS the WHERE clause: a team may read a request it MADE
// (team_id) or one TARGETING it as a warehouse (warehouse_id). Anything else reads as
// NotFound rather than PermissionDenied — a permission error would confirm the id exists.
func (s *Service) RestockRequestDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestDetailRequest],
) (*connect.Response[inventoryv1.RestockRequestDetailResponse], error) {
	teamID := req.Msg.GetTeamId()

	var rr inventory_service_models.Restock

	err := s.db.
		WithContext(ctx).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		// What did not become stock at the door (#154) — and, read from the ledger below, where each line went. The
		// DETAIL carries them because this is the screen that shows them; the LIST deliberately does not — see
		// restock_request_list.go.
		Preload("Problems", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		// THE TRAIL (00024), oldest first — this is the screen with a timeline on it, and the list is
		// deliberately without one for the same reason it skips placements.
		//
		// Ordered by `created_at` and then `id`: it is the row's own moment (a backfilled row carries a date from
		// months ago), and the id breaks the tie when two rows share a second — an edit made in the same second as the
		// create must still read second.
		Preload("Logs", func(db *gorm.DB) *gorm.DB { return db.Order("created_at ASC, id ASC") }).
		Where("id = ? AND (team_id = ? OR warehouse_id = ?)", req.Msg.GetRequestId(), teamID, teamID).
		First(&rr).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	err = loadPutAway(s.db.WithContext(ctx), &rr)
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestDetailResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// loadPutAway fills each line's placements from the accept's own rack rows — the placement ledger's record of where the
// good units went (putting-away-at-accept-is-not-a-move). A restock not yet accepted has none.
func loadPutAway(db *gorm.DB, rr *inventory_service_models.Restock) error {
	if rr.TransactionID == 0 {
		return nil
	}

	var rows []struct {
		ProductID   uint64
		PlacementID uint64
		Quantity    int64
	}

	err := db.
		Table("product_placement_logs").
		Select("product_id, placement_id, stock_change AS quantity").
		Where("transaction_id = ? AND stock_change > 0", rr.TransactionID).
		Order("id ASC").
		Scan(&rows).
		Error
	if err != nil {
		return err
	}

	for i := range rr.Items {
		rr.Items[i].Placements = nil

		for _, row := range rows {
			if row.ProductID != rr.Items[i].ProductID {
				continue
			}

			rack := row.PlacementID
			rr.Items[i].Placements = append(rr.Items[i].Placements, inventory_service_models.RestockReceivedPlacement{
				RestockItemID: rr.Items[i].ID,
				RackID:        &rack,
				Quantity:      row.Quantity,
			})
		}
	}

	return nil
}
