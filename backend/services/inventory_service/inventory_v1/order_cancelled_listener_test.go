package inventory_v1_test

import (
	"context"
	"strings"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A CANCELLED ORDER'S STOCK COMES BACK ON ITS EVENT (inventory-returns-stock-on-order-cancelled, backlog #10 slice 4): the
// order's cancel asks StockLockCheck first, moves its status, and announces OrderCancelled{K, warehouse}; this listener
// releases the take by K through the one team-checked release (the-cancel-event-names-the-team).

func orderCancelled(svc *inventory_v1.Service, team uint64, key string) error {
	return svc.OrderCancelled(context.Background(), &eventsv1.OrderCancelled{
		TeamId:         team,
		OrderId:        81,
		ActorId:        8,
		ShopId:         1,
		IdempotencyKey: key,
		WarehouseId:    otWarehouse,
	})
}

// RELEASED ONCE, A REDELIVERY IS A NO-OP — and so is the compensation's late InventoryTxCancel on the same K.
func TestOrderCancelled_ReleasesTheTakeOnceAndARedeliveryIsANoOp(t *testing.T) {
	svc, db, rakA, _ := otStocked(t)

	_, err := take(svc, "K-cancelled", line(otKaosHitam, 4))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	err = orderCancelled(svc, otMelati, "K-cancelled")
	if err != nil {
		t.Fatalf("first delivery: %v", err)
	}

	var batch models.Batch
	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)

	if batch.StockCount != 10 || rackCount(t, db, otKaosHitam, rakA) != 10 {
		t.Fatalf("after the cancel the batch holds %d and Rak A %d, want all 10 back", batch.StockCount,
			rackCount(t, db, otKaosHitam, rakA))
	}

	err = orderCancelled(svc, otMelati, "K-cancelled")
	if err != nil {
		t.Fatalf("redelivery: %v — a released take must be acknowledged", err)
	}

	err = txCancel(svc, otMelati, "K-cancelled")
	if err != nil {
		t.Fatalf("a late InventoryTxCancel on the same key: %v", err)
	}

	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)

	if batch.StockCount != 10 || rackCount(t, db, otKaosHitam, rakA) != 10 {
		t.Fatalf("after the redeliveries the batch holds %d and Rak A %d — it gave back twice", batch.StockCount,
			rackCount(t, db, otKaosHitam, rakA))
	}

	var rollbacks int64
	db.Model(&models.InventoryTransaction{}).Where("is_rollback = ?", true).Count(&rollbacks)

	if rollbacks != 1 {
		t.Fatalf("%d transactions rolled back, want exactly 1", rollbacks)
	}
}

// NO KEY: an order that never took stock. Acknowledged, nothing claimed.
func TestOrderCancelled_AnEmptyKeyIsAcknowledged(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	err := orderCancelled(svc, otMelati, "")
	if err != nil {
		t.Fatalf("an empty key: %v — want it acknowledged", err)
	}

	var claims int64
	db.Model(&models.IdempotencyOrderCheck{}).Where("idempotency_key = ?", "").Count(&claims)

	if claims != 0 {
		t.Fatal("an empty key was claimed")
	}
}

// ANOTHER TEAM'S TAKE: acknowledged, never released.
func TestOrderCancelled_AnotherTeamsTakeIsAcknowledgedAndKept(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	_, err := take(svc, "K-theirs", line(otKaosHitam, 3))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	err = orderCancelled(svc, otSinar, "K-theirs")
	if err != nil {
		t.Fatalf("another team's cancel: %v — want it acknowledged", err)
	}

	var batch models.Batch
	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)

	if batch.StockCount != 7 {
		t.Fatalf("Melati's batch holds %d, want 7 — another team's cancel must release nothing", batch.StockCount)
	}
}

