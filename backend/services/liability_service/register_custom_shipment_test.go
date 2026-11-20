package liability_service_test

import (
	"net/http"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// THE CUSTOM SHIPMENT'S HANDOVER IS MOUNTED: `san pubsub ensure` declares liability-custom-shipment-handed-over, so the
// service must serve /event/<sub>/push for it — an unmounted route passes every handler test while the running app
// dead-letters every push. Through the REAL mux, as the emulator calls it: a *Gudang bayar* parcel's courier cost lands
// as a `custom_shipment_fee`.
func TestRegister_TheCustomShipmentHandoverReachesTheLedger(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()
	liability_service.NewRegister(mux, liability_v1.NewService(db, nil, nil, nil), connect.WithInterceptors())()

	deliver(t, mux, liability_service.CustomShipmentHandedOverSubscription,
		customShipmentHandedOver(8811, inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE, 14_000, false))

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_type = ? AND source_id = ?", "custom_shipment_fee", 8811).
		Order("id").
		Find(&legs).
		Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	if len(legs) != 2 {
		t.Fatalf("%d legs, want the courier cost's two", len(legs))
	}
}
