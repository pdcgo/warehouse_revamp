package inventory_mutations

import (
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// AN ORDER'S RETURN (docs/business/inventory/return_decision.md). The parcel is back at the selling team's return
// warehouse (only-the-return-warehouse-accepts-a-return) and its crew has counted it: the sound units go back on the
// shelf, minted ONE BATCH PER BATCH THE ORDER'S TAKE DREW FROM, each keeping its price, expiry and supplier
// (a-return-mints-one-batch-per-batch-the-order-took) — the transfer's in-leg rule, on the transfer's own helpers
// (outboundLayers, splitLayers). What does not come back sound is a DOOR ROW, off the newest layer first: missing
// (a-short-return-is-missing-at-the-door) or broken, thrown away (a-broken-returned-unit-is-thrown-away-at-the-door) —
// the selling team's, never the warehouse's payable, never claimable, never Inventory Lost.

// ErrReturnCount is a count that does not fit the take — sound + broken + missing is not what it drew, a product it
// never drew, one named twice or not at all, or racks that do not hold exactly the sound units.
var ErrReturnCount = errors.New("the return's count does not match what the order took")

// ReturnLine is one product of the take as the return warehouse's crew counted it.
type ReturnLine struct {
	// The product the take drew — the order line's.
	ProductID uint64
	// The product the units come back as: ProductID itself on the team's own line, the team's mapped own product on a
	// borrowed one (a-returned-borrowed-unit-is-relabelled-at-the-accept).
	ReturnProductID uint64
	// What the team paid on top of each layer's price on a borrowed line, as a fraction (0.2 = 20 %); 0 on its own.
	MarkupRate float64
	Sound      int64
	Broken     int64
	Missing    int64
	// Where the sound units went; together they hold exactly Sound.
	Placements []RestockPlacement
}

// Return is an order's return at the return warehouse.
type Return struct {
	// The return warehouse — where the parcel is.
	WarehouseID uint64
	// The ORDERING team: the transaction's team and every minted batch's owner.
	TeamID uint64
	// The order's take — its batch rows are the layers the return mints from.
	TakeTransactionID uint64
	ActorID           uint64
	IsOverride        bool
	Description       string
	Lines             []ReturnLine
}

// PostReturn writes the return: ONE `return` transaction of the ordering team at the return warehouse — made even when
// nothing came back sound, because the count happened (a-transaction-is-made-when-the-act-happens) — and per layer the
// take drew with sound units, ONE batch copying its price (× 1 + the markup the team paid, on a borrowed line), expiry
// and suppliers, owned by the ordering team under the product the units come back as. The sound units fill the OLDEST
// layers; broken and missing come off the NEWEST first, broken before missing, priced from those layers at what the team
// paid. The sound units go onto the named racks (refused under a count lock); one item per product equals its batches.
//
// The price copied is each layer's price when it left the shelf — the take's batch row's price_unit_after — so the
// minted total of a whole parcel is the order line's frozen total: its COGS, with the markup on a borrowed line.
func PostReturn(tx *gorm.DB, r Return) (models.InventoryTransaction, []PricedProblem, error) {
	layers, err := outboundLayers(tx, r.TakeTransactionID)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	lines := append([]ReturnLine(nil), r.Lines...)
	sort.Slice(lines, func(i, j int) bool { return lines[i].ProductID < lines[j].ProductID })

	err = checkReturnLines(r.TeamID, lines, layers)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: r.WarehouseID,
		TeamID:      r.TeamID,
		TxType:      models.TxReturn,
		ActorID:     r.ActorID,
		IsOverride:  r.IsOverride,
		Description: r.Description,
	})
	if err != nil {
		return t, nil, err
	}

	var problems []PricedProblem

	// The door on Analytic's Returned stock (the-inventory-metrics-prototype-is-accepted): per layer, under the product
	// the units come back as and the layer's supplier, the ordering team's — noted for the transaction's last rows.
	var door []inventory_ledgers.DoorRow

	mints := make([]inventory_ledgers.Mint, 0, len(lines))
	puts := make([]inventory_ledgers.Put, 0, len(lines))

	// BATCHES, every line — one mint per sound layer, all written at once (ledger-writes-are-set-based)...
	for _, line := range lines {
		paid := pricedAtWhatTheTeamPaid(layers[line.ProductID], line.MarkupRate)
		sound, broken, missing := splitLayers(paid, line.Sound, line.Broken, line.Missing)

		for _, l := range sound {
			mints = append(mints, inventory_ledgers.Mint{
				Transaction:       t,
				TeamID:            r.TeamID,
				ProductID:         line.ReturnProductID,
				Count:             l.Units,
				PriceUnit:         l.PriceUnit,
				SupplierID:        l.SupplierID,
				SupplierChannelID: l.SupplierChannelID,
				ExpiredAt:         l.ExpiredAt,
				ChangeType:        string(models.TxReturn),
				ActorID:           r.ActorID,
				Description:       r.Description,
			})
		}

		problems = appendProblem(problems, line.ProductID, models.TransferProblemBroken, broken)
		problems = appendProblem(problems, line.ProductID, models.TransferProblemMissing, missing)

		for _, l := range broken {
			door = append(door, returnDoorRow(r, line.ReturnProductID, l.SupplierID, l.Units, 0))
		}

		for _, l := range missing {
			door = append(door, returnDoorRow(r, line.ReturnProductID, l.SupplierID, 0, l.Units))
		}

		for _, p := range line.Placements {
			puts = append(puts, inventory_ledgers.Put{
				TeamID: r.TeamID, ProductID: line.ReturnProductID, PlacementID: p.PlacementID, Count: p.Count,
			})
		}
	}

	minted, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return t, nil, err
	}

	// One item per product equal to its batches (an-item-equals-its-batch-rows). Two lines may come back as ONE product —
	// a borrowed line mapped onto an own product the order also carries — so the items are summed by product.
	byProduct := map[uint64]*inventory_ledgers.ItemLine{}
	order := make([]uint64, 0, len(lines))

	for _, b := range minted {
		item := byProduct[b.ProductID]
		if item == nil {
			item = &inventory_ledgers.ItemLine{ProductID: b.ProductID, ProductTeamID: r.TeamID}
			byProduct[b.ProductID] = item
			order = append(order, b.ProductID)
		}

		item.Quantity += b.InitStockCount
		item.Total += b.InitStockValuation
	}

	sort.Slice(order, func(i, j int) bool { return order[i] < order[j] })

	items := make([]inventory_ledgers.ItemLine, 0, len(order))
	for _, id := range order {
		items = append(items, *byProduct[id])
	}

	// ...then RACKS — refused, whole, when a stock count holds the product on a named rack (a-lock-stops-sales-and-cancels-too).
	_, err = inventory_ledgers.PutOnPlacements(tx, t, string(models.TxReturn), r.ActorID, r.Description, puts)
	if err != nil {
		return t, nil, err
	}

	err = inventory_ledgers.AddItems(tx, t, items)
	if err != nil {
		return t, nil, err
	}

	err = inventory_ledgers.NoteDoor(tx, door...)
	if err != nil {
		return t, nil, err
	}

	return t, problems, nil
}

