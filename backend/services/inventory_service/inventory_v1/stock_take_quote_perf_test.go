//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The quote is read on the hot path of TYPING an order — every quantity the form settles on asks it again — so it is
// measured like the take it previews: 1, 20 and 100 lines (the contract's ceiling), each product holding 10 batches over
// 3 racks in Gudang 5, against the ledgers' background volume (perfLedgerBackground). Then 1 and 20 BORROWED lines whose
// owner set a reserve, the one case where the take's own rules read once per line.
//
//	go test -tags perfaudit -run TestPerf_StockTakeQuote -v ./backend/services/inventory_service/inventory_v1/
func TestPerf_StockTakeQuote(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, perfFacts(100))
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-a"), newRack(t, svc, otWarehouse, "perf-b"), newRack(t, svc, otWarehouse, "perf-c")}
	perfStock(t, db, otWarehouse, 100, 10, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20, 100} {
		lines := make([]*inventoryv1.StockTakeQuoteLine, 0, size)
		for _, product := range perfProducts(size) {
			// 150 of 1 000 held: the draw spills over two batches, the FIFO choice a real line makes.
			lines = append(lines, quoteLine(product, 150))
		}

		counts[size] = perfRun(t, db, probe, "StockTakeQuote", size, func(int) error {
			_, err := svc.StockTakeQuote(ctxUser(8), connect.NewRequest(&inventoryv1.StockTakeQuoteRequest{
				TeamId: otMelati, WarehouseId: otWarehouse, Lines: lines,
			}))

			return err
		})
	}

	t.Logf("StockTakeQuote queries, own lines: 1=%d, 20=%d, 100=%d", counts[1], counts[20], counts[100])

	// BORROWED, with a reserve: 20 other products, owned by another team that keeps 1 unit back.
	lent := make([]uint64, 0, 20)
	for i := range 20 {
		lent = append(lent, perfFirstProduct+10_000+uint64(i))
	}

	lenderRack := newRack(t, svc, otWarehouse, "perf-lender")
	borrowed := fakeFacts{}

	for _, id := range lent {
		borrowed[id] = inventory_v1.ProductFact{TeamID: otMelati + 100, ReservedStock: 1}
		stockOnLedger(t, db, otWarehouse, otMelati+100, id, lenderRack, 100, 1000)
	}

	lender := inventory_v1.NewService(db, nil, nil, nil, nil, borrowed)
	reserved := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.StockTakeQuoteLine, 0, size)
		for _, product := range lent[:size] {
			lines = append(lines, quoteLine(product, 1))
		}

		reserved[size] = perfRun(t, db, probe, "StockTakeQuote (borrowed, reserve)", size, func(int) error {
			_, err := lender.StockTakeQuote(ctxUser(8), connect.NewRequest(&inventoryv1.StockTakeQuoteRequest{
				TeamId: otMelati, WarehouseId: otWarehouse, Lines: lines,
			}))

			return err
		})
	}

	t.Logf("StockTakeQuote queries, borrowed lines with a reserve: 1=%d, 20=%d", reserved[1], reserved[20])
}
