//go:build perfaudit

package inventory_v1_test

import (
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE SELLING RESTOCK LIST AS A FILE AT VOLUME (the-restock-list-exports-and-filters-by-courier) — on the statistics'
// fixture: 50 000 restocks, five selling teams of 10 000 into three warehouses over four years, every status, seven
// couriers, each with FOUR lines (200 000 `restock_items`), the lines naming 40 suppliers and 80 stores, and a trail row
// per restock (every fiftieth raised by Root from outside). RestockRequestExport is timed for one team's whole history
// (10 000 restocks = 50 steps of 200) and under the list's filters, end to end over HTTP with the names served
// in-process — the real adapter's five by-id reads per step travel over Connect on top of this.
//
// Measured 2026-11-16 (3 runs each, the host shared with an e2e run, so the spread is wide): a team's whole history,
// 10 000 restocks in 50 steps, 152 statements, ≈1.9–5.3 s median (623 KB file); per step the page of restocks ≈16 ms
// (the team's rows found by `restocks_team_idx`, the step's 200 picked by id), its 800 lines ≈12 ms, the trail's
// by-line flags ≈1.7 ms. The Accepted tab (5 000) ≈3.2 s; a courier (1 429) 0.2–2.7 s; 30 days (206) ≈55 ms; a product
// code search (250) ≈0.2–0.5 s; every filter at once (60) ≈25 ms.
func TestPerf_RestockRequestExport(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	perfSellingStatSeed(t, quiet)

	for _, statement := range []string{
		`UPDATE restock_items SET supplier_id = 500 + restock_id % 40, supplier_channel_id = 600 + restock_id % 80`,
		`INSERT INTO restock_logs (restock_id, from_status, to_status, actor_user_id, is_override, description, created_at)
		 SELECT id, '', 'ongoing', created_by_user_id, id % 50 = 0, 'created', created_at FROM restocks`,
		`ANALYZE restock_items`,
		`ANALYZE restock_logs`,
	} {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	store := exportNames()
	svc := exportService(db, store)
	now := time.Now()

	cases := []struct {
		name   string
		filter *inventoryv1.RestockRequestListFilter
	}{
		{"all time", nil},
		{"tab accepted", &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED}},
		{"courier", &inventoryv1.RestockRequestListFilter{ShipmentId: 93}},
		{"created, 30 days", &inventoryv1.RestockRequestListFilter{
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED, FromUnix: now.AddDate(0, 0, -30).Unix(), ToUnix: now.Unix(),
		}},
		{"q product code", &inventoryv1.RestockRequestListFilter{Q: "sku-0042"}},
		{"everything", &inventoryv1.RestockRequestListFilter{
			Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED, WarehouseId: 901, ShipmentId: 93,
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED, FromUnix: now.AddDate(-1, 0, 0).Unix(), ToUnix: now.Unix(),
			Q: "sku",
		}},
	}

	for _, c := range cases {
		walls := make([]time.Duration, 0, 3)

		var rows int

		for range 3 {
			probe.Reset()

			var file restockFile

			var err error

			wall, dbTime := probe.Measure(func() {
				file, err = runRestockExport(t, svc, store, 2, c.filter)
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			rows = len(file.rows) - 1
			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d rows=%d file=%d KB", c.name, wall, dbTime, probe.Count(), rows, len(store.content)/1024)
		}

		t.Logf("%s MEDIAN wall %v over %d restocks", c.name, san_perf.Median(walls), rows)
		probe.Report(t, c.name)
	}
}
