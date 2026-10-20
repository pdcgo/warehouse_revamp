package inventory_mutations

import (
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A WAREHOUSE TRANSFER'S TWO LEGS. The out-leg leaves A's book at create (a-transfer-takes-from-the-sender-at-create);
// between the legs the units are in neither warehouse's book but in the transfer
// (the-transfer-is-where-goods-in-transit-are); the in-leg at accept mints one batch at B per source batch
// (the-receiver-mints-one-batch-per-source-batch). A cancel while created rolls the out-leg back (RollbackTake).

// TransferLine is one product a transfer sends.
type TransferLine struct {
	ProductID uint64
	Quantity  int64
}

// TransferOut is a transfer's out-leg at warehouse A.
type TransferOut struct {
	// A — the sending warehouse.
	WarehouseID uint64
	// The selling team that owns every unit sent.
	TeamID      uint64
	ActorID     uint64
	Description string
	Lines       []TransferLine
}

// PostTransferOut writes the out-leg: ONE `transfer_out` transaction of the owning team, per line its batches oldest
// first and its racks holding the fewest first, one item per product equal to its batch rows. Too few at A refuses the
// create naming EVERY short line, and writes nothing.
func PostTransferOut(tx *gorm.DB, o TransferOut) (models.InventoryTransaction, []TakenLine, error) {
	lines := make([]OrderLine, 0, len(o.Lines))
	for _, line := range o.Lines {
		lines = append(lines, OrderLine{ProductID: line.ProductID, OwnerTeamID: o.TeamID, Quantity: line.Quantity})
	}

	lines = sortedByProduct(lines)

	locked, err := inventory_ledgers.LockBatches(tx, o.WarehouseID, ownersOf(lines))
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	err = refuseShortLines(locked, lines)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: o.WarehouseID,
		TeamID:      o.TeamID,
		TxType:      models.TxTransferOut,
		ActorID:     o.ActorID,
		Description: o.Description,
	})
	if err != nil {
		return t, nil, err
	}

	taken, err := takeLines(tx, t, locked, lines, o.ActorID, o.Description)
	if err != nil {
		return t, nil, err
	}

	return t, taken, nil
}

// TransferInLine is one line as warehouse B counted it. Good + Broken + Missing is what was sent.
type TransferInLine struct {
	ProductID uint64
	// arrived − broken: the units that become B's stock.
	Good    int64
	Broken  int64
	Missing int64
	// Where the good units went; together they hold exactly Good.
	Placements []RestockPlacement
}

// TransferIn is a transfer's in-leg at warehouse B.
type TransferIn struct {
	// B — the receiving warehouse.
	WarehouseID uint64
	// The selling team that owns the goods.
	TeamID uint64
	// The out-leg — its batch rows are the layers B mints from.
	OutboundTransactionID uint64
	ActorID               uint64
	Description           string
	Lines                 []TransferInLine
}

// PricedProblem is one product's broken or missing units, priced from the layers they came off.
type PricedProblem struct {
	ProductID uint64
	Type      models.TransferProblemType
	Count     int64
	Total     float64
}

// layer is what one source batch gave the out-leg: the facts B's batch copies, and the units still to place.
type layer struct {
	BatchID           uint64
	ProductID         uint64
	TeamID            uint64
	Units             int64
	PriceUnit         float64
	SupplierID        uint64
	SupplierChannelID uint64
	ExpiredAt         *time.Time
}

