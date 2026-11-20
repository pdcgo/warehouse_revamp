package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE CUSTOM SHIPMENT'S MOVES — the fixture's calls (backlog #88 P3). The selling team's acts run as Melati's seller, the
// warehouse's as A's staff.

func (f *csFixture) cancel(team, id uint64) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCancelRequest{
		TeamId: team, Id: id,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func (f *csFixture) costSet(team, id, account uint64, cost float64) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentCostSet(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCostSetRequest{
		TeamId: team, Id: id, FinanceAccountId: account, ShippingCost: cost,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func (f *csFixture) picked(team, id uint64) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentPicked(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentPickedRequest{
		TeamId: team, Id: id,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func (f *csFixture) mustPick(t *testing.T, id uint64) {
	t.Helper()

	_, err := f.picked(wtA, id)
	if err != nil {
		t.Fatalf("picked: %v", err)
	}
}

// handover hands a parcel over as A — cost nil sends no cost at all (the field left empty).
func (f *csFixture) handover(team, id uint64, cost *float64, resi string) (*inventoryv1.CustomShipment, error) {
	res, err := f.svc.CustomShipmentHandover(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentHandoverRequest{
		TeamId: team, Id: id, ShippingCost: cost, Resi: resi,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetCustomShipment(), nil
}

func rupiah(v float64) *float64 {
	return proto.Float64(v)
}

// lastCustomShipmentEvent is the custom shipment's newest event, failing when it published none.
func (f *csFixture) lastCustomShipmentEvent(t *testing.T) string {
	t.Helper()

	events := f.customShipmentEvents()
	if len(events) == 0 {
		t.Fatal("no custom shipment event published")
	}

	return events[len(events)-1].GetEventId()
}

func wantStatus(t *testing.T, cs *inventoryv1.CustomShipment, want inventoryv1.CustomShipmentStatus) {
	t.Helper()

	if cs.GetStatus() != want {
		t.Fatalf("custom shipment %d is %v, want %v", cs.GetId(), cs.GetStatus(), want)
	}
}

// takeNetRows is what a take's own rows still move, per product and ledger, once its undo wrote the flipped rows beside
// them — empty when the undo put back exactly what the take took (a-rollback-reverses-its-log-rows). inventory_ledgers.
// Verify judges a LIVE transaction's items against its rows, so a rolled-back one is judged here instead.
func takeNetRows(t *testing.T, db *gorm.DB, transactionID uint64) []string {
	t.Helper()

	var rows []struct {
		Ledger    string
		ProductID uint64
		Units     int64
		Value     float64
	}

	err := db.Raw(`
		SELECT 'batch' AS ledger, b.product_id, SUM(l.change_count) AS units, SUM(l.change_valuation) AS value
		FROM batch_logs l JOIN batches b ON b.id = l.batch_id
		WHERE l.transaction_id = ? GROUP BY b.product_id
		UNION ALL
		SELECT 'rack', product_id, SUM(stock_change), 0
		FROM product_placement_logs WHERE transaction_id = ? GROUP BY product_id`, transactionID, transactionID).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("read transaction %d's rows: %v", transactionID, err)
	}

	var out []string

	for _, r := range rows {
		if r.Units != 0 || r.Value > 0.0001 || r.Value < -0.0001 {
			out = append(out, fmt.Sprintf("%s product %d: %d units, %v", r.Ledger, r.ProductID, r.Units, r.Value))
		}
	}

	return out
}
