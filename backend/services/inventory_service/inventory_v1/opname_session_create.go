package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameSessionCreate plans a count: it snapshots the shelf book the plan selects and, by writing the rows, locks them
// (a-snapshot-is-made-from-product-placements, the-lock-is-the-open-snapshot-row).
//
//   - The plan's target is a FILTER on product_placements and is not kept (the-plan-target-is-only-a-filter): a team's
//     rows, a product's rows, or — for a rack — every row of every product on that rack, wherever it sits
//     (a-rack-plan-counts-its-products-everywhere). `all` takes the whole warehouse.
//   - Rows at 0 are taken (a-snapshot-includes-rows-at-zero); a deleted rack's are not.
//   - One active count per warehouse (one-active-count-per-warehouse): the database refuses a second, and the refusal
//     names the count that holds it.
//
// The product codes and names are asked of product_service BEFORE the transaction — a call to another service never
// runs under a lock — and the shelf rows are then read again under FOR SHARE, so a put-away, a move or a take that got
// there first is in the book the count copies, and one that comes after reads the count's lock.
func (s *Service) OpnameSessionCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameSessionCreateRequest],
) (*connect.Response[inventoryv1.OpnameSessionCreateResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	plan := opnamePlanOf(req.Msg.GetPlan())
	actor := actorFrom(ctx)

	filter, err := opnamePlanFilter(plan, req.Msg)
	if err != nil {
		return nil, opnameErr(err)
	}

	// The products the plan selects, read plainly so their names are asked outside the lock.
	productIDs, err := opnamePlanProducts(s.db.WithContext(ctx), warehouseID, filter)
	if err != nil {
		return nil, opnameErr(err)
	}

	if len(productIDs) == 0 {
		return nil, opnameErr(errOpnameNothingToCount)
	}

	facts, err := s.products.Facts(ctx, warehouseID, productIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ask product names: %w", err))
	}

	var session models.OpnameSession

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		session = models.OpnameSession{
			WarehouseID: warehouseID,
			Status:      models.OpnameActive,
			Plan:        plan,
			CreatedByID: actor,
		}

		createErr := tx.Create(&session).Error
		if isUniqueViolation(createErr) {
			return errOpnameActiveExists
		}

		if createErr != nil {
			return createErr
		}

		shelf, readErr := opnamePlanRows(tx, warehouseID, filter, true)
		if readErr != nil {
			return readErr
		}

		if len(shelf) == 0 {
			return errOpnameNothingToCount
		}

		rows := make([]models.OpnameSessionSnapshot, 0, len(shelf))
		for _, pp := range shelf {
			fact := facts[pp.ProductID]
			rows = append(rows, models.OpnameSessionSnapshot{
				WarehouseID:      warehouseID,
				TeamID:           pp.TeamID,
				ProductID:        pp.ProductID,
				PlacementID:      pp.PlacementID,
				OpnameSessionID:  session.ID,
				Status:           models.OpnameRowCreated,
				SystemStockCount: pp.StockCount,
				ProductCode:      fact.ProductCode,
				ProductName:      fact.Name,
			})
		}

		return tx.CreateInBatches(&rows, 500).Error
	})
	if errors.Is(err, errOpnameActiveExists) {
		return nil, s.opnameActiveRefusal(ctx, warehouseID)
	}

	if err != nil {
		return nil, opnameErr(err)
	}

	// A product that reached a shelf between the two reads has no name yet — asked now, outside the lock.
	err = s.fillOpnameNames(ctx, warehouseID, session.ID)
	if err != nil {
		return nil, opnameErr(err)
	}

	progress, err := opnameProgressOf(s.db.WithContext(ctx), []models.OpnameSession{session})
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameSessionCreateResponse{
		Session: opnameSessionProto(session, progress[session.ID], false),
	}), nil
}

// opnamePlanSelect is a plan with its target: the filter the snapshot reads product_placements through.
type opnamePlanSelect struct {
	plan        models.OpnamePlan
	teamID      uint64
	productID   uint64
	placementID uint64
}

// opnamePlanFilter checks the plan names exactly its own target, 0 for every other (the-plan-target-is-only-a-filter).
func opnamePlanFilter(plan models.OpnamePlan, msg *inventoryv1.OpnameSessionCreateRequest) (opnamePlanSelect, error) {
	f := opnamePlanSelect{
		plan: plan, teamID: msg.GetFilterTeamId(), productID: msg.GetFilterProductId(), placementID: msg.GetFilterPlacementId(),
	}

	named := 0
	for _, id := range []uint64{f.teamID, f.productID, f.placementID} {
		if id != 0 {
			named++
		}
	}

	ok := false

	switch plan {
	case models.OpnamePlanAll:
		ok = named == 0
	case models.OpnamePlanTeam:
		ok = named == 1 && f.teamID != 0
	case models.OpnamePlanProduct:
		ok = named == 1 && f.productID != 0
	case models.OpnamePlanPlacement:
		ok = named == 1 && f.placementID != 0
	}

	if !ok {
		return f, errOpnamePlanTarget
	}

	return f, nil
}

