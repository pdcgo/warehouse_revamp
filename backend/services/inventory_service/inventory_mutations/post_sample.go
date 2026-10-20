package inventory_mutations

import (
	"fmt"
	"sort"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SampleLine is units of one product handed over from the rack.
type SampleLine struct {
	ProductID uint64
	Quantity  int64
}

// Sample is goods taken from ONE rack — the page's, chosen by staff, never by the system
// (a-sample-names-the-rack-it-was-taken-from) — and handed to a recipient.
type Sample struct {
	WarehouseID uint64
	PlacementID uint64
	ActorID     uint64
	Recipient   string
	Description string
	Lines       []SampleLine
}

// PostSample writes a sample: a stock-out at batch value from the owner's stock and nothing more, no money moved
// (a-sample-is-a-stock-out-at-batch-value). One `sample` transaction per owning team carries the recipient
// (a-sample-keeps-its-recipient); the owner's batches go oldest first, the units come off this one rack. Never rolled
// back (a-handed-over-sample-is-final). Every batch is taken before any rack row is locked
// (batches-lock-before-shelves-by-id). Returns the transactions in team id order.
func PostSample(tx *gorm.DB, s Sample) ([]models.InventoryTransaction, error) {
	qty := map[uint64]int64{}
	for _, l := range s.Lines {
		qty[l.ProductID] += l.Quantity
	}

	ids := sortedKeys(qty)

	var onRack []models.ProductPlacement

	err := tx.Where("placement_id = ? AND product_id IN ?", s.PlacementID, ids).Find(&onRack).Error
	if err != nil {
		return nil, fmt.Errorf("read the rack: %w", err)
	}

	owner := make(map[uint64]uint64, len(onRack))
	for _, r := range onRack {
		owner[r.ProductID] = r.TeamID
	}

	for _, id := range ids {
		if _, ok := owner[id]; !ok {
			return nil, fmt.Errorf("%w: product %d", ErrNotOnTheRack, id)
		}
	}

	// One transaction per owning team, created first so both ledgers can name it.
	txOf := map[uint64]models.InventoryTransaction{}
	teams := make([]uint64, 0)

	for _, id := range ids {
		if _, seen := txOf[owner[id]]; seen {
			continue
		}

		t, createErr := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
			WarehouseID: s.WarehouseID, TeamID: owner[id], TxType: models.TxSample, ActorID: s.ActorID,
			Description: s.Description, Recipient: s.Recipient,
		})
		if createErr != nil {
			return nil, createErr
		}

		txOf[owner[id]] = t
		teams = append(teams, owner[id])
	}

	// BATCHES, every product — locked in one statement, stored in one update and one log insert
	// (ledger-writes-are-set-based)...
	owners := make([]inventory_ledgers.ProductOwner, 0, len(ids))
	for _, id := range ids {
		owners = append(owners, inventory_ledgers.ProductOwner{TeamID: owner[id], ProductID: id})
	}

	locked, err := inventory_ledgers.LockBatches(tx, s.WarehouseID, owners)
	if err != nil {
		return nil, err
	}

	items := map[uint64][]inventory_ledgers.ItemLine{}

	var batchWrites inventory_ledgers.BatchWrites

	for _, id := range ids {
		taken, takeErr := inventory_ledgers.TakeOldestFirst(locked, &batchWrites, inventory_ledgers.Take{
			Transaction: txOf[owner[id]], TeamID: owner[id], ProductID: id, Count: qty[id],
			ChangeType: string(models.TxSample), ActorID: s.ActorID, Description: s.Description,
		})
		if takeErr != nil {
			return nil, takeErr
		}

		count, value := inventory_ledgers.TotalTaken(taken)
		items[owner[id]] = append(items[owner[id]], inventory_ledgers.ItemLine{
			ProductID: id, ProductTeamID: owner[id], Quantity: count, Total: value,
		})
	}

	err = batchWrites.Flush(tx)
	if err != nil {
		return nil, err
	}

	// ...then THIS RACK, every product.
	ensure := make([]inventory_ledgers.RackRowToEnsure, 0, len(ids))
	for _, id := range ids {
		ensure = append(ensure, inventory_ledgers.RackRowToEnsure{
			RackKey: inventory_ledgers.RackKey{ProductID: id, PlacementID: s.PlacementID}, TeamID: owner[id],
		})
	}

	rows, err := inventory_ledgers.EnsureAndLockRacks(tx, s.WarehouseID, ensure)
	if err != nil {
		return nil, err
	}

	var rackWrites inventory_ledgers.RackWrites

	for _, id := range ids {
		_, applyErr := rackWrites.Apply(txOf[owner[id]],
			rows[inventory_ledgers.RackKey{ProductID: id, PlacementID: s.PlacementID}],
			-qty[id], string(models.TxSample), s.ActorID, s.Description)
		if applyErr != nil {
			return nil, applyErr
		}
	}

	err = rackWrites.Flush(tx)
	if err != nil {
		return nil, err
	}

	sort.Slice(teams, func(i, j int) bool { return teams[i] < teams[j] })

	out := make([]models.InventoryTransaction, 0, len(teams))

	for _, team := range teams {
		err = inventory_ledgers.AddItems(tx, txOf[team], items[team])
		if err != nil {
			return nil, err
		}

		out = append(out, txOf[team])
	}

	return out, nil
}
