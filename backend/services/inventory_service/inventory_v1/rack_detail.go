package inventory_v1

import (
	"context"
	"database/sql"
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
		Where("id = ? AND warehouse_id = ? AND deleted_at IS NULL", req.Msg.GetRackId(), req.Msg.GetTeamId()).
		First(&rack).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, rackNotFound()
		}

		return nil, rackDBError(err)
	}

	summary, err := s.rackSummary(ctx, req.Msg.GetTeamId(), req.Msg.GetRackId(), shelfInUnits(ctx))
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
//
// `unitsOnly` (shelfInUnits — a warehouse reader) leaves the value and the unknown-cost count UNSET and never asks what
// the units cost (a-warehouse-sees-ready-value-but-a-shelf-only-units).
func (s *Service) rackSummary(
	ctx context.Context,
	warehouseID, rackID uint64,
	unitsOnly bool,
) (*inventoryv1.RackSummary, error) {
	var levels []inventory_service_models.ProductPlacement

	// Rows with nothing on them are not on the shelf: a rack row can fall to 0 without being deleted (a
	// stock-take zeroing it), and counting it would value a product that is not there.
	err := s.db.
		WithContext(ctx).
		Where("placement_id = ? AND stock_count > 0", rackID).
		Find(&levels).
		Error
	if err != nil {
		return nil, err
	}

	summary := inventoryv1.RackSummary{}

	ids := make([]uint64, 0, len(levels))
	for i := range levels {
		summary.TotalOnHand += levels[i].StockCount

		ids = append(ids, levels[i].ProductID)
	}

	if !unitsOnly {
		err = s.valueRackSummary(ctx, &summary, warehouseID, levels, ids)
		if err != nil {
			return nil, err
		}
	}

	// WHEN THIS SHELF WAS LAST COUNTED — the later of a recount's `adjustment` rack row (0 when it found the rack exact)
	// and the last FINISHED stock count that held a row on it, which writes nothing on a rack it found exact. Derived,
	// never stored.
	var counted sql.NullTime

	err = s.db.
		WithContext(ctx).
		Raw(`SELECT GREATEST(
		    (SELECT MAX(created_at) FROM product_placement_logs WHERE warehouse_id = ? AND placement_id = ? AND change_type = ?),
		    (SELECT MAX(o.finalized_at) FROM opname_session_snapshots ss JOIN opname_sessions o ON o.id = ss.opname_session_id
		       WHERE ss.placement_id = ? AND o.status = 'finish'))`,
			warehouseID, rackID, string(inventory_service_models.TxAdjustment), rackID).
		Scan(&counted).
		Error
	if err != nil {
		return nil, err
	}

	// Never counted stays EMPTY rather than becoming a zero time. A new rack has genuinely never been
	// counted, and rendering that as an epoch date would be the screen inventing a stock-take.
	if counted.Valid {
		summary.LastCountedAt = counted.Time.UTC().Format(time.RFC3339)
	}

	return &summary, nil
}

// valueRackSummary sets what the shelf's units cost and how many of its products have no recorded cost — for a reader
// given the shelf's money (not shelfInUnits). Both are SET, a 0 included: an empty shelf is worth Rp 0 to the owner.
func (s *Service) valueRackSummary(
	ctx context.Context,
	summary *inventoryv1.RackSummary,
	warehouseID uint64,
	levels []inventory_service_models.ProductPlacement,
	ids []uint64,
) error {
	// The same unit value StockCost answers — shared rather than copied, so the shelf's value and an
	// order's COGS can never be computed two different ways (see unitCosts).
	costs, err := s.unitCosts(ctx, warehouseID, ids)
	if err != nil {
		return err
	}

	var (
		total   float64
		unknown uint32
	)

	for i := range levels {
		unitCost, known := costs[levels[i].ProductID]
		if !known {
			// ⚠ AN UNKNOWN COST CONTRIBUTES NOTHING RATHER THAN A GUESS, and the count of those
			// travels with the total — so a shelf of never-restocked goods reads as "worth little, and
			// here is why" instead of as a confident small number.
			unknown++

			continue
		}

		total += float64(levels[i].StockCount) * unitCost
	}

	summary.TotalValue = &total
	summary.UnknownCostProducts = &unknown

	return nil
}
