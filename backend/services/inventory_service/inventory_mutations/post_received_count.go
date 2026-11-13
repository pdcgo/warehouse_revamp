package inventory_mutations

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// KOREKSI JUMLAH TERIMA — a received-count correction's posting (docs/business/inventory/adjustment_decision.md:
// the-warehouse-corrects-a-wrong-stock-in-alone, a-stock-in-correction-keeps-the-batch-price,
// a-wrong-stock-in-is-a-received-count-correction). ONE `adjustment` transaction of the owning team in the receiving
// warehouse (a-rollback-only-undoes-a-take: a wrong stock-in is corrected, never rolled back): units the count typed
// too many leave the line's batch at its value and come off the rack named; units it typed too few go into the same
// batch at its price, onto the rack named. The restock and transfer handlers decide WHICH batch each piece moves in —
// this only checks and writes.

// The refusals a correction makes under the batch and rack locks — each wrapped in a CountRefusal naming the batch or
// rack in a person's words; the caller maps them with errors.Is.
var (
	// ErrCountOverBatch: more units out than the line's batch still holds — only the units still there are corrected
	// (a-stock-in-correction-keeps-the-batch-price: "refused").
	ErrCountOverBatch = errors.New("more units out than the batch still holds")
	// ErrCountOverRack: more units out than the rack named holds of the product (a-shelf-never-goes-below-zero).
	ErrCountOverRack = errors.New("more units out than the rack holds")
	// ErrCountBatchNotLine: a piece names a batch that is not the line's here — a caller's bug, never a person's.
	ErrCountBatchNotLine = errors.New("the batch is not this line's in this warehouse")
)

// CountRefusal is a refused correction: Kind is one of the ErrCount… sentinels, the text what the form shows.
type CountRefusal struct {
	Kind error
	Text string
}

func (e *CountRefusal) Error() string { return e.Text }

func (e *CountRefusal) Unwrap() error { return e.Kind }

func refuseCount(kind error, format string, args ...any) error {
	return &CountRefusal{Kind: kind, Text: fmt.Sprintf(format, args...)}
}

// CountMint is a batch a piece of units IN mints — the line had no batch for it (a restock line that arrived with no
// good unit, a transfer layer that went wholly missing): at the line's own price, with its suppliers and expiry.
type CountMint struct {
	PriceUnit         float64
	SupplierID        uint64
	SupplierChannelID uint64
	ExpiredAt         *time.Time
}

// CountPiece is units moving in ONE batch of a line.
type CountPiece struct {
	// The batch the units move in; 0 = mint one from Mint (units in only).
	BatchID uint64
	// Signed: > 0 out of the batch (too many typed), < 0 into it (too few typed).
	UnitsOut int64
	Mint     CountMint
	// Carried back untouched — a transfer piece's source layer at A.
	LayerBatchID uint64
}

// CountLine is one corrected line: its product, the rack its units come off or go onto, and the pieces — all out or
// all in.
type CountLine struct {
	ProductID   uint64
	PlacementID uint64
	Pieces      []CountPiece
}

// CountCorrection is a received-count correction as the handler built it.
type CountCorrection struct {
	WarehouseID uint64
	// The OWNING team — the goods' (a-batch-carries-its-owner) and the transaction's.
	TeamID uint64
	// models.ChangeRestockCorrection or models.ChangeTransferCorrection — on every log row it writes.
	ChangeType string
	ActorID    uint64
	IsOverride bool
	// Required, trimmed by the caller — the transaction's and every log row's description.
	Reason string
	Lines  []CountLine
}

// CorrectedPiece is what one piece moved: its batch (a minted one's id filled in), the units and their value.
type CorrectedPiece struct {
	BatchID      uint64
	LayerBatchID uint64
	UnitsOut     int64
	// The value per unit the batch gave up (out) or took (in).
	PriceUnit float64
	// Signed like UnitsOut — what left the batch (> 0) or came into it (< 0).
	Total float64
}

// CorrectedLine is one line as posted, in the order given.
type CorrectedLine struct {
	ProductID   uint64
	PlacementID uint64
	Pieces      []CorrectedPiece
}

