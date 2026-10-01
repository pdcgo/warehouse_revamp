package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const opnameWarehouse uint64 = 5

func opnameRack(t *testing.T, svc *inventory_v1.Service, code string) uint64 {
	t.Helper()

	rack, err := svc.RackCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: opnameWarehouse, Code: code,
	}))
	if err != nil {
		t.Fatalf("RackCreate(%s): %v", code, err)
	}

	return rack.Msg.GetRack().GetId()
}

func count(productID uint64, qty int64) *inventoryv1.StockOpnameLine {
	return &inventoryv1.StockOpnameLine{ProductId: productID, CountedQty: qty}
}

func opname(
	t *testing.T,
	svc *inventory_v1.Service,
	rackID uint64,
	lines ...*inventoryv1.StockOpnameLine,
) *inventoryv1.StockOpnameResponse {
	t.Helper()

	res, err := svc.StockOpname(ctxUser(1), connect.NewRequest(&inventoryv1.StockOpnameRequest{
		WarehouseId: opnameWarehouse,
		Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rackID}},
		Lines:       lines,
		Note:        "monthly count",
	}))
	if err != nil {
		t.Fatalf("StockOpname: %v", err)
	}

	return res.Msg
}

// onShelf reads what the system believes is on one (product, rack) — the number an opname corrects.
func onShelf(t *testing.T, svc *inventory_v1.Service, rackID, productID uint64) int64 {
	t.Helper()

	res, err := svc.RackStock(ctxUser(1), connect.NewRequest(&inventoryv1.RackStockRequest{
		TeamId: opnameWarehouse,
		Filter: &inventoryv1.RackStockFilter{RackId: rackID},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("RackStock: %v", err)
	}

	for _, item := range res.Msg.GetItems() {
		for id, line := range item.GetRackStock().GetMapData() {
			if id == productID {
				return line.GetOnHand()
			}
		}
	}

	return 0
}

// THE WHOLE SHELF, IN ONE ACT. Three products counted together: one short, one over, one exactly right.
//
// This is the shape of the job — somebody stands at A-01-3 and counts what is on it — and the response
// has to be readable as that: every line reported, matches included, so the answer is "eleven counted,
// two wrong" rather than a list of problems that cannot say how much was checked.
func TestStockOpname_CountsEveryLineAndReportsTheVariance(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	const short, over, exact uint64 = 100, 101, 102

	acceptOne(t, svc, opnameWarehouse, rack, short, 50, 500_000)
	acceptOne(t, svc, opnameWarehouse, rack, over, 20, 200_000)
	acceptOne(t, svc, opnameWarehouse, rack, exact, 30, 300_000)

	got := opname(t, svc, rack,
		count(short, 45), // 5 missing
		count(over, 23),  // 3 more than expected
		count(exact, 30), // right
	)

	if got.GetCountedProducts() != 3 {
		t.Fatalf("counted %d products, want 3", got.GetCountedProducts())
	}
	if got.GetVarianceProducts() != 2 {
		t.Fatalf("%d products differed, want 2 — the exact one must not count as a variance", got.GetVarianceProducts())
	}
	if len(got.GetVariances()) != 3 {
		t.Fatalf("%d variance rows, want 3 — a match is still a line that was counted", len(got.GetVariances()))
	}

	byProduct := map[uint64]*inventoryv1.StockOpnameVariance{}
	for _, v := range got.GetVariances() {
		byProduct[v.GetProductId()] = v
	}

	if v := byProduct[short]; v.GetExpectedQty() != 50 || v.GetCountedQty() != 45 || v.GetDelta() != -5 {
		t.Fatalf("the short product reads %+v, want expected 50 counted 45 delta -5", v)
	}
	if v := byProduct[over]; v.GetDelta() != 3 {
		t.Fatalf("the over product's delta = %d, want +3", v.GetDelta())
	}
	if v := byProduct[exact]; v.GetDelta() != 0 {
		t.Fatalf("the exact product's delta = %d, want 0", v.GetDelta())
	}

	// THE SHELF NOW HOLDS WHAT WAS COUNTED. A count that reported a variance and did not correct the
	// stock would be a report, not a stock-take.
	if n := onShelf(t, svc, rack, short); n != 45 {
		t.Fatalf("the shelf holds %d of the short product, want the counted 45", n)
	}
	if n := onShelf(t, svc, rack, over); n != 23 {
		t.Fatalf("the shelf holds %d of the over product, want the counted 23", n)
	}
	if n := onShelf(t, svc, rack, exact); n != 30 {
		t.Fatalf("the shelf holds %d of the exact product, want 30", n)
	}
}

// ⚠ A PRODUCT THAT WAS NOT COUNTED IS LEFT ALONE — the most dangerous thing this RPC could get wrong.
//
// The tempting reading of "count the shelf" is that everything not mentioned is gone. That would turn a
// forgotten row, a filtered screen or a lost page of a long shelf into a silent write-off of real stock
// — and a stock-take is BELIEVED, so nobody would go looking. Emptying a shelf has to stay something a
// person says out loud, with `counted_qty = 0`.
func TestStockOpname_LeavesUncountedProductsCompletelyAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	const counted, untouched uint64 = 100, 101

	acceptOne(t, svc, opnameWarehouse, rack, counted, 50, 500_000)
	acceptOne(t, svc, opnameWarehouse, rack, untouched, 40, 400_000)

	got := opname(t, svc, rack, count(counted, 48))

	if got.GetCountedProducts() != 1 {
		t.Fatalf("counted %d products, want 1 — only one line was sent", got.GetCountedProducts())
	}

	if n := onShelf(t, svc, rack, untouched); n != 40 {
		t.Fatalf("the uncounted product now reads %d, want 40 — an absent line must never be read as zero", n)
	}
}

// Emptying a shelf is said OUT LOUD, and it works. The counterpart to the test above: `counted_qty = 0`
// is a real count of nothing, and it must clear the shelf rather than be mistaken for "not counted".
func TestStockOpname_AnExplicitZeroEmptiesTheShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	const product uint64 = 100

	acceptOne(t, svc, opnameWarehouse, rack, product, 12, 120_000)

	got := opname(t, svc, rack, count(product, 0))

	if v := got.GetVariances()[0]; v.GetDelta() != -12 {
		t.Fatalf("delta = %d, want -12", v.GetDelta())
	}

	if n := onShelf(t, svc, rack, product); n != 0 {
		t.Fatalf("the shelf still holds %d, want 0", n)
	}
}

