package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
)

var (
	// An opname must say WHERE it counted, exactly as a single adjust must (#139).
	errOpnameNoPlace = errors.New("a stock opname must say which rack it counted")
	// Two lines for one product are two different claims about what is physically on one shelf.
	errOpnameDuplicate = errors.New("a stock opname counts each product once")
	// An opname of nothing is not an opname. Proto validation requires at least one line; this catches a caller that
	// reached the handler directly, as every unit test does.
	errOpnameNoLines = errors.New("a stock opname needs at least one counted line")
)

// StockOpname counts a WHOLE RACK and corrects every line of it in one atomic act — PROVISIONALLY, on the ledgers,
// keeping what it did before the cut-over (old-shelf-corrections-move-onto-the-ledgers-provisionally); the stock count
// (opname sessions) replaces it once designed.
//
//   - ALL OR NOTHING: one database transaction, one `adjustment` transaction per owning team.
//   - Each line is a recount: a shortfall leaves the owner's batches oldest first, a surplus is minted at the owner's
//     newest price here, an exact count writes a 0 rack row so the rack reads as counted.
//   - A SHORTFALL MOVES MONEY, as before: written off to expense once for the rack after commit, and owed to each owner
//     inside the transaction, keyed by that owner's adjustment. A surplus moves none.
//
// ⚠ ONLY THE LINES SENT ARE COUNTED. A product on the rack and absent from `lines` is left alone, never zeroed.
func (s *Service) StockOpname(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockOpnameRequest],
) (*connect.Response[inventoryv1.StockOpnameResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	actor := actorFrom(ctx)

	if req.Msg.GetPlace().GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOpnameNoPlace)
	}

	rackID := req.Msg.GetPlace().GetRackId()
	if rackID == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustUnplaced)
	}

	lines, err := opnameLines(req.Msg.GetLines())
	if err != nil {
		return nil, err
	}

	var (
		counted   []inventory_mutations.RecountedLine
		totalLoss float64
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, checkErr := rackExists(tx, warehouseID, rackID)
		if checkErr != nil {
			return checkErr
		}

		if !exists {
			return errRackMissing
		}

		recount := inventory_mutations.Recount{
			WarehouseID: warehouseID,
			PlacementID: rackID,
			ActorID:     actor,
			Description: req.Msg.GetNote(),
		}

		for _, line := range lines {
			recount.Lines = append(recount.Lines, inventory_mutations.RecountLine{ProductID: line.productID, Counted: line.counted})
		}

		var recountErr error

		_, counted, recountErr = inventory_mutations.PostRecount(tx, recount)
		if recountErr != nil {
			return recountErr
		}

		// THE WAREHOUSE OWES WHOEVER OWNED THE MISSING UNITS (business_level §Warehouse 5 and 7): one debt per owner,
		// keyed by its adjustment, as shrinkage (StockDamageLost).
		lossByTx := map[uint64]float64{}
		ownerOf := map[uint64]uint64{}

		for _, line := range counted {
			if line.Counted < line.Expected {
				lossByTx[line.TransactionID] += line.Value
				ownerOf[line.TransactionID] = line.OwnerTeamID
				totalLoss += line.Value
			}
		}

		for _, txID := range sortedKeysOf(lossByTx) {
			amount := int64(math.Round(lossByTx[txID]))
			if amount <= 0 || ownerOf[txID] == warehouseID {
				continue
			}

			postErr := s.liability.PostStockDamage(ctx, tx, ownerOf[txID], warehouseID, txID, actor, amount, StockDamageLost)
			if postErr != nil {
				return postErr
			}
		}

		return nil
	})
	if err != nil {
		return nil, adjustErr(err)
	}

	// ONE expense for the whole rack, not one per line — a count of A-01-3 is one event that cost one number.
	if amount := int64(math.Round(totalLoss)); amount > 0 {
		_ = s.expense.PostStockLoss(ctx, warehouseID, amount, opnameLossNote(req.Msg))
	}

	res := &inventoryv1.StockOpnameResponse{
		CountedProducts: int64(len(counted)),
		TotalValueLoss:  int64(math.Round(totalLoss)),
		// Every unit on the ledgers carries a price, so nothing is left unpriced.
		ValueKnown: true,
	}

	for _, line := range counted {
		delta := line.Counted - line.Expected

		valueLoss := int64(0)
		if delta < 0 {
			valueLoss = int64(math.Round(line.Value))
		}

		if delta != 0 {
			res.VarianceProducts++
		}

		res.Variances = append(res.Variances, &inventoryv1.StockOpnameVariance{
			ProductId:   line.ProductID,
			ExpectedQty: line.Expected,
			CountedQty:  line.Counted,
			Delta:       delta,
			ValueLoss:   valueLoss,
			ValueKnown:  true,
		})
	}

	return connect.NewResponse(res), nil
}

// countedLine is one validated line.
type countedLine struct {
	productID uint64
	counted   int64
}

// opnameLines validates the request's lines and returns them sorted by product id — the order the rack is locked in.
func opnameLines(raw []*inventoryv1.StockOpnameLine) ([]countedLine, error) {
	if len(raw) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOpnameNoLines)
	}

	seen := make(map[uint64]struct{}, len(raw))
	lines := make([]countedLine, 0, len(raw))

	for _, l := range raw {
		id := l.GetProductId()

		if _, dup := seen[id]; dup {
			// Refused rather than merged: two counts of one product on one shelf are two different claims, and only
			// the person who made them can say which was meant.
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%w (product %d appears twice)", errOpnameDuplicate, id))
		}

		seen[id] = struct{}{}
		lines = append(lines, countedLine{productID: id, counted: l.GetCountedQty()})
	}

	sort.Slice(lines, func(i, j int) bool { return lines[i].productID < lines[j].productID })

	return lines, nil
}

// opnameLossNote is what the expense row says it was — with the rack, because a write-off with no location is a number
// nobody can chase.
func opnameLossNote(msg *inventoryv1.StockOpnameRequest) string {
	place := fmt.Sprintf("rack %d", msg.GetPlace().GetRackId())

	if note := msg.GetNote(); note != "" {
		return fmt.Sprintf("stock opname (%s): %s", place, note)
	}

	return fmt.Sprintf("stock opname (%s)", place)
}

func sortedKeysOf(m map[uint64]float64) []uint64 {
	keys := make([]uint64, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	return keys
}