// PostCountCorrection writes a correction. Locks, in the order every stock writer takes them
// (batches-lock-before-shelves-by-id): the pieces' batches in ONE statement in id order, then the lines' rack rows
// (created at 0 for units in), then — in a statement of its own — the count locks over them (a-lock-stops-sales-and-
// cancels-too). Refused before anything is written: more out than a batch or the rack holds, a counted rack. Then one
// `adjustment` transaction, the batch rows, the minted batches, the rack rows and one item per product (quantity and
// total positive — the rows carry the sign, an-item-equals-its-batch-rows). Never rolled back.
func PostCountCorrection(tx *gorm.DB, c CountCorrection) (models.InventoryTransaction, []CorrectedLine, error) {
	var ids []uint64

	for _, line := range c.Lines {
		for _, p := range line.Pieces {
			if p.UnitsOut == 0 {
				return models.InventoryTransaction{}, nil, fmt.Errorf("correction of product %d: a piece moves no unit", line.ProductID)
			}

			if p.BatchID != 0 {
				ids = append(ids, p.BatchID)
			} else if p.UnitsOut > 0 {
				// Nothing of the line ever became stock here: there is no unit to take out.
				return models.InventoryTransaction{}, nil, refuseCount(ErrCountOverBatch,
					"the line has no batch here (it holds 0) — a correction takes out only the units still there")
			}
		}
	}

	locked, err := inventory_ledgers.LockBatchesWith(tx, c.WarehouseID, nil, ids)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	for _, line := range c.Lines {
		for _, p := range line.Pieces {
			if p.BatchID == 0 {
				continue
			}

			b := locked.Batch(p.BatchID)
			if b == nil || b.TeamID != c.TeamID || b.ProductID != line.ProductID {
				return models.InventoryTransaction{}, nil, refuseCount(ErrCountBatchNotLine, "batch #%d is not this line's here", p.BatchID)
			}

			if p.UnitsOut > b.StockCount {
				return models.InventoryTransaction{}, nil, refuseCount(ErrCountOverBatch,
					"batch #%d holds only %d — a correction takes out only the units still there", b.ID, b.StockCount)
			}
		}
	}

	ensure := make([]inventory_ledgers.RackRowToEnsure, 0, len(c.Lines))
	keys := make([]inventory_ledgers.RackKey, 0, len(c.Lines))

	for _, line := range c.Lines {
		k := inventory_ledgers.RackKey{ProductID: line.ProductID, PlacementID: line.PlacementID}
		ensure = append(ensure, inventory_ledgers.RackRowToEnsure{RackKey: k, TeamID: c.TeamID})
		keys = append(keys, k)
	}

	racks, err := inventory_ledgers.EnsureAndLockRacks(tx, c.WarehouseID, ensure)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	for _, line := range c.Lines {
		row := racks[inventory_ledgers.RackKey{ProductID: line.ProductID, PlacementID: line.PlacementID}]
		if row == nil || row.TeamID != c.TeamID {
			return models.InventoryTransaction{}, nil, fmt.Errorf("rack %d holds product %d for another team", line.PlacementID, line.ProductID)
		}

		if out := netOut(line); out > row.StockCount {
			return models.InventoryTransaction{}, nil, refuseCount(ErrCountOverRack,
				"rack #%d holds only %d of this product — take the units off a rack that holds them", row.PlacementID, row.StockCount)
		}
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].ProductID != keys[j].ProductID {
			return keys[i].ProductID < keys[j].ProductID
		}

		return keys[i].PlacementID < keys[j].PlacementID
	})

	// No correction of a product a count holds on that rack (a-lock-stops-sales-and-cancels-too) — read under the rack
	// rows' lock, in a statement of its own (count_lock.go).
	err = inventory_ledgers.RefuseCounted(tx, keys)
	if err != nil {
		return models.InventoryTransaction{}, nil, err
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: c.WarehouseID,
		TeamID:      c.TeamID,
		TxType:      models.TxAdjustment,
		ActorID:     c.ActorID,
		IsOverride:  c.IsOverride,
		Description: c.Reason,
	})
	if err != nil {
		return t, nil, err
	}

	var (
		batchWrites inventory_ledgers.BatchWrites
		rackWrites  inventory_ledgers.RackWrites
		mints       []inventory_ledgers.Mint
		mintedAt    [][2]int
	)

	out := make([]CorrectedLine, 0, len(c.Lines))

	for li, line := range c.Lines {
		done := CorrectedLine{ProductID: line.ProductID, PlacementID: line.PlacementID}

		for pi, p := range line.Pieces {
			piece := CorrectedPiece{BatchID: p.BatchID, LayerBatchID: p.LayerBatchID, UnitsOut: p.UnitsOut}

			switch {
			case p.UnitsOut > 0:
				taken, takeErr := inventory_ledgers.TakeFromLocked(locked, &batchWrites, t, p.BatchID, p.UnitsOut,
					c.ChangeType, c.ActorID, c.Reason)
				if takeErr != nil {
					return t, nil, takeErr
				}

				piece.Total = taken.Valuation
				piece.PriceUnit = taken.Valuation / float64(p.UnitsOut)
			case p.BatchID != 0:
				price := locked.Batch(p.BatchID).PriceUnit

				added, addErr := inventory_ledgers.AddAtPrice(locked, &batchWrites, t, p.BatchID, -p.UnitsOut, price,
					c.ChangeType, c.ActorID, c.Reason)
				if addErr != nil {
					return t, nil, addErr
				}

				piece.Total = -added.Valuation
				piece.PriceUnit = price
			default:
				mints = append(mints, inventory_ledgers.Mint{
					Transaction:       t,
					TeamID:            c.TeamID,
					ProductID:         line.ProductID,
					Count:             -p.UnitsOut,
					PriceUnit:         p.Mint.PriceUnit,
					SupplierID:        p.Mint.SupplierID,
					SupplierChannelID: p.Mint.SupplierChannelID,
					ExpiredAt:         p.Mint.ExpiredAt,
					ChangeType:        c.ChangeType,
					ActorID:           c.ActorID,
					Description:       c.Reason,
				})
				mintedAt = append(mintedAt, [2]int{li, pi})
			}

			done.Pieces = append(done.Pieces, piece)
		}

		row := racks[inventory_ledgers.RackKey{ProductID: line.ProductID, PlacementID: line.PlacementID}]

		_, applyErr := rackWrites.Apply(t, row, -netOut(line), c.ChangeType, c.ActorID, c.Reason)
		if applyErr != nil {
			return t, nil, applyErr
		}

		out = append(out, done)
	}

	err = batchWrites.Flush(tx)
	if err != nil {
		return t, nil, err
	}

	minted, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return t, nil, err
	}

	for j, b := range minted {
		at := mintedAt[j]
		piece := &out[at[0]].Pieces[at[1]]
		piece.BatchID = b.ID
		piece.PriceUnit = b.PriceUnit
		piece.Total = -b.InitStockValuation
	}

	err = rackWrites.Flush(tx)
	if err != nil {
		return t, nil, err
	}

	items := make([]inventory_ledgers.ItemLine, 0, len(out))

	for _, line := range out {
		var units int64

		var total float64

		for _, p := range line.Pieces {
			units += p.UnitsOut
			total += p.Total
		}

		items = append(items, inventory_ledgers.ItemLine{
			ProductID: line.ProductID, ProductTeamID: c.TeamID, Quantity: abs64(units), Total: absFloat(total),
		})
	}

	err = inventory_ledgers.AddItems(tx, t, items)
	if err != nil {
		return t, nil, err
	}

	return t, out, nil
}

