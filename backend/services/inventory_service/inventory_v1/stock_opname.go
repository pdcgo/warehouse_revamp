package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// An opname must say WHERE it counted, exactly as a single adjust must (#139). Proto validation refuses
// this first; the error exists so a request arriving around it fails loudly rather than quietly
// reconciling the unplaced pile while the racks hold the stock.
var errOpnameNoPlace = errors.New("a stock opname must say which place it counted (a rack, or unplaced)")

// Two lines for one product are two different claims about what is physically on one shelf.
var errOpnameDuplicate = errors.New("a stock opname counts each product once")

// An opname of nothing is not an opname. Proto validation requires at least one line; this catches a
// caller that reached the handler directly, as every unit test does.
var errOpnameNoLines = errors.New("a stock opname needs at least one counted line")

// StockOpname counts a WHOLE SHELF and corrects every line of it in one atomic act.
//
// `StockAdjust` with reason RECOUNT already corrects one product on one shelf, and that is the posting
// rather than the job: nobody walks to A-01-3 to count one product. They stand at the shelf and count
// what is on it, and the useful fact afterwards is "A-01-3 was counted, and here is what was wrong" —
// not five unrelated corrections that happen to share a rack.
//
// So this reuses the recount mechanics per line and adds the two things a sweep needs:
//
//  1. ALL OR NOTHING. One transaction. A count that half-posted would leave a shelf in a state nobody
//     observed and nobody could reconstruct — worse than a count that failed, because the rows it did
//     write look exactly like a finished job.
//  2. THE WHOLE PICTURE. It reports every line, matches included, plus what the shortfalls were worth.
//
// ⚠ ONLY THE LINES SENT ARE COUNTED. A product on the shelf and absent from `lines` is left completely
// alone, never zeroed — see the note on StockOpnameLine. Emptying a shelf is `counted_qty = 0`, said out
// loud.
//
// ⚠ A ZERO-VARIANCE LINE STILL WRITES A MOVEMENT, because `last_opname_unix` is read from the newest
// ADJUST on that (product, rack): a correct count that wrote nothing would leave the shelf looking
// permanently overdue for the count somebody just did.
func (s *Service) StockOpname(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockOpnameRequest],
) (*connect.Response[inventoryv1.StockOpnameResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	actor := actorFrom(ctx)

	// Re-checked rather than trusted to validation, for the reason StockAdjust re-checks it: an absent
	// place and "unplaced" are both nil by the time they reach placeRack, and unit tests bypass the
	// validation interceptor entirely — so without this the guard would exist only in production.
	if req.Msg.GetPlace().GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOpnameNoPlace)
	}

	rackID := placeRack(req.Msg.GetPlace())

	lines, err := opnameLines(req.Msg.GetLines())
	if err != nil {
		return nil, err
	}

	variances := make([]*inventoryv1.StockOpnameVariance, 0, len(lines))

	var (
		varianceProducts int64
		totalValueLoss   int64
		valueKnown       = true
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Reset per attempt: gorm retries nothing today, but a closure that appends to state captured
		// outside it is one retry away from reporting a shelf counted twice.
		variances = variances[:0]
		varianceProducts = 0
		totalValueLoss = 0
		valueKnown = true

		if rackID != nil {
			exists, checkErr := rackExists(tx, warehouseID, *rackID)
			if checkErr != nil {
				return checkErr
			}

			if !exists {
				return errRackMissing
			}
		}

		for _, line := range lines {
			variance, lineErr := s.countOne(ctx, tx, warehouseID, line.productID, rackID, line.counted,
				req.Msg.GetNote(), actor)
			if lineErr != nil {
				return lineErr
			}

			variances = append(variances, variance)

			if variance.GetDelta() != 0 {
				varianceProducts++
			}

			totalValueLoss += variance.GetValueLoss()
			if !variance.GetValueKnown() {
				valueKnown = false
			}
		}

		return nil
	})
	if err != nil {
		return nil, writeError(err)
	}

	// The value written off, posted AFTER the count has committed — the same best-effort shape a single
	// adjust uses (#211). The correction has landed regardless, and a dropped expense is a gap a report
	// can find; failing a stock-take because a downstream ledger hiccuped would be a worse trade.
	//
	// ONE expense for the whole shelf, not one per line. A count of A-01-3 is one event that cost the
	// business one number, and eleven rows in the expense list saying "opname" on the same day is a
	// harder thing to read than the one that says what it was.
	if totalValueLoss > 0 {
		_ = s.expense.PostStockLoss(ctx, warehouseID, totalValueLoss, opnameLossNote(req.Msg))
	}

	return connect.NewResponse(&inventoryv1.StockOpnameResponse{
		Variances:        variances,
		CountedProducts:  int64(len(variances)),
		VarianceProducts: varianceProducts,
		TotalValueLoss:   totalValueLoss,
		ValueKnown:       valueKnown,
	}), nil
}

