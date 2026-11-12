//go:build raceaudit

// Concurrency audit for BatchRevalue (the audit-sql skill) — Koreksi Harga. Two people of the owning team correcting the
// same batch, and a correction racing the takes that price at the batch (an order, a transfer's out-leg), are the cases
// that matter: the correction locks ONE batch row and nothing else, the takes lock the product's batches in id order.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_BatchRevalue|TestInterleave_BatchRevalue" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceOldestBatch is product A's oldest batch — the one every take draws first.
func raceOldestBatch(t *testing.T, db *gorm.DB) models.Batch {
	t.Helper()

	var b models.Batch

	err := db.Where("product_id = ?", raceProductA).Order("id").First(&b).Error
	if err != nil {
		t.Fatalf("product A's oldest batch: %v", err)
	}

	return b
}

func raceRevalue(svc *inventory_v1.Service, batchID uint64, expected, to float64) error {
	_, err := svc.BatchRevalue(ctxUser(77), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
		TeamId: raceOwner, BatchId: batchID, ExpectedPriceUnit: expected, NewPriceUnit: to, Reason: "race",
	}))

	return err
}

// replayBatch walks a batch's log rows in id order from where the seed left it (seedLedgers writes no log row) and
// checks every row against the batch as it stood: units and value move by the row and land on its *_after columns, a
// unit-moving row moves value at the price the batch had then (the seed and every correction keep value = price ×
// units), and only a revaluation changes the price — by Δ × the units left. The end must be the batch row itself.
func replayBatch(t *testing.T, db *gorm.DB, seed models.Batch) {
	t.Helper()

	count, value, price := seed.InitStockCount, seed.InitStockValuation, seed.PriceUnit

	var logs []models.BatchLog
	db.Where("batch_id = ?", seed.ID).Order("id").Find(&logs)

	for _, l := range logs {
		if l.ChangeType == string(models.TxRevaluation) {
			if l.ChangeCount != 0 || !san_money.Equal(l.ChangeValuation, (l.PriceUnitAfter-price)*float64(count)) {
				t.Fatalf("row %d: a correction moved %d units and %v, want 0 and (%v − %v) × %d", l.ID, l.ChangeCount,
					l.ChangeValuation, l.PriceUnitAfter, price, count)
			}

			price = l.PriceUnitAfter
		} else if !san_money.Equal(l.ChangeValuation, float64(l.ChangeCount)*price) {
			t.Fatalf("row %d (%s): %d units moved %v, want them at the price then, %v", l.ID, l.ChangeType, l.ChangeCount,
				l.ChangeValuation, price)
		}

		count += l.ChangeCount
		value += l.ChangeValuation

		if l.StockCountAfter != count || !san_money.Equal(l.StockValuationAfter, value) || !san_money.Equal(l.PriceUnitAfter, price) {
			t.Fatalf("row %d: after = %d / %v at %v, the replay says %d / %v at %v", l.ID, l.StockCountAfter,
				l.StockValuationAfter, l.PriceUnitAfter, count, value, price)
		}
	}

	var now models.Batch
	db.First(&now, seed.ID)

	if now.StockCount != count || !san_money.Equal(now.StockValuation, value) || !san_money.Equal(now.PriceUnit, price) {
		t.Fatalf("batch = %d / %v at %v, its rows say %d / %v at %v", now.StockCount, now.StockValuation, now.PriceUnit,
			count, value, price)
	}
}

// verifyEveryTransaction runs the ledgers' two invariants over every transaction the race wrote.
func verifyEveryTransaction(t *testing.T, db *gorm.DB) {
	t.Helper()

	var ids []uint64
	db.Raw(`SELECT DISTINCT transaction_id FROM batch_logs`).Scan(&ids)

	for _, id := range ids {
		err := inventory_ledgers.Verify(db, id)
		if err != nil {
			t.Fatalf("Verify %d: %v", id, err)
		}
	}
}