func netOut(line CountLine) int64 {
	var n int64
	for _, p := range line.Pieces {
		n += p.UnitsOut
	}

	return n
}

func absFloat(v float64) float64 {
	if v < 0 {
		return -v
	}

	return v
}

// ── A transfer line's layers at B ────────────────────────────────────────────────────────────────────────────────

// LineLayer is one source batch a transfer line drew at A (the-receiver-mints-one-batch-per-source-batch), and the
// batch at B that stands for it — 0 when none exists yet (the layer went wholly missing or broken at the accept).
type LineLayer struct {
	LayerBatchID      uint64
	Units             int64
	PriceUnit         float64
	SupplierID        uint64
	SupplierChannelID uint64
	ExpiredAt         *time.Time
	BatchAtB          uint64
}

// TransferLayers is every line's layers, by product, oldest source batch first, each with its batch at B: the in-leg's
// own batches of the product stand for the layers the accept gave good units — in id order, as PostTransferIn minted
// them (the good units fill the oldest layers) — and `corrected` (product → layer → batch) for the ones a correction
// minted since. `acceptGood` is each product's good units AT THE ACCEPT. Two statements, whatever the lines.
func TransferLayers(
	tx *gorm.DB,
	outboundID, inboundID uint64,
	acceptGood map[uint64]int64,
	corrected map[uint64]map[uint64]uint64,
) (map[uint64][]LineLayer, error) {
	byProduct, err := outboundLayers(tx, outboundID)
	if err != nil {
		return nil, err
	}

	var minted []struct {
		ID        uint64
		ProductID uint64
	}

	err = tx.Raw(`SELECT id, product_id FROM batches WHERE transaction_id = ? ORDER BY product_id, id`, inboundID).
		Scan(&minted).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the in-leg %d's batches: %w", inboundID, err)
	}

	mintedOf := map[uint64][]uint64{}
	for _, b := range minted {
		mintedOf[b.ProductID] = append(mintedOf[b.ProductID], b.ID)
	}

	out := make(map[uint64][]LineLayer, len(byProduct))

	for product, src := range byProduct {
		layers := make([]LineLayer, 0, len(src))
		next := 0

		for i, l := range src {
			layer := LineLayer{
				LayerBatchID: l.BatchID, Units: l.Units, PriceUnit: l.PriceUnit, SupplierID: l.SupplierID,
				SupplierChannelID: l.SupplierChannelID, ExpiredAt: l.ExpiredAt,
			}

			if goodShare(src, i, acceptGood[product]) > 0 && next < len(mintedOf[product]) {
				layer.BatchAtB = mintedOf[product][next]
				next++
			} else if b, ok := corrected[product][l.BatchID]; ok {
				layer.BatchAtB = b
			}

			layers = append(layers, layer)
		}

		out[product] = layers
	}

	return out, nil
}