// countedLine is one validated line, in the order the shelf will be locked.
type countedLine struct {
	productID uint64
	counted   int64
}

// opnameLines validates the request's lines and returns them SORTED BY PRODUCT ID.
//
// ⚠ THE SORT IS A DEADLOCK GUARD, not tidiness. Every line takes a row lock on `stock_levels`, and two
// people counting the same shelf at the same second is the normal case here, not an edge case — the
// crew works in pairs. If one request locked product 7 then product 3 while the other locked 3 then 7,
// Postgres would resolve it by killing one transaction, and the person would see a failed stock-take
// they cannot explain. A single agreed order makes the second counter WAIT instead, which is the
// correct outcome: the shelf is counted twice and the later count wins.
func opnameLines(raw []*inventoryv1.StockOpnameLine) ([]countedLine, error) {
	if len(raw) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOpnameNoLines)
	}

	seen := make(map[uint64]struct{}, len(raw))
	lines := make([]countedLine, 0, len(raw))

	for _, l := range raw {
		id := l.GetProductId()

		if _, dup := seen[id]; dup {
			// Refused rather than merged or last-one-wins. Two counts of one product on one shelf are two
			// different claims about the physical world, and this service cannot know which was meant —
			// so the question goes back to the person who can answer it.
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%w (product %d appears twice)", errOpnameDuplicate, id))
		}

		seen[id] = struct{}{}
		lines = append(lines, countedLine{productID: id, counted: l.GetCountedQty()})
	}

	sort.Slice(lines, func(i, j int) bool { return lines[i].productID < lines[j].productID })

	return lines, nil
}

