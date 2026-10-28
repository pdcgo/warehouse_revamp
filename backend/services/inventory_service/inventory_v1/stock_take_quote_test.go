package inventory_v1_test

import (
	"strconv"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// WHAT A TAKE WOULD DRAW, before it draws it (an-order-is-costed-at-what-leaves-the-shelf): the order form's per-line
// cost is the take's own selection, read-only — so the preview and what the order freezes cannot be two rules.

// quoteStocked stocks Gudang 5 as otStocked does, except that Melati's Kaos Hitam arrived TWICE: 2 units at 10.000 in
// January, then 2 at 14.000 in March — two batches, so the shelf's average (12.000) is not what any unit costs.
func quoteStocked(t *testing.T) (*inventory_v1.Service, *gorm.DB) {
	t.Helper()

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts())

	rakA := newRack(t, svc, otWarehouse, "rak-a")

	otRestock(t, svc, otMelati, otKaosHitam, 2, 20000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 2}})
	otRestock(t, svc, otMelati, otKaosHitam, 2, 28000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 2}})
	otRestock(t, svc, otSinar, otKaosPolos, 5, 100000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 5}})
	otRestock(t, svc, otSinar, otKaosMerah, 5, 50000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 5}})
	otRestock(t, svc, otSinar, otKaosBiru, 8, 80000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 8}})

	return svc, db
}