// ⚠ TWO PEOPLE CORRECT THE SAME BATCH AT ONCE. Eight of the owning team open the form on the same price and save
// different ones: exactly ONE lands, seven are refused as a stale form naming the winner's price — never a silent
// overwrite, never two corrections priced off the same old price. ×5 rounds.
func TestRace_BatchRevalue_TwoCorrectionsAtOnceOneWins(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	seed := raceOldestBatch(t, h.DB())
	price := seed.PriceUnit

	for round := range 5 {
		var c codes

		res := h.Race(t, 8, func(i int) error {
			err := raceRevalue(svc, seed.ID, price, price+float64(100*(i+1)))
			c.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d corrections deadlocked", round, n)
		}

		if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: outcomes = %v, want one landed and seven refused as stale", round, c.got)
		}

		var now models.Batch
		h.DB().First(&now, seed.ID)
		price = now.PriceUnit
	}

	var corrections int64
	h.DB().Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxRevaluation).Count(&corrections)

	if corrections != 5 {
		t.Fatalf("%d corrections over 5 rounds, want 5", corrections)
	}

	replayBatch(t, h.DB(), seed)
	verifyEveryTransaction(t, h.DB())
}

// THE ROW LOCK HOLDS: A corrects and holds the batch; B, on the same form's price, WAITS on the row, re-reads it after
// A commits and is refused as stale — the optimistic check is judged under the lock, never on a read from before it.
func TestInterleave_BatchRevalue_TheSecondWaitsAndSeesTheFirst(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)

	seed := raceOldestBatch(t, h.DB())

	post := func(tx *gorm.DB, to float64) error {
		_, err := inventory_mutations.PostRevaluation(tx, inventory_mutations.Revaluation{
			TeamID: raceOwner, BatchID: seed.ID, ExpectedPriceUnit: seed.PriceUnit, NewPriceUnit: to, Reason: "race",
		})

		return err
	}

	var aErr, bErr error

	const second = "B corrects the same batch from the same price"

	sched := h.Interleave(t,
		san_race.Do("A", "A corrects to 1.200 — FOR UPDATE holds the batch", func(tx *gorm.DB) error {
			aErr = post(tx, 1200)

			return nil
		}),
		san_race.Block("B", second, func(tx *gorm.DB) error {
			bErr = post(tx, 1300)

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("B did not wait on the batch's row (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if aErr != nil || !errors.Is(bErr, inventory_mutations.ErrRevaluePriceMoved) {
		t.Fatalf("A: %v, B: %v — want A landed and B refused as stale", aErr, bErr)
	}

	var now models.Batch
	h.DB().First(&now, seed.ID)

	if !san_money.Equal(now.PriceUnit, 1200) || !san_money.Equal(now.StockValuation, 12000) {
		t.Fatalf("batch = %v worth %v, want A's 1200 worth 12000", now.PriceUnit, now.StockValuation)
	}
}

// A TAKE WAITS FOR A CORRECTION AND COSTS AT ITS PRICE: the correction holds the batch, an order's take of 2 queues on
// the same row (its LockBatches), and once the correction commits the take reads the NEW price — 2 × 1.500, never a
// value worked out from the price before.
func TestInterleave_BatchRevalue_ATakeWaitsAndCostsAtTheNewPrice(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)

	seed := raceOldestBatch(t, h.DB())

	var (
		taken   models.InventoryTransaction
		takeErr error
		aErr    error
	)

	const second = "B takes 2 for an order"

	sched := h.Interleave(t,
		san_race.Do("A", "A corrects to 1.500", func(tx *gorm.DB) error {
			_, aErr = inventory_mutations.PostRevaluation(tx, inventory_mutations.Revaluation{
				TeamID: raceOwner, BatchID: seed.ID, ExpectedPriceUnit: seed.PriceUnit, NewPriceUnit: 1500, Reason: "race",
			})

			return nil
		}),
		san_race.Block("B", second, func(tx *gorm.DB) error {
			taken, _, takeErr = inventory_mutations.PostOrder(tx, inventory_mutations.Order{
				WarehouseID: raceWarehouse, TeamID: raceOwner,
				Lines: []inventory_mutations.OrderLine{{ProductID: raceProductA, OwnerTeamID: raceOwner, Quantity: 2}},
			})

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("the take did not wait on the corrected batch (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if aErr != nil || takeErr != nil {
		t.Fatalf("correction: %v, take: %v", aErr, takeErr)
	}

	var value float64
	h.DB().Raw(`SELECT SUM(change_valuation) FROM batch_logs WHERE transaction_id = ?`, taken.ID).Scan(&value)

	if !san_money.Equal(value, -3000) {
		t.Fatalf("the take moved %v, want −3000 — 2 at the corrected 1.500", value)
	}

	replayBatch(t, h.DB(), seed)
	verifyEveryTransaction(t, h.DB())
}

// A CORRECTION RACING ORDER TAKES ON THE SAME BATCH. Each round one correction (on the price read before it) and three
// takes of one unit start together, the correction delayed round%5 ms so both orders are hit: nothing deadlocks, a
// correction is only ever refused for a reason it should be, every row on the batch is consistent with the price it
// stood at (replayBatch), both ledgers agree and every transaction verifies.
func TestRace_BatchRevalue_RacingOrderTakesKeepsTheValueConsistent(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	// 20 in the oldest batch: 18 takes leave it units, so every correction has some to reprice.
	seedLedgers(t, h.DB(), 20, raceProductA)
	svc := raceService(h.DB())

	seed := raceOldestBatch(t, h.DB())

	landed := 0

	for round := range 6 {
		var now models.Batch
		h.DB().First(&now, seed.ID)

		var c codes

		res := h.Race(t, 4, func(i int) error {
			if i == 0 {
				time.Sleep(time.Duration(round%5) * time.Millisecond)

				err := raceRevalue(svc, seed.ID, now.PriceUnit, now.PriceUnit+50)
				c.add(err)

				if connect.CodeOf(err) == connect.CodeFailedPrecondition {
					return nil // the batch ran out under it — the right refusal
				}

				return err
			}

			err := raceTake(svc, fmt.Sprintf("K-%d-%d", round, i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 1})
			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d callers failed for a reason other than a refusal", round, n)
		}

		landed += c.got[0]
	}

	// Nothing else changes the price, so each correction's form is fresh and the batch never runs out: all land.
	if landed != 6 {
		t.Fatalf("%d of 6 corrections landed among the takes, want all 6", landed)
	}

	replayBatch(t, h.DB(), seed)
	verifyEveryTransaction(t, h.DB())

	if b, r := stockOf(t, h.DB(), raceProductA); b != r {
		t.Fatalf("batches hold %d, racks %d — the two ledgers drifted apart", b, r)
	}
}

// A CORRECTION RACING TRANSFERS OUT OF THE SAME BATCH. A transfer's out-leg takes at the batch's price and the receiver
// later mints at the price copied from that row (post_transfer.go) — so each out-leg row must carry the price the batch
// stood at when it left, never a mix. Same shape as the order race, with WarehouseTransferCreate as the take.
func TestRace_BatchRevalue_RacingTransfersOutKeepsTheValueConsistent(t *testing.T) {
	h := san_race.New(t, transferTables...)
	raceTransferSeed(t, h.DB(), 20, raceProductA)
	svc := raceService(h.DB())

	seed := raceOldestBatch(t, h.DB())

	landed := 0

	for round := range 6 {
		var now models.Batch
		h.DB().First(&now, seed.ID)

		var c codes

		res := h.Race(t, 3, func(i int) error {
			if i == 0 {
				time.Sleep(time.Duration(round%5) * time.Millisecond)

				err := raceRevalue(svc, seed.ID, now.PriceUnit, now.PriceUnit+75)
				c.add(err)

				if connect.CodeOf(err) == connect.CodeFailedPrecondition {
					return nil
				}

				return err
			}

			_, err := raceTransferCreate(svc, wtLine(raceProductA, 1))
			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d callers failed for a reason other than a refusal", round, n)
		}

		landed += c.got[0]
	}

	if landed != 6 {
		t.Fatalf("%d of 6 corrections landed among the transfers, want all 6", landed)
	}

	replayBatch(t, h.DB(), seed)
	verifyEveryTransaction(t, h.DB())

	if b, r := unitsAt(t, h.DB(), raceWarehouse, raceProductA); b != r {
		t.Fatalf("A's batches hold %d, its racks %d", b, r)
	}

	// The transfer lines carry the price their out-leg rows left at.
	var mismatched int64
	h.DB().Raw(`
		SELECT COUNT(*) FROM batch_logs l
		WHERE l.batch_id = ? AND l.change_type = 'transfer_out'
		  AND abs(l.change_valuation - l.change_count * l.price_unit_after) >= `+san_money.ZeroBelow, seed.ID).Scan(&mismatched)

	if mismatched != 0 {
		t.Fatalf("%d out-leg rows left at a value that is not their units × the price they carry", mismatched)
	}
}
