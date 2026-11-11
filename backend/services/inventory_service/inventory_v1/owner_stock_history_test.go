package inventory_v1_test

import (
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE OWNER'S STOCK HISTORY READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): the seller's Stock History tab
// shows the "by Root team" badge on the stock-in Root made from outside the warehouse — read on the page only, from the
// row's transaction — and not on the staff's.
func TestOwnerStockHistory_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	// Root raises the first and the warehouse's staff count it in; the seller raises the second and Root, from outside
	// the warehouse, counts it in — so one stock-in transaction is the staff's and the other an override.
	restockAs(t, svc, ctxAs(ovRoot, otMelati, rootOutsideRole), ctxAs(31, otWarehouse, staffRole), rack)
	restockAs(t, svc, ctxAs(8, otMelati, sellerRole), ctxAs(ovRoot, otWarehouse, rootOutsideRole), rack)

	var (
		actors    []uint64
		overrides []bool
	)

	for _, m := range ownerHistory(t, svc, otMelati, otKaosHitam, 0) {
		actors = append(actors, m.GetActorUserId())
		overrides = append(overrides, m.GetIsOverride())
	}

	wantOverrideByActor(t, "OwnerStockHistory", actors, overrides)
}