// A SHORTFALL IS VALUED AND WRITTEN OFF (owner's Q4), at the cost of the layers the FIFO draw actually
// consumed (Q1) — not at "the oldest layer's price" applied to everything.
//
// The distinction is the point of this test: 10 units are missing and they span two deliveries at
// different prices, so pricing them all at the oldest cost would be wrong by the difference. The first
// delivery holds 8 at 10.000, the second 20 at 25.000 — so 10 missing is 8×10.000 + 2×25.000 = 130.000.
//
// ⚠ ONE EXPENSE FOR THE WHOLE SHELF, not one per line. A count of A-01-3 is one event that cost the
// business one number.
func TestStockOpname_WritesOffTheShortfallAcrossTheLayersItConsumed(t *testing.T) {
	db := san_testdb.DB(t)
	expense := &recordingExpense{}
	svc := newServiceWithExpense(t, db, expense)

	rack := opnameRack(t, svc, "A-01-3")

	const product uint64 = 100

	// Two deliveries → two cost layers on one shelf: 8 @ 10.000, then 20 @ 25.000.
	acceptOne(t, svc, opnameWarehouse, rack, product, 8, 80_000)
	acceptOne(t, svc, opnameWarehouse, rack, product, 20, 500_000)

	// 28 expected, 18 found — 10 short, eating the whole oldest layer and 2 of the next.
	got := opname(t, svc, rack, count(product, 18))

	v := got.GetVariances()[0]
	if v.GetDelta() != -10 {
		t.Fatalf("delta = %d, want -10", v.GetDelta())
	}

	const want int64 = 8*10_000 + 2*25_000
	if v.GetValueLoss() != want {
		t.Fatalf("value_loss = %d, want %d — the draw spans two layers, so one price cannot value it", v.GetValueLoss(), want)
	}
	if !v.GetValueKnown() {
		t.Fatal("value_known is false, but every consumed layer had a recorded cost")
	}

	if got.GetTotalValueLoss() != want {
		t.Fatalf("total_value_loss = %d, want %d", got.GetTotalValueLoss(), want)
	}

	if len(expense.posted) != 1 {
		t.Fatalf("%d expense posts, want exactly 1 for the whole shelf", len(expense.posted))
	}
	if expense.posted[0].amount != want || expense.posted[0].warehouseID != opnameWarehouse {
		t.Fatalf("posted %d to team %d, want %d to %d",
			expense.posted[0].amount, expense.posted[0].warehouseID, want, opnameWarehouse)
	}
	// The note has to say WHERE, or the write-off is a number nobody can chase.
	if note := expense.posted[0].note; !strings.Contains(note, "opname") || !strings.Contains(note, "rack") {
		t.Fatalf("expense note = %q, want it to name the opname and its place", note)
	}
}

// A SURPLUS IS NOT VALUED. Stock that turns up was not bought — booking a negative expense for it would
// let a sloppy count read as income, which is the one direction a stock error must never go.
func TestStockOpname_ASurplusIsNotBookedAsMoney(t *testing.T) {
	db := san_testdb.DB(t)
	expense := &recordingExpense{}
	svc := newServiceWithExpense(t, db, expense)

	rack := opnameRack(t, svc, "A-01-3")

	const product uint64 = 100

	acceptOne(t, svc, opnameWarehouse, rack, product, 10, 100_000)

	got := opname(t, svc, rack, count(product, 14))

	v := got.GetVariances()[0]
	if v.GetDelta() != 4 {
		t.Fatalf("delta = %d, want +4", v.GetDelta())
	}
	if v.GetValueLoss() != 0 {
		t.Fatalf("a surplus was valued at %d, want 0", v.GetValueLoss())
	}

	if len(expense.posted) != 0 {
		t.Fatalf("a surplus posted %d expense rows, want none", len(expense.posted))
	}
}