// countOne reconciles ONE product on the counted shelf, and reports what it found.
//
// It is deliberately the same sequence `StockAdjust`'s RECOUNT branch performs — lock, diff, set,
// attribute FIFO, append the movement — because an opname line IS a recount. The difference is only
// that this one also prices the shortfall and hands the numbers back rather than throwing them away.
func (s *Service) countOne(
	ctx context.Context,
	tx *gorm.DB,
	warehouseID, productID uint64,
	rackID *uint64,
	counted int64,
	note string,
	actor uint64,
) (*inventoryv1.StockOpnameVariance, error) {
	var expected int64

	// FOR UPDATE, so a concurrent pick or count on this shelf waits rather than interleaving between the
	// read and the write below. This is a read-then-write, which is a check-then-act — the lock is what
	// makes it safe, and it is the reason the lines are counted in a fixed order.
	//
	// ⚠ A product with NO level row locks nothing: there is no row to lock yet. Two opnames both finding
	// a brand-new product on one shelf can therefore both read 0, and the upsert below settles it
	// last-writer-wins. That is the same behaviour a single StockAdjust has, and it is the honest
	// outcome for a count anyway — the later count is the more recent observation.
	err := tx.Raw(`
		SELECT on_hand FROM stock_levels
		WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?
		FOR UPDATE`,
		warehouseID, productID, rackID,
	).Scan(&expected).Error
	if err != nil {
		return nil, err
	}

	delta := counted - expected

	err = tx.Exec(`
		INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
		VALUES (?, ?, ?, ?, NOW())
		ON CONFLICT (warehouse_id, product_id, rack_id)
		DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = NOW()`,
		warehouseID, productID, rackID, counted,
	).Error
	if err != nil {
		return nil, err
	}

	// The delta lands on the batches sitting on this shelf, oldest first (owner's Q1) — so per-batch
	// Ready keeps reconciling to on-hand — and the draw tells us what the missing units were worth.
	draw, err := attributeDeltaFIFOValued(tx, warehouseID, productID, rackID, delta)
	if err != nil {
		return nil, err
	}

	// Batch-less on purpose: a shelf count is a statement about the SHELF, so Stock History shows "—"
	// for the batch even though the units underneath were attributed FIFO. Same as a single recount.
	mv, err := appendMovement(tx, warehouseID, productID, rackID, nil, delta, counted,
		inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, note, "", actor)
	if err != nil {
		return nil, err
	}

	// THE WAREHOUSE OWES WHOEVER OWNED THE MISSING UNITS (business_level §Warehouse 5 and 7, owner,
	// 2026-08-20). A shortfall found by counting a shelf is stock lost in the warehouse exactly as one
	// filed as a LOST adjust is — before this, the same physical loss reimbursed the owner or not
	// depending on which RPC noticed it.
	//
	// ⚠ ONE DEBT PER OWNER PER LINE, keyed on THIS line's movement. A shelf's layers can belong to
	// several teams, so one shortfall can owe two of them different amounts; and keying on the movement
	// keeps `source_id` meaning the same thing it means for an adjust, so a re-run is refused by the
	// ledger rather than charging twice.
	//
	// Inside the transaction, unlike the expense that the caller posts afterwards — the same split the
	// single-adjust path draws. An expense is derived and a dropped one is a gap a report finds; an
	// obligation that fails to commit leaves the owner's goods gone with nothing recorded.
	//
	// A SURPLUS REIMBURSES NOBODY, and is not a reversal either: stock that turns up on a count was
	// never established as lost, so there is no debt of its own to give back. Only a FOUND adjust
	// against a specific batch reverses a specific reimbursement.
	if delta < 0 {
		for _, ownerTeamID := range sortedOwners(draw.ByOwner) {
			amount := draw.ByOwner[ownerTeamID]
			if amount <= 0 || ownerTeamID == warehouseID {
				continue
			}

			postErr := s.liability.PostStockDamage(ctx, tx, ownerTeamID, warehouseID, mv.ID, amount, false)
			if postErr != nil {
				return nil, postErr
			}
		}
	}

	// A SURPLUS IS NOT VALUED. Stock that turns up is not a purchase — nothing was spent to acquire it,
	// and booking a negative expense for it would let a sloppy count look like income.
	valueLoss := int64(0)
	if delta < 0 {
		valueLoss = draw.Value
	}

	return &inventoryv1.StockOpnameVariance{
		ProductId:   productID,
		ExpectedQty: expected,
		CountedQty:  counted,
		Delta:       delta,
		ValueLoss:   valueLoss,
		// A surplus and an exact count have nothing left unpriced, so they are "known" trivially.
		ValueKnown: delta >= 0 || draw.AllKnown,
	}, nil
}

// opnameLossNote is what the expense row says it was. The place is in it because "a stock write-off"
// with no location is a number nobody can chase, and the count that produced it is the only thing that
// can say where to go and look.
func opnameLossNote(msg *inventoryv1.StockOpnameRequest) string {
	place := "unplaced stock"
	if rack := msg.GetPlace().GetRackId(); rack != 0 {
		place = fmt.Sprintf("rack %d", rack)
	}

	if note := msg.GetNote(); note != "" {
		return fmt.Sprintf("stock opname (%s): %s", place, note)
	}

	return fmt.Sprintf("stock opname (%s)", place)
}

// sortedOwners is the map's keys in a fixed order.
//
// It changes no outcome — each owner's debt is its own posting with its own idempotency key — but it
// makes two runs of the same count produce entries in the same order, which matters the moment
// somebody is comparing two of them by eye. Sorting the keys is also the only way to iterate a Go map
// deterministically at all.
func sortedOwners(byOwner map[uint64]int64) []uint64 {
	owners := make([]uint64, 0, len(byOwner))
	for owner := range byOwner {
		owners = append(owners, owner)
	}

	sort.Slice(owners, func(i, j int) bool { return owners[i] < owners[j] })

	return owners
}
