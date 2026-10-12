package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackDetail returns one rack of the scoped warehouse (#138) — the header of its detail page.
//
// The scope IS the WHERE clause: a rack belonging to another warehouse reads as NotFound, never
// PermissionDenied, or the error itself would confirm the id exists.
func (s *Service) RackDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackDetailRequest],
) (*connect.Response[inventoryv1.RackDetailResponse], error) {
	var rack inventory_service_models.Rack

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND warehouse_id = ? AND deleted = ?", req.Msg.GetRackId(), req.Msg.GetTeamId(), false).
		First(&rack).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, rackNotFound()
		}

		return nil, rackDBError(err)
	}

	summary, err := s.rackSummary(ctx, req.Msg.GetTeamId(), req.Msg.GetRackId())
	if err != nil {
		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackDetailResponse{
		Rack:    rackToProto(&rack),
		Summary: summary,
	}), nil
}

// rackSummary is the two header tiles of the detail page (#197): what is on this shelf, and when it
// was last counted.
//
// ⚠ IT VALUES THE WHOLE SHELF, NOT ONE PAGE OF IT. The contents are paginated (`RackStock`), so a
// total computed from the loaded page would be a header that changed as somebody paged — a number
// that moves while the shelf does not.
func (s *Service) rackSummary(
	ctx context.Context,
	warehouseID, rackID uint64,
) (*inventoryv1.RackSummary, error) {
	var levels []inventory_service_models.StockLevel

	// Rows with nothing on them are not on the shelf: a level can fall to 0 without being deleted (a
	// stock-take zeroing it), and counting it would value a product that is not there.
	err := s.db.
		WithContext(ctx).
		Where("rack_id = ? AND on_hand > 0", rackID).
		Find(&levels).
		Error
	if err != nil {
		return nil, err
	}

	summary := inventoryv1.RackSummary{}

	ids := make([]uint64, 0, len(levels))
	for i := range levels {
		summary.TotalOnHand += levels[i].OnHand

		ids = append(ids, levels[i].ProductID)
	}

	// The same HPP query StockCost runs — shared rather than copied, so the shelf's value and an
	// order's COGS can never be computed two different ways (see unitCosts).
	costs, err := s.unitCosts(ctx, warehouseID, ids)
	if err != nil {
		return nil, err
	}

	for i := range levels {
		unitCost, known := costs[levels[i].ProductID]
		if !known {
			// ⚠ AN UNKNOWN COST CONTRIBUTES NOTHING RATHER THAN A GUESS, and the count of those
			// travels with the total — so a shelf of never-restocked goods reads as "worth little, and
			// here is why" instead of as a confident small number.
			summary.UnknownCostProducts++

			continue
		}

		summary.TotalValue += levels[i].OnHand * unitCost
	}

	// WHEN THIS SHELF WAS LAST COUNTED. A stock-take is an ADJUST naming the rack (#139), so this is
	// derived from the ledger rather than stored — there is no "last counted" column that could drift
	// from the movements that actually happened.
	var counted inventory_service_models.StockMovement

	err = s.db.
		WithContext(ctx).
		Where("warehouse_id = ? AND rack_id = ? AND kind = ?",
			warehouseID, rackID, int32(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST)).
		Order("id DESC").
		Take(&counted).
		Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	// Never counted stays EMPTY rather than becoming a zero time. A new rack has genuinely never been
	// counted, and rendering that as an epoch date would be the screen inventing a stock-take.
	if err == nil {
		summary.LastCountedAt = counted.CreatedAt.Format(time.RFC3339)
	}

	return &summary, nil
}