// returnDoorRow is one layer's broken or missing units at a return's door.
func returnDoorRow(r Return, productID, supplierID uint64, broken, missing int64) inventory_ledgers.DoorRow {
	return inventory_ledgers.DoorRow{
		WarehouseID: r.WarehouseID,
		TeamID:      r.TeamID,
		ProductID:   productID,
		SupplierID:  supplierID,
		Source:      inventory_ledgers.DoorReturn,
		Broken:      broken,
		Missing:     missing,
	}
}

// checkReturnLines holds the count to the take: every product it drew named exactly once, sound + broken + missing equal
// to what it drew, the racks holding exactly the sound units, and the product each line comes back as the team's own —
// an own line never touches the map (an-own-line-never-touches-the-map), a borrowed line always does
// (a-return-never-clones-a-product).
func checkReturnLines(teamID uint64, lines []ReturnLine, layers map[uint64][]layer) error {
	if len(layers) == 0 {
		return fmt.Errorf("%w: the take drew nothing", ErrReturnCount)
	}

	seen := make(map[uint64]bool, len(lines))

	for _, line := range lines {
		taken, ok := layers[line.ProductID]
		if !ok {
			return fmt.Errorf("%w: product %d is not one the order took", ErrReturnCount, line.ProductID)
		}

		if seen[line.ProductID] {
			return fmt.Errorf("%w: product %d is counted twice", ErrReturnCount, line.ProductID)
		}

		seen[line.ProductID] = true

		var drew int64
		for _, l := range taken {
			drew += l.Units
		}

		if line.Sound < 0 || line.Broken < 0 || line.Missing < 0 || line.Sound+line.Broken+line.Missing != drew {
			return fmt.Errorf("%w: product %d — sound %d + broken %d + missing %d is not the %d the order took",
				ErrReturnCount, line.ProductID, line.Sound, line.Broken, line.Missing, drew)
		}

		var placed int64
		for _, p := range line.Placements {
			placed += p.Count
		}

		if placed != line.Sound {
			return fmt.Errorf("%w: product %d — %d sound units, %d put away", ErrReturnCount, line.ProductID, line.Sound, placed)
		}

		own := taken[0].TeamID == teamID
		if own && line.ReturnProductID != line.ProductID {
			return fmt.Errorf("%w: product %d is the team's own and comes back as itself", ErrReturnCount, line.ProductID)
		}

		if !own && line.ReturnProductID == line.ProductID {
			return fmt.Errorf("%w: product %d is borrowed and comes back as the team's mapped own product", ErrReturnCount,
				line.ProductID)
		}
	}

	if len(seen) != len(layers) {
		return fmt.Errorf("%w: %d of the %d products the order took are counted", ErrReturnCount, len(seen), len(layers))
	}

	return nil
}

// pricedAtWhatTheTeamPaid is the take's layers at what the ordering team paid for each unit: the layer's price, plus on a
// borrowed line the markup the team paid on it (a-return-mints-one-batch-per-batch-the-order-took — at 20 %: Rp 10.000
// comes back as Rp 12.000). Exact, never rounded (the-backend-never-rounds-money).
func pricedAtWhatTheTeamPaid(layers []layer, markupRate float64) []layer {
	out := make([]layer, len(layers))

	for i, l := range layers {
		out[i] = l
		if markupRate > 0 {
			out[i].PriceUnit = l.PriceUnit * (1 + markupRate)
		}
	}

	return out
}
