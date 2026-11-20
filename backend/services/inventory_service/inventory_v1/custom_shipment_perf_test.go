//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE CUSTOM SHIPMENT AT VOLUME (backlog #88 P1). Beside the ledger background (50 000 takes, 10 000 accepted restocks of
// 5 lines each), 30 000 parcels: 20 000 samples of 3 lines across 30 teams and 20 warehouses, and a reship of every
// background restock (50 000 reship lines on restock lines) — years of a busy platform's parcels, in every status.
func perfCustomShipmentBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO custom_shipments (team_id, warehouse_id, kind, status, recipient_name, shipment_channel_id, payer,
		                               finance_account_id, shipping_cost, total, idempotency_key, note)
		 SELECT 100 + g % 30, 1 + g % 20, 'sample', (ARRAY['requested','picked','handed_over','cancelled'])[1 + g % 4],
		        'bg', 9, 'team', 7, 10000, 30000, 'bg-s-' || g, 'perf-bg'
		 FROM generate_series(1, 20000) g`,

		`INSERT INTO custom_shipment_items (custom_shipment_id, product_id, product_code, name, quantity, total)
		 SELECT c.id, 100000 + k, 'SKU-BG', 'background', 1, 10000
		 FROM custom_shipments c CROSS JOIN generate_series(1, 3) k WHERE c.note = 'perf-bg' AND c.kind = 'sample'`,

		`INSERT INTO custom_shipments (team_id, warehouse_id, kind, status, restock_id, recipient_name, shipment_channel_id,
		                               payer, idempotency_key, note)
		 SELECT r.team_id, r.warehouse_id, 'restock_reship', (ARRAY['requested','picked','handed_over','cancelled'])[1 + r.id % 4],
		        r.id, 'bg', 9, 'warehouse', 'bg-r-' || r.id, 'perf-bg'
		 FROM restocks r WHERE r.note = 'perf-bg'`,

		`INSERT INTO custom_shipment_items (custom_shipment_id, product_id, product_code, name, quantity, restock_item_id)
		 SELECT c.id, ri.product_id, ri.product_code, ri.name, 1, ri.id
		 FROM custom_shipments c JOIN restock_items ri ON ri.restock_id = c.restock_id
		 WHERE c.note = 'perf-bg' AND c.kind = 'restock_reship'`,

		`INSERT INTO custom_shipment_logs (custom_shipment_id, from_status, to_status, actor_user_id)
		 SELECT c.id, '', 'requested', 1 FROM custom_shipments c WHERE c.note = 'perf-bg'`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("custom shipment background: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"custom_shipments", "custom_shipment_items", "custom_shipment_logs"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func perfCustomShipmentService(db *gorm.DB) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil, nil, nil)
}

// A sample of one product and of twenty: the take at create, on the transfer out-leg's code.
func TestPerf_CustomShipmentCreate_Sample(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)

	svc := perfCustomShipmentService(db)
	racks := []uint64{newRack(t, svc, wtA, "perf-a"), newRack(t, svc, wtA, "perf-b"), newRack(t, svc, wtA, "perf-c")}
	perfStock(t, db, wtA, 20, 10, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.CustomShipmentLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, csProduct(product, 1))
		}

		counts[size] = perfRun(t, db, probe, "CustomShipmentCreate(sample)", size, func(run int) error {
			_, err := svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(csSample(fmt.Sprintf("perf-%d-%d", size, run), lines...)))

			return err
		})
	}

	t.Logf("CustomShipmentCreate(sample) queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

// A reship of one restock line and of twenty: the restock row's lock, its broken rows, the units live reships carry
// (on the items' restock-line index, among 50 000 background reship lines), the parcel.
func TestPerf_CustomShipmentCreate_Reship(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)

	svc := perfCustomShipmentService(db)
	rack := newRack(t, svc, wtA, "perf-a")

	items := make([]*inventoryv1.RestockRequestItem, 0, 20)
	for _, product := range perfProducts(20) {
		items = append(items, &inventoryv1.RestockRequestItem{ProductId: product, ProductCode: "PERF", Name: "Perf", Count: 20, Total: 20000})
	}

	restock := csRestock(t, svc, otMelati, items...)

	received := make([]*inventoryv1.RestockRequestReceivedLine, 0, 20)
	for _, item := range restock.GetItems() {
		received = append(received, &inventoryv1.RestockRequestReceivedLine{
			ItemId: item.GetId(), ReceivedCount: 20, BrokenCount: 15, Placements: placedOn(rack, 5),
		})
	}

	_, err := svc.RestockRequestAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: restock.GetId(), Lines: received,
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.CustomShipmentLine, 0, size)
		for _, item := range restock.GetItems()[:size] {
			lines = append(lines, csRestockLine(item.GetId(), 1))
		}

		counts[size] = perfRun(t, db, probe, "CustomShipmentCreate(reship)", size, func(run int) error {
			req := &inventoryv1.CustomShipmentCreateRequest{
				TeamId: otMelati, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP,
				RestockId: restock.GetId(), Lines: lines,
				Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Supplier", Phone: "1", Address: "x"},
				ShipmentChannelId: csCourier,
				Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
				IdempotencyKey:    fmt.Sprintf("perf-r-%d-%d", size, run),
			}

			_, err := svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(req))

			return err
		})
	}

	t.Logf("CustomShipmentCreate(reship) queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

// One parcel of twenty lines, as the owning team and as the warehouse.
func TestPerf_CustomShipmentDetail(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)

	svc := perfCustomShipmentService(db)
	racks := []uint64{newRack(t, svc, wtA, "perf-a"), newRack(t, svc, wtA, "perf-b")}
	perfStock(t, db, wtA, 20, 4, 100, racks)

	lines := make([]*inventoryv1.CustomShipmentLine, 0, 20)
	for _, product := range perfProducts(20) {
		lines = append(lines, csProduct(product, 2))
	}

	created, err := svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(csSample("perf-detail", lines...)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetCustomShipment().GetId()
	counts := map[string]int{}

	for _, reader := range []struct {
		name string
		team uint64
	}{{"owner", otMelati}, {"warehouse", wtA}} {
		counts[reader.name] = perfRun(t, db, probe, "CustomShipmentDetail("+reader.name+")", 20, func(int) error {
			_, err := svc.CustomShipmentDetail(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentDetailRequest{
				TeamId: reader.team, Id: id,
			}))

			return err
		})
	}

	t.Logf("CustomShipmentDetail queries: owner=%d, warehouse=%d", counts["owner"], counts["warehouse"])
}
