package inventory_mutations

import (
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ErrNotOnTheRack refuses a line for a product the rack does not hold at all.
var ErrNotOnTheRack = errors.New("the product is not on the rack")

// MoveLine is units of one product carried from the source rack to one destination.
type MoveLine struct {
	ProductID     uint64
	Quantity      int64
	ToPlacementID uint64
}

// Move is goods carried from ONE rack to one or more racks of the same warehouse
// (a-move-is-one-rack-to-one-or-more-racks).
type Move struct {
	WarehouseID     uint64
	FromPlacementID uint64
	ActorID         uint64
	Description     string
	Lines           []MoveLine
}

// PostMove writes a move: no batch row (a-move-writes-two-rack-rows-and-no-batch-row), a `move` row on the source rack
// and on each destination, one transaction per owning team, all in the caller's database transaction — all or nothing
// (a-move-writes-one-transaction-per-owning-team, a-move-is-all-or-nothing). A product's units off the source are at most
// what that rack holds (a-move-leaves-sold-units-on-their-rack). Each item counts the units off the source at zero value
// (a-move-lists-its-units-at-zero-value). Returns the transactions in team id order.
func PostMove(tx *gorm.DB, m Move) ([]models.InventoryTransaction, error) {
	products := map[uint64]int64{}
	for _, l := range m.Lines {
		products[l.ProductID] += l.Quantity
	}

	ids := sortedKeys(products)

	// The OWNER of each product is its source row's team: a move never changes owner.
	var sources []models.ProductPlacement

	err := tx.Where("placement_id = ? AND product_id IN ?", m.FromPlacementID, ids).Find(&sources).Error
	if err != nil {
		return nil, fmt.Errorf("read the source rack: %w", err)
	}

	owner := make(map[uint64]uint64, len(sources))
	for _, s := range sources {
		owner[s.ProductID] = s.TeamID
	}

	ensure := make([]inventory_ledgers.RackRowToEnsure, 0, len(m.Lines)+len(ids))

	for _, id := range ids {
		team, ok := owner[id]
		if !ok {
			return nil, fmt.Errorf("%w: product %d", ErrNotOnTheRack, id)
		}

		ensure = append(ensure, inventory_ledgers.RackRowToEnsure{
			RackKey: inventory_ledgers.RackKey{ProductID: id, PlacementID: m.FromPlacementID}, TeamID: team,
		})
	}

	for _, l := range m.Lines {
		ensure = append(ensure, inventory_ledgers.RackRowToEnsure{
			RackKey: inventory_ledgers.RackKey{ProductID: l.ProductID, PlacementID: l.ToPlacementID}, TeamID: owner[l.ProductID],
		})
	}

	rows, err := inventory_ledgers.EnsureAndLockRacks(tx, m.WarehouseID, ensure)
	if err != nil {
		return nil, err
	}

	// Every product counted under the lock before anything is written.
	for _, id := range ids {
		src := rows[inventory_ledgers.RackKey{ProductID: id, PlacementID: m.FromPlacementID}]
		if src.StockCount < products[id] {
			return nil, &inventory_ledgers.NotEnoughStockError{
				ProductID: id, Wanted: products[id], Available: src.StockCount, Ledger: "placements",
			}
		}
	}

	byTeam := map[uint64][]MoveLine{}
	for _, l := range m.Lines {
		byTeam[owner[l.ProductID]] = append(byTeam[owner[l.ProductID]], l)
	}

	teams := make([]uint64, 0, len(byTeam))
	for team := range byTeam {
		teams = append(teams, team)
	}

	sort.Slice(teams, func(i, j int) bool { return teams[i] < teams[j] })

	out := make([]models.InventoryTransaction, 0, len(teams))

	// Every team's rack rows stored at once at the end (ledger-writes-are-set-based).
	var w inventory_ledgers.RackWrites

	for _, team := range teams {
		t, createErr := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
			WarehouseID: m.WarehouseID, TeamID: team, TxType: models.TxMove, ActorID: m.ActorID, Description: m.Description,
		})
		if createErr != nil {
			return nil, createErr
		}

		off := map[uint64]int64{}
		into := map[inventory_ledgers.RackKey]int64{}

		for _, l := range byTeam[team] {
			off[l.ProductID] += l.Quantity
			into[inventory_ledgers.RackKey{ProductID: l.ProductID, PlacementID: l.ToPlacementID}] += l.Quantity
		}

		items := make([]inventory_ledgers.ItemLine, 0, len(off))

		for _, id := range sortedKeys(off) {
			_, applyErr := w.Apply(t,
				rows[inventory_ledgers.RackKey{ProductID: id, PlacementID: m.FromPlacementID}],
				-off[id], string(models.TxMove), m.ActorID, m.Description)
			if applyErr != nil {
				return nil, applyErr
			}

			items = append(items, inventory_ledgers.ItemLine{ProductID: id, ProductTeamID: team, Quantity: off[id]})
		}

		for _, key := range sortedRackKeys(into) {
			_, applyErr := w.Apply(t, rows[key], into[key], string(models.TxMove), m.ActorID, m.Description)
			if applyErr != nil {
				return nil, applyErr
			}
		}

		err = inventory_ledgers.AddItems(tx, t, items)
		if err != nil {
			return nil, err
		}

		out = append(out, t)
	}

	err = w.Flush(tx)
	if err != nil {
		return nil, err
	}

	return out, nil
}

func sortedKeys(m map[uint64]int64) []uint64 {
	keys := make([]uint64, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	return keys
}

func sortedRackKeys(m map[inventory_ledgers.RackKey]int64) []inventory_ledgers.RackKey {
	keys := make([]inventory_ledgers.RackKey, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].ProductID != keys[j].ProductID {
			return keys[i].ProductID < keys[j].ProductID
		}

		return keys[i].PlacementID < keys[j].PlacementID
	})

	return keys
}
