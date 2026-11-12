package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
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

// THE OWNER'S STOCK HISTORY READS A PRICE CORRECTION (the-correct-price-prototype-is-accepted): the owning team's own
// Admin corrected it, so no stamp; its own kind, 0 units with the balance unchanged, the price from and to, the value
// change and the reason. The kind filter finds it alone.
func TestOwnerStockHistory_ReadsAPriceCorrection(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	_, err := take(svc, "key-1", line(otKaosHitam, 3))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	_, err = svc.BatchRevalue(ctxAs(9, otMelati, sellerRole), connect.NewRequest(revalueRequest(b.ID, 10000, 9000)))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	rows := ownerHistory(t, svc, otMelati, otKaosHitam, 0)
	if len(rows) != 3 {
		t.Fatalf("owner history = %d rows, want receive, take, correction", len(rows))
	}

	c := rows[0]
	if c.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION || c.GetDelta() != 0 || c.GetBalance() != 7 ||
		c.GetReason() != revalueReason || c.GetActorUserId() != 9 || c.GetIsOverride() || c.GetBatchId() != b.ID ||
		!san_money.Equal(c.GetPriceUnitBefore(), 10000) || !san_money.Equal(c.GetPriceUnitAfter(), 9000) ||
		!san_money.Equal(c.GetValueChange(), -7000) {
		t.Fatalf("correction row = %+v, want REVALUATION 0 (7 left), 10000 → 9000, −7000, the reason, by 9 unstamped", c)
	}

	if p := rows[1]; p.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_PICK || !san_money.Equal(p.GetValueChange(), -30000) ||
		!san_money.Equal(p.GetPriceUnitBefore(), p.GetPriceUnitAfter()) {
		t.Fatalf("take row = %+v, want −30000 at an unchanged price", p)
	}

	res, err := svc.OwnerStockHistory(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
		TeamId: otMelati,
		Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: otKaosHitam, Kind: inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("OwnerStockHistory: %v", err)
	}

	if ids := res.Msg.GetIds(); len(ids) != 1 || ids[0] != c.GetId() {
		t.Fatalf("REVALUATION filter = %v, want the correction alone", ids)
	}
}
