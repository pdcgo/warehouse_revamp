//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE SELLING RESTOCK STATISTICS AT VOLUME (the-restock-statistics-count-transactions-under-the-tabs). 50 000 restocks —
// five selling teams of 10 000 into three warehouses, over four years, every status (six in ten accepted), four paying
// accounts and seven couriers per team — each with FOUR lines over a team's 200 products: 200 000 `restock_items`.
// RestockSellingStat is timed for one team over all of its history (what the cards open on: every date,
// the-open-points-are-settled) and under each filter the list offers.
//
// Measured 2026-11-16 (one statement, the scoped restocks read once in a CTE): all time ≈55 ms, a filter 2–36 ms, a
// free-text search ≈80 ms (the list's own count pays the same predicate). A covering index on the lines
// (`restock_items (restock_id) INCLUDE (product_id, count)`, probed on a committed, VACUUMed copy) took the all-time read
// from ≈52 to ≈44 ms — not added: the time is the 40 000 lines' grouping, not finding them.
func TestPerf_RestockSellingStat(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	perfSellingStatSeed(t, quiet)

	svc := newService(t, db)

	perfSellingStatRuns(t, db, probe, svc, "as built")
}

// perfSellingStatSeed writes the 50 000 restocks and their 200 000 lines with generate_series, then ANALYZEs both.
func perfSellingStatSeed(t *testing.T, quiet *gorm.DB) {
	t.Helper()

	err := quiet.Exec(`
		INSERT INTO restocks (id, team_id, warehouse_id, status, shipment_id, finance_account_id, created_by_user_id,
		                      accepted_by_user_id, receipt, invoice_ref_id, shipment_cost, subtotal, total,
		                      warehouse_additional_cost, warehouse_additional_cost_note,
		                      created_at, arrived_at, accepted_at, lost_at, cancelled_at, updated_at)
		SELECT 9000000 + g,
		       2 + g % 5,
		       900 + g % 3,
		       s.status,
		       (ARRAY[0, 91, 92, 93, 94, 95, 96])[1 + g % 7],
		       CASE WHEN g % 50 = 0 THEN 0 ELSE 1300 + (g % 5) * 10 + g % 4 END,
		       1000 * (2 + g % 5) + g % 40,
		       CASE WHEN s.status = 'accepted' THEN 5000 + g % 6 ELSE 0 END,
		       'JNE' || lpad(g::text, 8, '0'),
		       'INV/' || g,
		       10000 + (g % 9) * 1000,
		       400000,
		       400000 + 10000 + (g % 9) * 1000,
		       CASE WHEN s.status = 'accepted' AND g % 3 = 0 THEN 5000 ELSE 0 END,
		       CASE WHEN s.status = 'accepted' AND g % 3 = 0 THEN 'courier at the door' ELSE '' END,
		       c.at,
		       CASE WHEN s.status IN ('arrived', 'accepted') THEN c.at + INTERVAL '2 days' END,
		       CASE WHEN s.status = 'accepted' THEN c.at + INTERVAL '3 days' END,
		       CASE WHEN s.status = 'lost' THEN c.at + INTERVAL '5 days' END,
		       CASE WHEN s.status = 'cancelled' THEN c.at + INTERVAL '1 day' END,
		       NOW()
		FROM generate_series(1, 50000) g
		CROSS JOIN LATERAL (SELECT (ARRAY['ongoing', 'arrived', 'accepted', 'accepted', 'accepted', 'accepted',
		                                  'accepted', 'accepted', 'lost', 'cancelled'])[1 + g % 10] AS status) s
		CROSS JOIN LATERAL (SELECT NOW() - ((50000 - g) * INTERVAL '42 minutes') AS at) c`).Error
	if err != nil {
		t.Fatalf("seed restocks: %v", err)
	}

	err = quiet.Exec(`
		INSERT INTO restock_items (restock_id, product_id, product_code, name, count, total, price_unit, created_at, updated_at)
		SELECT 9000000 + g,
		       (2 + g % 5) * 1000 + (g * 7 + l * 53) % 200,
		       'SKU-' || lpad(((g * 7 + l * 53) % 200)::text, 4, '0'),
		       'Produk ' || ((g * 7 + l * 53) % 200),
		       1 + (g + l) % 12,
		       100000,
		       100000.0 / (1 + (g + l) % 12),
		       NOW(), NOW()
		FROM generate_series(1, 50000) g
		CROSS JOIN generate_series(1, 4) l`).Error
	if err != nil {
		t.Fatalf("seed lines: %v", err)
	}

	err = quiet.Exec("ANALYZE restocks").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	err = quiet.Exec("ANALYZE restock_items").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
}

func perfSellingStatRuns(t *testing.T, db *gorm.DB, probe *san_perf.Probe, svc *inventory_v1.Service, label string) {
	t.Helper()

	ctx := ctxUser(7)
	now := time.Now()

	cases := []struct {
		name   string
		filter *inventoryv1.RestockRequestListFilter
	}{
		{"all time", nil},
		{"courier", &inventoryv1.RestockRequestListFilter{ShipmentId: 93}},
		{"warehouse", &inventoryv1.RestockRequestListFilter{WarehouseId: 901}},
		{"created, 30 days", &inventoryv1.RestockRequestListFilter{
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED, FromUnix: now.AddDate(0, 0, -30).Unix(), ToUnix: now.Unix(),
		}},
		{"accepted, 30 days", &inventoryv1.RestockRequestListFilter{
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED, FromUnix: now.AddDate(0, 0, -30).Unix(), ToUnix: now.Unix(),
		}},
		{"arrived, a year", &inventoryv1.RestockRequestListFilter{
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ARRIVED, FromUnix: now.AddDate(-1, 0, 0).Unix(), ToUnix: now.Unix(),
		}},
		{"created by", &inventoryv1.RestockRequestListFilter{CreatedByUserId: 2005}},
		{"product", &inventoryv1.RestockRequestListFilter{ProductId: 2042}},
		{"q resi", &inventoryv1.RestockRequestListFilter{Q: "jne0001"}},
		{"q product code", &inventoryv1.RestockRequestListFilter{Q: "sku-0042"}},
		{"everything", &inventoryv1.RestockRequestListFilter{
			Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED, WarehouseId: 901, ShipmentId: 93,
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED, FromUnix: now.AddDate(-1, 0, 0).Unix(), ToUnix: now.Unix(),
			Q: "sku",
		}},
	}

	for _, c := range cases {
		req := &inventoryv1.RestockSellingStatRequest{TeamId: 2, Filter: c.filter}

		res, err := svc.RestockSellingStat(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.RestockSellingStat(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: %s wall=%v db=%v queries=%d", label, c.name, wall, dbTime, probe.Count())
		}

		total := res.Msg.GetTotal()
		t.Logf("%s: %s MEDIAN wall %v — %d restocks, %d pcs, %d products, %d account rows", label, c.name,
			san_perf.Median(walls), total.GetRestockCount(), total.GetUnitCount(), total.GetProductCount(), len(res.Msg.GetByAccount()))

		for _, query := range probe.Queries() {
			if strings.HasPrefix(query.SQL, "SAVEPOINT") || strings.HasPrefix(query.SQL, "RELEASE") {
				continue
			}

			t.Logf("%s: %s — %v", label, c.name, query.Duration)
			san_perf.Explain(t, db, query.SQL)
		}
	}
}