// opnamePlanWhere is the plan's condition over `pp` (product_placements) joined to `p` (its live rack).
func opnamePlanWhere(warehouseID uint64, f opnamePlanSelect) (string, []any) {
	base := "pp.warehouse_id = ? AND p.deleted_at IS NULL"

	switch f.plan {
	case models.OpnamePlanTeam:
		return base + " AND pp.team_id = ?", []any{warehouseID, f.teamID}
	case models.OpnamePlanProduct:
		return base + " AND pp.product_id = ?", []any{warehouseID, f.productID}
	case models.OpnamePlanPlacement:
		// Every rack of every product on the planned rack (a-rack-plan-counts-its-products-everywhere).
		return base + " AND pp.product_id IN (SELECT o.product_id FROM product_placements o WHERE o.warehouse_id = ? AND o.placement_id = ?)",
			[]any{warehouseID, warehouseID, f.placementID}
	default:
		return base, []any{warehouseID}
	}
}

// opnamePlanProducts is the distinct products a plan selects — a plain read.
func opnamePlanProducts(db *gorm.DB, warehouseID uint64, f opnamePlanSelect) ([]uint64, error) {
	where, args := opnamePlanWhere(warehouseID, f)

	var ids []uint64

	err := db.Raw(`SELECT DISTINCT pp.product_id FROM product_placements pp JOIN placements p ON p.id = pp.placement_id
		WHERE `+where+` ORDER BY pp.product_id`, args...).Scan(&ids).Error
	if err != nil {
		return nil, fmt.Errorf("the plan's products: %w", err)
	}

	return ids, nil
}

// opnamePlanRows is the shelf rows a plan selects, rows at 0 included, in id order — FOR SHARE when lock, which is the
// order every writer locks them in, so the snapshot queues behind a write already holding them. Their RACK rows are
// locked FOR SHARE too: a rack delete locks its row first (a-rack-a-count-holds-cannot-be-deleted), so a count waits for
// a delete in flight and then re-checks `p.deleted_at` — leaving the deleted rack out — and a delete waits for a count in
// flight and then reads its rows and refuses.
func opnamePlanRows(tx *gorm.DB, warehouseID uint64, f opnamePlanSelect, lock bool) ([]models.ProductPlacement, error) {
	where, args := opnamePlanWhere(warehouseID, f)

	locking := ""
	if lock {
		locking = " FOR SHARE OF pp, p"
	}

	var rows []models.ProductPlacement

	err := tx.Raw(`SELECT pp.* FROM product_placements pp JOIN placements p ON p.id = pp.placement_id
		WHERE `+where+` ORDER BY pp.id`+locking, args...).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("the plan's shelf rows: %w", err)
	}

	return rows, nil
}

// opnameActiveRefusal names the count that holds the warehouse, so the admin knows what to finish or cancel
// (an-abandoned-count-waits-for-the-admin).
func (s *Service) opnameActiveRefusal(ctx context.Context, warehouseID uint64) error {
	var active models.OpnameSession

	err := s.db.WithContext(ctx).Where("warehouse_id = ? AND status = ?", warehouseID, models.OpnameActive).Take(&active).Error
	if err != nil {
		return connect.NewError(connect.CodeFailedPrecondition, errOpnameActiveExists)
	}

	return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%w: count #%d, started by user #%d at %s",
		errOpnameActiveExists, active.ID, active.CreatedByID, active.CreatedAt.In(jakarta).Format("2006-01-02 15:04 MST")))
}

// fillOpnameNames asks product_service for the names of a session's rows that have none, and writes them — the rows a
// shelf gained between the plan's plain read and its locked one.
func (s *Service) fillOpnameNames(ctx context.Context, warehouseID, sessionID uint64) error {
	var missing []uint64

	err := s.db.WithContext(ctx).Model(&models.OpnameSessionSnapshot{}).
		Where("opname_session_id = ? AND product_name = ''", sessionID).
		Distinct().Pluck("product_id", &missing).Error
	if err != nil || len(missing) == 0 {
		return err
	}

	facts, err := s.products.Facts(ctx, warehouseID, missing)
	if err != nil {
		// The count stands without the label; a screen falls back to the id.
		return nil
	}

	for _, id := range missing {
		fact, ok := facts[id]
		if !ok || fact.Name == "" {
			continue
		}

		err = s.db.WithContext(ctx).Model(&models.OpnameSessionSnapshot{}).
			Where("opname_session_id = ? AND product_id = ?", sessionID, id).
			Updates(map[string]any{"product_code": fact.ProductCode, "product_name": fact.Name}).Error
		if err != nil {
			return err
		}
	}

	return nil
}