// A COUNT THAT MATCHES STILL STAMPS THE SHELF.
//
// `last_opname_unix` on the placement and batch screens is read from the newest ADJUST movement on that
// (product, rack). A correct count that wrote nothing would leave the shelf looking permanently overdue
// for the count somebody had just done — so counting and changing are deliberately different things.
func TestStockOpname_AnExactCountStillRecordsThatTheShelfWasCounted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	const product uint64 = 100

	acceptOne(t, svc, opnameWarehouse, rack, product, 30, 300_000)

	before := placementLastOpname(t, svc, product)

	opname(t, svc, rack, count(product, 30))

	after := placementLastOpname(t, svc, product)

	if after == 0 {
		t.Fatal("the shelf has no last-opname stamp after being counted — a matching count wrote nothing")
	}
	if after == before {
		t.Fatalf("last opname did not move (%d) — an exact count must still record the visit", after)
	}
}

func placementLastOpname(t *testing.T, svc *inventory_v1.Service, productID uint64) int64 {
	t.Helper()

	res, err := svc.PlacementList(ctxUser(1), connect.NewRequest(&inventoryv1.PlacementListRequest{
		TeamId: opnameWarehouse,
		Filter: &inventoryv1.PlacementListFilter{ProductId: productID},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("PlacementList: %v", err)
	}

	for _, item := range res.Msg.GetItems() {
		for _, p := range item.GetPlacement().GetMapData() {
			return p.GetLastOpnameUnix()
		}
	}

	return 0
}

// ALL OR NOTHING. A bad line fails the whole count rather than posting the good ones.
//
// A half-posted stock-take leaves a shelf in a state nobody observed and nobody can reconstruct — worse
// than one that failed outright, because the rows it did write look exactly like a finished job. The
// unknown rack is the easiest way to prove it: the guard fires inside the transaction, after the lines
// would otherwise have been applied.
func TestStockOpname_AFailedLineRollsTheWholeCountBack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	const product uint64 = 100

	acceptOne(t, svc, opnameWarehouse, rack, product, 30, 300_000)

	// A rack of no warehouse at all — refused, and nothing must move.
	_, err := svc.StockOpname(ctxUser(1), connect.NewRequest(&inventoryv1.StockOpnameRequest{
		WarehouseId: opnameWarehouse,
		Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rack + 9999}},
		Lines:       []*inventoryv1.StockOpnameLine{count(product, 1)},
	}))
	if err == nil {
		t.Fatal("counting an unknown rack succeeded")
	}
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("unknown rack = %v, want NotFound — another warehouse's rack must not be confirmed", code)
	}

	if n := onShelf(t, svc, rack, product); n != 30 {
		t.Fatalf("the shelf holds %d after a refused count, want the original 30", n)
	}
}

// The guards on the request itself. Each is a way of asking a question this service cannot answer, so
// each is refused rather than interpreted.
func TestStockOpname_RefusesARequestItCannotHonestlyAnswer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	cases := []struct {
		name string
		req  *inventoryv1.StockOpnameRequest
	}{
		{
			// Silently correcting the unplaced pile while the racks hold the stock is exactly the guess
			// #139 refused for a single adjust.
			name: "no place named",
			req: &inventoryv1.StockOpnameRequest{
				WarehouseId: opnameWarehouse,
				Lines:       []*inventoryv1.StockOpnameLine{count(100, 5)},
			},
		},
		{
			name: "no lines at all",
			req: &inventoryv1.StockOpnameRequest{
				WarehouseId: opnameWarehouse,
				Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rack}},
			},
		},
		{
			// Two claims about what is physically on one shelf. Merging them or taking the last would be
			// this service deciding which the counter meant.
			name: "one product counted twice",
			req: &inventoryv1.StockOpnameRequest{
				WarehouseId: opnameWarehouse,
				Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rack}},
				Lines:       []*inventoryv1.StockOpnameLine{count(100, 5), count(100, 6)},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.StockOpname(ctxUser(1), connect.NewRequest(tc.req))
			if err == nil {
				t.Fatal("the request succeeded")
			}

			if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
				t.Fatalf("got %v, want InvalidArgument", code)
			}
		})
	}
}

// The count is scoped to the warehouse that owns the rack. Another warehouse's shelf reads as NotFound,
// never PermissionDenied — the error must not confirm the id exists.
func TestStockOpname_CannotCountAnotherWarehousesShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := opnameRack(t, svc, "A-01-3")

	const otherWarehouse uint64 = 77

	_, err := svc.StockOpname(ctxUser(1), connect.NewRequest(&inventoryv1.StockOpnameRequest{
		WarehouseId: otherWarehouse,
		Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rack}},
		Lines:       []*inventoryv1.StockOpnameLine{count(100, 5)},
	}))
	if err == nil {
		t.Fatal("a warehouse counted another warehouse's shelf")
	}

	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("got %v, want NotFound", code)
	}
}