// A COUNT LOCK IS AN ERROR UNTIL THE COUNT ENDS (a-cancel-still-meets-the-count-first): the cancel that slipped past the
// order's check has its release refused, the listener errors so the broker redelivers, and once the count is called off
// the next delivery releases.
func TestOrderCancelled_ACountLockIsAnErrorUntilTheCountEnds(t *testing.T) {
	f := opnameStocked(t)

	_, err := orderKaosHitam(f, "K-counted-cancel", 1)
	if err != nil {
		t.Fatalf("take before the count: %v", err)
	}

	a, b, _ := kaosHitamOn(t, f)

	s := countKaosHitam(t, f)

	err = orderCancelled(f.svc, otMelati, "K-counted-cancel")
	if err == nil || !strings.Contains(err.Error(), "being counted") {
		t.Fatalf("a cancel under the count: err = %v, want an error naming the count — it must be redelivered", err)
	}

	if a2, b2, _ := kaosHitamOn(t, f); a2 != a || b2 != b {
		t.Fatalf("Rak A %d → %d, B %d → %d — a refused release put units back", a, a2, b, b2)
	}

	cancelCount(t, f, s.GetId())

	err = orderCancelled(f.svc, otMelati, "K-counted-cancel")
	if err != nil {
		t.Fatalf("the redelivery after the count: %v", err)
	}

	if a3, b3, _ := kaosHitamOn(t, f); a3+b3 != 10 {
		t.Fatalf("Rak A %d + B %d, want 10 once released", a3, b3)
	}
}

// STOCK LOCK CHECK — the order's cancel asks it first. It names the count holding the take's rack, the same one the
// release would be refused with; nil for no take, another team's take, a released take, or no count.
func TestStockLockCheck_NamesTheCountHoldingTheTake(t *testing.T) {
	f := opnameStocked(t)
	ctx := context.Background()

	_, err := orderKaosHitam(f, "K-check", 1)
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	lock, err := f.svc.StockLockCheck(ctx, otMelati, otWarehouse, "K-check")
	if err != nil || lock != nil {
		t.Fatalf("before any count: lock %v, err %v — want none", lock, err)
	}

	s := countKaosHitam(t, f)

	lock, err = f.svc.StockLockCheck(ctx, otMelati, otWarehouse, "K-check")
	if err != nil || lock == nil || lock.SessionID != s.GetId() || !strings.Contains(lock.Error(), "being counted") {
		t.Fatalf("under the count: lock %+v, err %v — want count #%d", lock, err, s.GetId())
	}

	for _, c := range []struct {
		what      string
		team      uint64
		warehouse uint64
		key       string
	}{
		{"a key never taken", otMelati, otWarehouse, "K-never"},
		{"an empty key", otMelati, otWarehouse, ""},
		{"another team's take", otSinar, otWarehouse, "K-check"},
		{"another warehouse", otMelati, otWarehouse + 1, "K-check"},
	} {
		lock, err = f.svc.StockLockCheck(ctx, c.team, c.warehouse, c.key)
		if err != nil || lock != nil {
			t.Fatalf("%s: lock %v, err %v — want none", c.what, lock, err)
		}
	}

	cancelCount(t, f, s.GetId())

	lock, err = f.svc.StockLockCheck(ctx, otMelati, otWarehouse, "K-check")
	if err != nil || lock != nil {
		t.Fatalf("after the count: lock %v, err %v — want none", lock, err)
	}
}

// A RELEASED TAKE HOLDS NOTHING BACK: even under a count over its old racks, nothing is left to put back.
func TestStockLockCheck_AReleasedTakeIsNotHeld(t *testing.T) {
	f := opnameStocked(t)

	_, err := orderKaosHitam(f, "K-gone", 1)
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	err = orderCancelled(f.svc, otMelati, "K-gone")
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	_ = countKaosHitam(t, f)

	lock, err := f.svc.StockLockCheck(context.Background(), otMelati, otWarehouse, "K-gone")
	if err != nil || lock != nil {
		t.Fatalf("a released take under a count: lock %v, err %v — want none", lock, err)
	}
}