func quote(svc *inventory_v1.Service, lines ...*inventoryv1.StockTakeQuoteLine) (*inventoryv1.StockTakeQuoteResponse, error) {
	res, err := svc.StockTakeQuote(ctxUser(8), connect.NewRequest(&inventoryv1.StockTakeQuoteRequest{
		TeamId: otMelati, WarehouseId: otWarehouse, Lines: lines,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func quoteLine(product uint64, qty int64) *inventoryv1.StockTakeQuoteLine {
	return &inventoryv1.StockTakeQuoteLine{ProductId: product, Quantity: qty}
}

// takenBatches is what a real take gave up, batch by batch, oldest first: units and value, as positive figures.
func takenBatches(t *testing.T, db *gorm.DB, transactionID uint64) []*inventoryv1.StockTakeQuoteBatch {
	t.Helper()

	var logs []models.BatchLog

	err := db.Where("transaction_id = ?", transactionID).Order("batch_id").Find(&logs).Error
	if err != nil {
		t.Fatalf("read the take's batch rows: %v", err)
	}

	out := make([]*inventoryv1.StockTakeQuoteBatch, 0, len(logs))
	for _, l := range logs {
		out = append(out, &inventoryv1.StockTakeQuoteBatch{Quantity: -l.ChangeCount, Total: -l.ChangeValuation})
	}

	return out
}

// A two-batch product quoted for 1, 2 and 3 units: the quote names the batches the take then really draws, at the cost
// it then really freezes — 1 and 2 from January alone, 3 spilling one unit into March. Never the 12.000 average.
func TestStockTakeQuote_MatchesWhatTheTakeThenDraws(t *testing.T) {
	cases := []struct {
		qty      int64
		cost     float64
		perBatch []*inventoryv1.StockTakeQuoteBatch
	}{
		{1, 10_000, []*inventoryv1.StockTakeQuoteBatch{{Quantity: 1, UnitCost: 10_000, Total: 10_000}}},
		{2, 20_000, []*inventoryv1.StockTakeQuoteBatch{{Quantity: 2, UnitCost: 10_000, Total: 20_000}}},
		{3, 34_000, []*inventoryv1.StockTakeQuoteBatch{
			{Quantity: 2, UnitCost: 10_000, Total: 20_000},
			{Quantity: 1, UnitCost: 14_000, Total: 14_000},
		}},
	}

	for _, c := range cases {
		t.Run(strconv.FormatInt(c.qty, 10)+" units", func(t *testing.T) {
			svc, db := quoteStocked(t)

			res, err := quote(svc, quoteLine(otKaosHitam, c.qty))
			if err != nil {
				t.Fatalf("quote %d: %v", c.qty, err)
			}

			item := res.GetItems()[0]
			if !item.GetEnough() || item.GetAvailable() != 4 || item.GetOwnerTeamId() != otMelati ||
				!san_money.Equal(item.GetTotalCost(), c.cost) || !san_money.Equal(item.GetUnitCost(), c.cost/float64(c.qty)) {
				t.Fatalf("quote of %d = %+v, want enough of 4, %v in all", c.qty, item, c.cost)
			}

			if len(item.GetBatches()) != len(c.perBatch) {
				t.Fatalf("quote of %d named batches %+v, want %+v", c.qty, item.GetBatches(), c.perBatch)
			}

			for i, b := range item.GetBatches() {
				want := c.perBatch[i]
				if b.GetQuantity() != want.GetQuantity() || !san_money.Equal(b.GetUnitCost(), want.GetUnitCost()) ||
					!san_money.Equal(b.GetTotal(), want.GetTotal()) {
					t.Fatalf("quote of %d, batch %d = %+v, want %+v", c.qty, i, b, want)
				}
			}

			// THE TAKE, now: the same cost, from the same batches in the same order.
			taken, err := take(svc, "K-quote", line(otKaosHitam, c.qty))
			if err != nil {
				t.Fatalf("take %d: %v", c.qty, err)
			}

			if !san_money.Equal(taken.GetItems()[0].GetUnitCost(), item.GetUnitCost()) ||
				!san_money.Equal(taken.GetItems()[0].GetTotal(), item.GetTotalCost()) {
				t.Fatalf("the take froze %+v, the quote said %v a unit, %v in all", taken.GetItems()[0], item.GetUnitCost(),
					item.GetTotalCost())
			}

			drawn := takenBatches(t, db, taken.GetTransactionId())
			if len(drawn) != len(item.GetBatches()) {
				t.Fatalf("the take drew %+v, the quote named %+v", drawn, item.GetBatches())
			}

			for i, b := range drawn {
				if b.GetQuantity() != item.GetBatches()[i].GetQuantity() ||
					!san_money.Equal(b.GetTotal(), item.GetBatches()[i].GetTotal()) {
					t.Fatalf("the take's batch %d = %+v, the quote's %+v", i, b, item.GetBatches()[i])
				}
			}
		})
	}
}

// Short stock is REPORTED, not refused: 5 of a product the warehouse holds 4 of answers `enough` false, the 4, and no
// cost at all — the take would draw nothing, so there is nothing to price (unknown, never 0). The line beside it is
// answered as usual, and the quote writes nothing.
func TestStockTakeQuote_ReportsShortStockAndWritesNothing(t *testing.T) {
	svc, db := quoteStocked(t)

	res, err := quote(svc, quoteLine(otKaosHitam, 5), quoteLine(otKaosPolos, 1))
	if err != nil {
		t.Fatalf("a short line must not fail the quote: %v", err)
	}

	short := res.GetItems()[0]
	if short.GetProductId() != otKaosHitam || short.GetEnough() || short.GetAvailable() != 4 ||
		short.TotalCost != nil || short.UnitCost != nil || len(short.GetBatches()) != 0 {
		t.Fatalf("short line = %+v, want not enough, 4 available, no cost and no batches", short)
	}

	if other := res.GetItems()[1]; !other.GetEnough() || !san_money.Equal(other.GetTotalCost(), 20_000) {
		t.Fatalf("the line beside it = %+v, want 1 at 20000", other)
	}

	if n := countTransactions(db, models.TxOrder); n != 0 {
		t.Fatalf("a quote wrote %d order transactions", n)
	}

	var units int64
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE product_id = ?`, otKaosHitam).Scan(&units)
	if units != 4 {
		t.Fatalf("Kaos Hitam's batches hold %d after a quote, want the 4 untouched", units)
	}
}

// THE TAKE'S OWNERSHIP RULES, not new ones: a borrowed product draws its OWNER's batches at their cost — the markup is
// the form's to add, so Kaos Polos quotes 20.000, not Sinar's 22.000 — and a line the take would refuse whatever the
// shelf holds (Sinar's private Kaos Merah, Kaos Biru below its reserve, a product that exists nowhere) has nothing
// available to this team and no cost. Another warehouse's stock never counts.
func TestStockTakeQuote_FollowsTheTakesOwnershipRules(t *testing.T) {
	svc, _ := quoteStocked(t)

	res, err := quote(svc,
		quoteLine(otKaosHitam, 1), quoteLine(otKaosPolos, 2), quoteLine(otKaosMerah, 1),
		quoteLine(otKaosBiru, 1), quoteLine(otKaosKuning, 1))
	if err != nil {
		t.Fatalf("quote: %v", err)
	}

	byID := map[uint64]*inventoryv1.StockTakeQuoteItem{}
	for _, item := range res.GetItems() {
		byID[item.GetProductId()] = item
	}

	if len(byID) != 5 {
		t.Fatalf("items = %+v, want one per line asked", res.GetItems())
	}

	if polos := byID[otKaosPolos]; polos.GetOwnerTeamId() != otSinar || !polos.GetEnough() ||
		!san_money.Equal(polos.GetUnitCost(), 20_000) || !san_money.Equal(polos.GetTotalCost(), 40_000) {
		t.Fatalf("Kaos Polos = %+v, want Sinar's batches at 20000 a unit, no markup", polos)
	}

	for _, refused := range []uint64{otKaosMerah, otKaosBiru, otKaosKuning} {
		item := byID[refused]
		if item.GetEnough() || item.GetAvailable() != 0 || item.TotalCost != nil || len(item.GetBatches()) != 0 {
			t.Fatalf("product %d = %+v, want nothing available and no cost — the take would refuse it", refused, item)
		}
	}

	// The same product quoted from a warehouse that holds none of it.
	other, err := svc.StockTakeQuote(ctxUser(8), connect.NewRequest(&inventoryv1.StockTakeQuoteRequest{
		TeamId: otMelati, WarehouseId: otWarehouse + 1, Lines: []*inventoryv1.StockTakeQuoteLine{quoteLine(otKaosHitam, 1)},
	}))
	if err != nil {
		t.Fatalf("quote from another warehouse: %v", err)
	}

	if item := other.Msg.GetItems()[0]; item.GetEnough() || item.GetAvailable() != 0 || item.TotalCost != nil {
		t.Fatalf("Kaos Hitam at another warehouse = %+v, want none there", item)
	}
}

// Each product once, as the take wants it: a product listed twice is refused, not summed behind the caller's back.
func TestStockTakeQuote_RefusesAProductListedTwice(t *testing.T) {
	svc, _ := quoteStocked(t)

	_, err := quote(svc, quoteLine(otKaosHitam, 1), quoteLine(otKaosHitam, 2))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a product listed twice: err = %v, want InvalidArgument", err)
	}
}

// The contract: a team, a warehouse, 1 to 100 lines, each a product and a quantity of at least one.
func TestStockTakeQuote_ValidatesTheRequest(t *testing.T) {
	valid := func() *inventoryv1.StockTakeQuoteRequest {
		return &inventoryv1.StockTakeQuoteRequest{
			TeamId: otMelati, WarehouseId: otWarehouse, Lines: []*inventoryv1.StockTakeQuoteLine{quoteLine(otKaosHitam, 1)},
		}
	}

	err := protovalidate.GlobalValidator.Validate(valid())
	if err != nil {
		t.Fatalf("a valid request was refused: %v", err)
	}

	tooMany := valid()
	tooMany.Lines = nil
	for id := uint64(1); id <= 101; id++ {
		tooMany.Lines = append(tooMany.Lines, quoteLine(id, 1))
	}

	broken := map[string]func(r *inventoryv1.StockTakeQuoteRequest){
		"no team":       func(r *inventoryv1.StockTakeQuoteRequest) { r.TeamId = 0 },
		"no warehouse":  func(r *inventoryv1.StockTakeQuoteRequest) { r.WarehouseId = 0 },
		"no lines":      func(r *inventoryv1.StockTakeQuoteRequest) { r.Lines = nil },
		"101 lines":     func(r *inventoryv1.StockTakeQuoteRequest) { r.Lines = tooMany.Lines },
		"no product":    func(r *inventoryv1.StockTakeQuoteRequest) { r.Lines[0].ProductId = 0 },
		"zero quantity": func(r *inventoryv1.StockTakeQuoteRequest) { r.Lines[0].Quantity = 0 },
	}

	for name, breakIt := range broken {
		r := valid()
		breakIt(r)

		if protovalidate.GlobalValidator.Validate(r) == nil {
			t.Fatalf("%s passed validation", name)
		}
	}
}
