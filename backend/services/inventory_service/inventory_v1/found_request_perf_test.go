//go:build perfaudit

// Performance audit for found stock (the audit-rpc-performance skill): FoundRequestCreate, FoundRequestList at two page
// sizes, FoundRequestApprove (a claim and a mint) and FoundRequestReject — against the ledgers' and the stock count's
// background volume plus 50 000 found requests.
//
//	go test -tags perfaudit -p 1 -run TestPerf_FoundRequest -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// perfFoundBackground adds 50 000 found requests over the background shelf rows of the 20 warehouses: one in ten still
// waiting, the rest rejected.
func perfFoundBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Exec(`
		WITH pp AS (SELECT row_number() OVER (ORDER BY id) - 1 AS n, warehouse_id, team_id, product_id, placement_id
		            FROM product_placements),
		     total AS (SELECT COUNT(*) AS c FROM pp)
		INSERT INTO found_requests (warehouse_id, team_id, product_id, placement_id, stock_count, note, reported_by_id,
		    status, decided_by_id, decided_at, reject_reason)
		SELECT pp.warehouse_id, pp.team_id, pp.product_id, pp.placement_id, 1, 'bg', 7,
		       CASE WHEN g % 10 = 0 THEN 'waiting' ELSE 'rejected' END,
		       CASE WHEN g % 10 = 0 THEN NULL ELSE 8 END,
		       CASE WHEN g % 10 = 0 THEN NULL ELSE NOW() END,
		       CASE WHEN g % 10 = 0 THEN '' ELSE 'bg' END
		FROM generate_series(1, 50000) g
		CROSS JOIN total
		JOIN pp ON pp.n = g % total.c`).Error
	if err != nil {
		t.Fatalf("found background: %v", err)
	}

	err = quiet.Exec("ANALYZE found_requests").Error
	if err != nil {
		t.Fatalf("analyze found_requests: %v", err)
	}
}

type foundPerf struct {
	db    *gorm.DB
	probe *san_perf.Probe
	svc   *inventory_v1.Service
	rack  uint64
}

func foundPerfSetup(t *testing.T) foundPerf {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfOpnameBackground(t, db)
	perfFoundBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-1"), newRack(t, svc, otWarehouse, "perf-2")}
	perfStock(t, db, otWarehouse, 20, 2, 100, racks)

	return foundPerf{db: db, probe: probe, svc: svc, rack: racks[0]}
}

func (p foundPerf) report(by uint64, product uint64, n int64) (*inventoryv1.FoundRequest, error) {
	res, err := p.svc.FoundRequestCreate(opStaff(by), connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
		TeamId: otWarehouse, ProductId: product, RackId: p.rack, Quantity: n, Note: "perf",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetFoundRequest(), nil
}

func TestPerf_FoundRequestCreate(t *testing.T) {
	p := foundPerfSetup(t)

	perfRun(t, p.db, p.probe, "FoundRequestCreate", 1, func(int) error {
		_, err := p.report(opAni, perfFirstProduct, 2)

		return err
	})
}

// THE LIST at 20 and 200 waiting requests a page — each with what approving would post — beside 50 000 others: the
// statements must not move with the page.
func TestPerf_FoundRequestList(t *testing.T) {
	p := foundPerfSetup(t)

	// Enough of the target products' own to fill a 200 page, each with an open loss to claim.
	for i := range 200 {
		product := perfFirstProduct + uint64(i%20)

		_, err := p.report(opAni, product, 2)
		if err != nil {
			t.Fatalf("report %d: %v", i, err)
		}
	}

	counts := map[int]int{}

	for _, size := range []int{20, 200} {
		counts[size] = perfRun(t, p.db, p.probe, fmt.Sprintf("FoundRequestList page=%d", size), size, func(int) error {
			_, err := p.svc.FoundRequestList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.FoundRequestListRequest{
				TeamId: otWarehouse, Filter: &inventoryv1.FoundRequestListFilter{Status: inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING},
				Page: &commonv1.CommonPagination{Page: 1, Limit: uint32(size)},
			}))

			return err
		})
	}

	t.Logf("FoundRequestList queries: page 20=%d, page 200=%d", counts[20], counts[200])
}

// THE APPROVAL: each claims two open losses — the oldest first — and mints the third unit. Six products (the warm-up and
// five measured runs), each with two single-unit losses of its own, so every measured run claims as well as mints.
func TestPerf_FoundRequestApprove(t *testing.T) {
	p := foundPerfSetup(t)

	ids := make([]uint64, 0, 6)

	for i := range 6 {
		product := perfFirstProduct + uint64(i)

		batch := models.Batch{}
		p.db.Where("warehouse_id = ? AND product_id = ?", otWarehouse, product).Order("id").Take(&batch)

		for range 2 {
			_, err := p.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
				WarehouseId: otWarehouse, ProductId: product, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: p.rack},
				ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: batch.ID, Quantity: 1, Reason: "perf",
			}))
			if err != nil {
				t.Fatalf("lose one: %v", err)
			}
		}

		r, err := p.report(opAni, product, 3)
		if err != nil {
			t.Fatalf("report: %v", err)
		}

		ids = append(ids, r.GetId())
	}

	perfRun(t, p.db, p.probe, "FoundRequestApprove", 1, func(run int) error {
		res, err := p.svc.FoundRequestApprove(opAdmin(opBudi), connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{
			TeamId: otWarehouse, FoundRequestId: ids[run],
		}))
		if err != nil {
			return err
		}

		if lines := res.Msg.GetFoundRequest().GetLines(); len(lines) != 3 {
			return fmt.Errorf("run %d posted %v, want 2 claims and a mint", run, lines)
		}

		return nil
	})
}

func TestPerf_FoundRequestReject(t *testing.T) {
	p := foundPerfSetup(t)

	ids := make([]uint64, 0, 6)

	for range 6 {
		r, err := p.report(opAni, perfFirstProduct, 1)
		if err != nil {
			t.Fatalf("report: %v", err)
		}

		ids = append(ids, r.GetId())
	}

	perfRun(t, p.db, p.probe, "FoundRequestReject", 1, func(run int) error {
		_, err := p.svc.FoundRequestReject(opAdmin(opBudi), connect.NewRequest(&inventoryv1.FoundRequestRejectRequest{
			TeamId: otWarehouse, FoundRequestId: ids[run], Reason: "perf",
		}))

		return err
	})
}
