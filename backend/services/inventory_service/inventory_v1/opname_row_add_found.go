package inventory_v1

import (
	"context"
	"fmt"
	"sort"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRowAddFound is a counter's "+ Add a product found here": a product the book does not have on this rack joins
// the count here, and every OTHER rack holding it joins too, so the netting sees a move instead of a surplus here and a
// shortage there (a-counter-may-add-a-product-found-here, a-rack-plan-counts-its-products-everywhere). Each new row
// takes the book the shelf row shows now — 0 on the rack it was found on, unless a put-away has since put it there.
//
// Refused when its team never had a batch of it in this warehouse: it is taken off the rack and comes in by the team's
// restock (a-unit-never-stocked-here-comes-in-by-restock). AlreadyExists when the count already has it on this rack.
//
// The new rows are made under the shelf rows' lock, as the snapshot is: every rack row of the product, the new one
// created at 0 first, locked in one id-ordered statement.
func (s *Service) OpnameRowAddFound(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRowAddFoundRequest],
) (*connect.Response[inventoryv1.OpnameRowAddFoundResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()
	placementID := req.Msg.GetPlacementId()
	db := s.db.WithContext(ctx)

	// Its label, asked before any lock.
	facts, err := s.products.Facts(ctx, warehouseID, []uint64{productID})
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ask the product's name: %w", err))
	}

	fact := facts[productID]

	var added []models.OpnameSessionSnapshot

	var session models.OpnameSession

	err = db.Transaction(func(tx *gorm.DB) error {
		var lockErr error

		session, lockErr = opnameSessionOf(tx, warehouseID, req.Msg.GetSessionId(), "SHARE")
		if lockErr != nil {
			return lockErr
		}

		if session.Status != models.OpnameActive {
			return errOpnameNotActive
		}

		_, rackErr := opnameRackOf(tx, session, placementID)
		if rackErr != nil {
			return rackErr
		}

		// The owner: the team of its newest batch here. None — the team never had it here.
		var owners []uint64

		ownerErr := tx.Model(&models.Batch{}).
			Where("warehouse_id = ? AND product_id = ?", warehouseID, productID).
			Order("id DESC").Limit(1).Pluck("team_id", &owners).Error
		if ownerErr != nil {
			return ownerErr
		}

		if len(owners) == 0 {
			return errOpnameNeverHere
		}

		owner := owners[0]

		// Every rack row of the product on a live rack here, the found one created at 0 if missing — locked in one
		// statement. A deleted rack joins nothing: it holds no unit (a-placement-deletes-at-zero-stock).
		var racks []uint64

		racksErr := tx.Table("product_placements AS pp").
			Joins("JOIN placements p ON p.id = pp.placement_id AND p.deleted_at IS NULL").
			Where("pp.warehouse_id = ? AND pp.product_id = ?", warehouseID, productID).
			Pluck("pp.placement_id", &racks).Error
		if racksErr != nil {
			return racksErr
		}

		ensure := []inventory_ledgers.RackRowToEnsure{{
			RackKey: inventory_ledgers.RackKey{ProductID: productID, PlacementID: placementID}, TeamID: owner,
		}}

		for _, rack := range racks {
			if rack != placementID {
				ensure = append(ensure, inventory_ledgers.RackRowToEnsure{
					RackKey: inventory_ledgers.RackKey{ProductID: productID, PlacementID: rack}, TeamID: owner,
				})
			}
		}

		locked, lockRacksErr := inventory_ledgers.EnsureAndLockRacks(tx, warehouseID, ensure)
		if lockRacksErr != nil {
			return lockRacksErr
		}

		keys := make([]inventory_ledgers.RackKey, 0, len(ensure))
		for _, e := range ensure {
			keys = append(keys, e.RackKey)
		}

		// Rows the count already holds — the only open rows in this warehouse are this count's.
		open, openErr := inventory_ledgers.CountLocks(tx, keys)
		if openErr != nil {
			return openErr
		}

		found := inventory_ledgers.RackKey{ProductID: productID, PlacementID: placementID}
		if _, held := open[found]; held {
			return errOpnameRowExists
		}

		for _, k := range keys {
			if _, held := open[k]; held {
				continue
			}

			row := locked[k]
			if row == nil {
				continue
			}

			added = append(added, models.OpnameSessionSnapshot{
				WarehouseID:      warehouseID,
				TeamID:           row.TeamID,
				ProductID:        productID,
				PlacementID:      k.PlacementID,
				OpnameSessionID:  session.ID,
				Status:           models.OpnameRowCreated,
				SystemStockCount: row.StockCount,
				FoundHere:        k == found,
				ProductCode:      fact.ProductCode,
				ProductName:      fact.Name,
			})
		}

		sort.Slice(added, func(i, j int) bool {
			if added[i].FoundHere != added[j].FoundHere {
				return added[i].FoundHere
			}

			return added[i].PlacementID < added[j].PlacementID
		})

		createErr := tx.Create(&added).Error
		if isUniqueViolation(createErr) {
			return errOpnameRowExists
		}

		return createErr
	})
	if err != nil {
		return nil, opnameErr(err)
	}

	mapped, err := opnameRowsProto(db, session.ID, added, nil, true)
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameRowAddFoundResponse{Rows: mapped}), nil
}