// PostTransferIn writes the in-leg: ONE `transfer_in` transaction of the owning team at B — made even when nothing
// arrived good, because the count happened (a-transaction-is-made-when-the-act-happens) — and per source batch with good
// units, ONE batch at B copying its price, expiry, suppliers and owner (the-receiver-mints-one-batch-per-source-batch,
// a-batch-carries-its-owner). The good units fill the OLDEST layers; broken and missing come off the NEWEST first,
// broken before missing, and are priced from those layers (the-system-fills-a-transfers-prices). The good units go onto
// B's racks as named; one item per product equals its batches.
//
// The price copied is the layer's price when it left A — its batch row's price_unit_after — so a revaluation at A after
// the out-leg never reaches B's batch.
func PostTransferIn(tx *gorm.DB, in TransferIn) (models.InventoryTransaction, []PricedProblem, error) {
	layers, err := outboundLayers(tx, in.OutboundTransactionID)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	lines := append([]TransferInLine(nil), in.Lines...)
	sort.Slice(lines, func(i, j int) bool { return lines[i].ProductID < lines[j].ProductID })

	for _, line := range lines {
		var sent int64
		for _, l := range layers[line.ProductID] {
			sent += l.Units
		}

		if line.Good < 0 || line.Broken < 0 || line.Missing < 0 || line.Good+line.Broken+line.Missing != sent {
			return models.InventoryTransaction{}, nil, fmt.Errorf(
				"transfer in, product %d: good %d + broken %d + missing %d is not the %d the out-leg sent",
				line.ProductID, line.Good, line.Broken, line.Missing, sent)
		}
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: in.WarehouseID,
		TeamID:      in.TeamID,
		TxType:      models.TxTransferIn,
		ActorID:     in.ActorID,
		Description: in.Description,
	})
	if err != nil {
		return t, nil, err
	}

	var problems []PricedProblem

	mints := make([]inventory_ledgers.Mint, 0, len(lines))
	puts := make([]inventory_ledgers.Put, 0, len(lines))

	// BATCHES, every line — one mint per good layer, all written at once (ledger-writes-are-set-based)...
	for _, line := range lines {
		good, broken, missing := splitLayers(layers[line.ProductID], line.Good, line.Broken, line.Missing)

		for _, l := range good {
			mints = append(mints, inventory_ledgers.Mint{
				Transaction:       t,
				TeamID:            l.TeamID,
				ProductID:         l.ProductID,
				Count:             l.Units,
				PriceUnit:         l.PriceUnit,
				SupplierID:        l.SupplierID,
				SupplierChannelID: l.SupplierChannelID,
				ExpiredAt:         l.ExpiredAt,
				ChangeType:        string(models.TxTransferIn),
				ActorID:           in.ActorID,
				Description:       in.Description,
			})
		}

		problems = appendProblem(problems, line.ProductID, models.TransferProblemBroken, broken)
		problems = appendProblem(problems, line.ProductID, models.TransferProblemMissing, missing)

		var placed int64
		for _, p := range line.Placements {
			placed += p.Count
			puts = append(puts, inventory_ledgers.Put{
				TeamID: in.TeamID, ProductID: line.ProductID, PlacementID: p.PlacementID, Count: p.Count,
			})
		}

		if placed != line.Good {
			return t, nil, fmt.Errorf("transfer in, product %d: %d good units, %d put away", line.ProductID, line.Good, placed)
		}
	}

	minted, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return t, nil, err
	}

	// One item per product equal to its batches (an-item-equals-its-batch-rows); the batches come back in line order.
	items := make([]inventory_ledgers.ItemLine, 0, len(lines))

	for _, b := range minted {
		if n := len(items); n > 0 && items[n-1].ProductID == b.ProductID {
			items[n-1].Quantity += b.InitStockCount
			items[n-1].Total += b.InitStockValuation

			continue
		}

		items = append(items, inventory_ledgers.ItemLine{
			ProductID: b.ProductID, ProductTeamID: in.TeamID, Quantity: b.InitStockCount, Total: b.InitStockValuation,
		})
	}

	// ...then RACKS.
	_, err = inventory_ledgers.PutOnPlacements(tx, t, string(models.TxTransferIn), in.ActorID, in.Description, puts)
	if err != nil {
		return t, nil, err
	}

	err = inventory_ledgers.AddItems(tx, t, items)
	if err != nil {
		return t, nil, err
	}

	return t, problems, nil
}

// outboundLayers reads what each source batch gave the out-leg, per product, oldest batch first. Only the take's own
// rows: a rolled-back out-leg's reversals are positive and never read here.
func outboundLayers(tx *gorm.DB, outboundID uint64) (map[uint64][]layer, error) {
	var rows []layer

	err := tx.Raw(`
		SELECT l.batch_id, b.product_id, b.team_id, -l.change_count AS units, l.price_unit_after AS price_unit,
		       b.supplier_id, b.supplier_channel_id, b.expired_at
		FROM batch_logs l
		JOIN batches b ON b.id = l.batch_id
		WHERE l.transaction_id = ? AND l.change_count < 0
		ORDER BY b.product_id, l.batch_id`, outboundID).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("read the out-leg %d's batch rows: %w", outboundID, err)
	}

	byProduct := map[uint64][]layer{}
	for _, r := range rows {
		byProduct[r.ProductID] = append(byProduct[r.ProductID], r)
	}

	return byProduct, nil
}

// splitLayers gives the good units to the OLDEST layers, then broken and missing off the NEWEST, broken first. Each
// returned layer carries only its share of units.
func splitLayers(layers []layer, good, broken, missing int64) (goodLayers, brokenLayers, missingLayers []layer) {
	rest := make([]int64, len(layers))

	for i, l := range layers {
		n := min(good, l.Units)
		good -= n
		rest[i] = l.Units - n

		if n > 0 {
			share := l
			share.Units = n
			goodLayers = append(goodLayers, share)
		}
	}

	for i := len(layers) - 1; i >= 0; i-- {
		if n := min(broken, rest[i]); n > 0 {
			broken -= n
			rest[i] -= n

			share := layers[i]
			share.Units = n
			brokenLayers = append(brokenLayers, share)
		}

		if n := min(missing, rest[i]); n > 0 {
			missing -= n
			rest[i] -= n

			share := layers[i]
			share.Units = n
			missingLayers = append(missingLayers, share)
		}
	}

	return goodLayers, brokenLayers, missingLayers
}

func appendProblem(problems []PricedProblem, productID uint64, kind models.TransferProblemType, layers []layer) []PricedProblem {
	if len(layers) == 0 {
		return problems
	}

	p := PricedProblem{ProductID: productID, Type: kind}
	for _, l := range layers {
		p.Count += l.Units
		p.Total += float64(l.Units) * l.PriceUnit
	}

	return append(problems, p)
}
