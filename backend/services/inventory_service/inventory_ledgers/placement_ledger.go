package inventory_ledgers

import (
	"fmt"
	"sort"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Put is units arriving on one rack: a restock's put-away, a transfer's at the receiver, a found unit, a move's
// destination.
type Put struct {
	// The product's owner — the rack row's team.
	TeamID      uint64
	ProductID   uint64
	PlacementID uint64
	Count       int64
}

// RackChange is what one rack row moved.
type RackChange struct {
	PlacementID uint64
	ProductID   uint64
	// Signed: positive arrived, negative left.
	Change int64
	After  int64
}

// PutOnPlacements adds units to racks: every missing rack row created at 0 and every target row locked
// (EnsureAndLockRacks), then one update and one log insert for all of them (ledger-writes-are-set-based). Puts of the same
// product onto the same rack are summed into one row change. A row that already holds the product for another team, or
// sits in another warehouse, is refused.
func PutOnPlacements(
	tx *gorm.DB,
	t inventory_service_models.InventoryTransaction,
	changeType string,
	actorID uint64,
	description string,
	puts []Put,
) ([]RackChange, error) {
	byKey := map[RackKey]Put{}
	keys := make([]RackKey, 0, len(puts))

	for _, p := range puts {
		if p.Count <= 0 {
			return nil, fmt.Errorf("put of product %d on rack %d: count %d is not positive", p.ProductID, p.PlacementID, p.Count)
		}

		k := RackKey{ProductID: p.ProductID, PlacementID: p.PlacementID}
		existing, seen := byKey[k]
		if seen {
			existing.Count += p.Count
			byKey[k] = existing
			continue
		}

		byKey[k] = p
		keys = append(keys, k)
	}

	if len(keys) == 0 {
		return nil, nil
	}

	ensure := make([]RackRowToEnsure, 0, len(keys))
	for _, k := range keys {
		ensure = append(ensure, RackRowToEnsure{RackKey: k, TeamID: byKey[k].TeamID})
	}

	rows, err := EnsureAndLockRacks(tx, t.WarehouseID, ensure)
	if err != nil {
		return nil, err
	}

	sortRackKeys(keys)

	var w RackWrites

	changes := make([]RackChange, 0, len(keys))

	for _, k := range keys {
		p := byKey[k]
		row := rows[k]

		if row.TeamID != p.TeamID {
			return nil, fmt.Errorf("rack %d holds product %d for team %d, not team %d",
				row.PlacementID, row.ProductID, row.TeamID, p.TeamID)
		}

		change, applyErr := w.Apply(t, row, p.Count, changeType, actorID, description)
		if applyErr != nil {
			return nil, applyErr
		}

		changes = append(changes, change)
	}

	err = w.Flush(tx)
	if err != nil {
		return nil, err
	}

	return changes, nil
}

// LockedRacks is the owners' rack rows of some products in one warehouse, LOCKED, each product's in id order. A take
// reads and changes them in memory; RackWrites stores the result.
type LockedRacks struct {
	locked  map[ProductOwner]bool
	byOwner map[ProductOwner][]*inventory_service_models.ProductPlacement
}

// LockRacks locks every rack row of the given owners' products in the warehouse, in ONE statement in id order
// (batches-lock-before-shelves-by-id) — taken AFTER the batches.
func LockRacks(tx *gorm.DB, warehouseID uint64, owners []ProductOwner) (*LockedRacks, error) {
	out := &LockedRacks{
		locked:  map[ProductOwner]bool{},
		byOwner: map[ProductOwner][]*inventory_service_models.ProductPlacement{},
	}

	pairs := make([][]any, 0, len(owners))

	for _, o := range owners {
		if out.locked[o] {
			continue
		}

		out.locked[o] = true
		pairs = append(pairs, []any{o.TeamID, o.ProductID})
	}

	if len(pairs) == 0 {
		return out, nil
	}

	var rows []inventory_service_models.ProductPlacement

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND (team_id, product_id) IN ?", warehouseID, pairs).
		Order("id").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("lock rack rows of %d product(s): %w", len(pairs), err)
	}

	for i := range rows {
		r := &rows[i]
		key := ProductOwner{TeamID: r.TeamID, ProductID: r.ProductID}
		out.byOwner[key] = append(out.byOwner[key], r)
	}

	return out, nil
}

// PlacementTake is units leaving the owner's racks of one product in the transaction's warehouse, chosen by the system.
type PlacementTake struct {
	// The product's owner.
	TeamID      uint64
	ProductID   uint64
	Count       int64
	ChangeType  string
	ActorID     uint64
	Description string
}

// TakeFewestFirst takes units from the owner's LOCKED racks holding the FEWEST first, a tie going to the smaller rack id
// (an-order-takes-from-the-lowest-shelf-first); a line may split across racks
// (an-order-line-may-be-taken-from-several-racks). Too few units across all racks is refused before anything is recorded
// (a-shelf-never-goes-below-zero). A rack being counted goes last once opname is built
// (a-lock-stops-units-moving-not-sales).
func TakeFewestFirst(
	locked *LockedRacks,
	w *RackWrites,
	t inventory_service_models.InventoryTransaction,
	take PlacementTake,
) ([]RackChange, error) {
	if take.Count <= 0 {
		return nil, fmt.Errorf("take of product %d: count %d is not positive", take.ProductID, take.Count)
	}

	key := ProductOwner{TeamID: take.TeamID, ProductID: take.ProductID}
	if !locked.locked[key] {
		return nil, fmt.Errorf("take of product %d: its rack rows of team %d were not locked", take.ProductID, take.TeamID)
	}

	rows := locked.byOwner[key]

	var available int64
	for _, r := range rows {
		available += r.StockCount
	}

	if available < take.Count {
		return nil, &NotEnoughStockError{ProductID: take.ProductID, Wanted: take.Count, Available: available, Ledger: "placements"}
	}

	order := make([]*inventory_service_models.ProductPlacement, 0, len(rows))
	for _, r := range rows {
		if r.StockCount > 0 {
			order = append(order, r)
		}
	}

	sort.SliceStable(order, func(a, b int) bool {
		if order[a].StockCount != order[b].StockCount {
			return order[a].StockCount < order[b].StockCount
		}

		return order[a].PlacementID < order[b].PlacementID
	})

	left := take.Count
	changes := make([]RackChange, 0, len(order))

	for _, row := range order {
		if left == 0 {
			break
		}

		n := min(left, row.StockCount)

		change, err := w.Apply(t, row, -n, take.ChangeType, take.ActorID, take.Description)
		if err != nil {
			return nil, err
		}

		changes = append(changes, change)
		left -= n
	}

	return changes, nil
}

func sortRackKeys(keys []RackKey) {
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].ProductID != keys[j].ProductID {
			return keys[i].ProductID < keys[j].ProductID
		}

		return keys[i].PlacementID < keys[j].PlacementID
	})
}