// LayerShare is layer i's share of `good` units when they fill the oldest layers first (splitLayers' rule).
func LayerShare(layers []LineLayer, i int, good int64) int64 {
	var before int64
	for j := 0; j < i; j++ {
		before += layers[j].Units
	}

	return min(layers[i].Units, max(0, good-before))
}

func goodShare(layers []layer, i int, good int64) int64 {
	var before int64
	for j := 0; j < i; j++ {
		before += layers[j].Units
	}

	return min(layers[i].Units, max(0, good-before))
}

// TransferCorrectionPieces moves a line from `curGood` to `newGood` good units AS IF the count had been typed right at
// the accept: the good units fill the oldest layers, so units out leave the newest good layers and units in fill the
// next ones (the-system-fills-a-transfers-prices). A layer with no batch at B yet mints one at its own price.
func TransferCorrectionPieces(layers []LineLayer, curGood, newGood int64) []CountPiece {
	var pieces []CountPiece

	for i := len(layers) - 1; i >= 0; i-- {
		d := LayerShare(layers, i, newGood) - LayerShare(layers, i, curGood)
		if d == 0 {
			continue
		}

		l := layers[i]
		pieces = append(pieces, CountPiece{
			BatchID:      l.BatchAtB,
			UnitsOut:     -d,
			LayerBatchID: l.LayerBatchID,
			Mint: CountMint{
				PriceUnit: l.PriceUnit, SupplierID: l.SupplierID, SupplierChannelID: l.SupplierChannelID, ExpiredAt: l.ExpiredAt,
			},
		})
	}

	// Units in fill the oldest layer first — the pieces were walked newest first.
	if newGood > curGood {
		for a, b := 0, len(pieces)-1; a < b; a, b = a+1, b-1 {
			pieces[a], pieces[b] = pieces[b], pieces[a]
		}
	}

	return pieces
}

// TransferMaxOut is the most units a correction may take out of a transfer line now, and the batch it would take from
// first: walking the good layers newest first, each gives its good share while its batch at B still holds it — the
// first one holding less ends the walk (the pieces cannot skip it).
func TransferMaxOut(layers []LineLayer, curGood int64, holds map[uint64]int64) (uint64, int64) {
	var (
		first uint64
		total int64
	)

	for i := len(layers) - 1; i >= 0; i-- {
		share := LayerShare(layers, i, curGood)
		if share == 0 || layers[i].BatchAtB == 0 {
			continue
		}

		if first == 0 {
			first = layers[i].BatchAtB
		}

		held := holds[layers[i].BatchAtB]
		if held < share {
			return first, total + held
		}

		total += share
	}

	return first, total
}
