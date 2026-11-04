package inventory_v1_test

import (
	"context"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE COMPENSATION'S LISTENER (the-compensation-event-is-inventory-tx-cancel): InventoryTxCancel releases the take under
// its key through the one team-checked release OrderTransactionRelease runs (the-cancel-event-names-the-team).

func txCancel(svc *inventory_v1.Service, team uint64, key string) error {
	return svc.InventoryTxCancel(context.Background(), &eventsv1.InventoryTxCancel{
		IdempotencyKey: key,
		TeamId:         team,
		WarehouseId:    otWarehouse,
		ActorId:        8,
		Reason:         "the order was not written after its stock take",
	})
}

// TAKEN → RELEASED ONCE; REDELIVERED → NOTHING. The first delivery gives every unit back; a second delivery of the same
// event finds the take released and is acknowledged without giving anything twice.
func TestInventoryTxCancel_ReleasesTheTakeOnceAndARedeliveryIsANoOp(t *testing.T) {
	svc, db, rakA, _ := otStocked(t)

	_, err := take(svc, "K-cancel", line(otKaosHitam, 4))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	err = txCancel(svc, otMelati, "K-cancel")
	if err != nil {
		t.Fatalf("first delivery: %v", err)
	}

	var batch models.Batch
	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)

	if batch.StockCount != 10 || rackCount(t, db, otKaosHitam, rakA) != 10 {
		t.Fatalf("after the cancel the batch holds %d and Rak A %d, want all 10 back", batch.StockCount,
			rackCount(t, db, otKaosHitam, rakA))
	}

	err = txCancel(svc, otMelati, "K-cancel")
	if err != nil {
		t.Fatalf("redelivery: %v — a released take must be acknowledged", err)
	}

	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)

	if batch.StockCount != 10 || rackCount(t, db, otKaosHitam, rakA) != 10 {
		t.Fatalf("after the redelivery the batch holds %d and Rak A %d — it gave back twice", batch.StockCount,
			rackCount(t, db, otKaosHitam, rakA))
	}

	// The direct release the order made first, then the event: the event is the no-op.
	res, err := release(svc, otMelati, "K-cancel")
	if err != nil || res.GetReleased() {
		t.Fatalf("a release after the cancel = %+v, %v — want nothing rolled back", res, err)
	}
}

// AN UNSEEN KEY IS CLAIMED: the cancel arrives before any take under K (the take never landed, or is still on its way),
// so K is claimed with none — and a take that arrives late is refused as a used key, taking nothing.
func TestInventoryTxCancel_AnUnseenKeyIsClaimedSoALateTakeIsRefused(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	err := txCancel(svc, otMelati, "K-unseen")
	if err != nil {
		t.Fatalf("cancel of an unseen key: %v", err)
	}

	_, err = take(svc, "K-unseen", line(otKaosHitam, 1))
	if refusalOf(t, err).GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED {
		t.Fatalf("late take: err = %v, want KEY_USED", err)
	}

	if n := countTransactions(db, models.TxOrder); n != 0 {
		t.Fatalf("the late take wrote %d order transactions", n)
	}
}

// ANOTHER TEAM'S KEY IS ACKNOWLEDGED, NEVER RELEASED: Sinar naming Melati's take answers nil — redelivering it would
// never succeed — and Melati's units stay taken.
func TestInventoryTxCancel_AnotherTeamsTakeIsAcknowledgedAndKept(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	_, err := take(svc, "K-melati", line(otKaosHitam, 3))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	err = txCancel(svc, otSinar, "K-melati")
	if err != nil {
		t.Fatalf("another team's cancel: err = %v, want it acknowledged (nil)", err)
	}

	var batch models.Batch
	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)

	if batch.StockCount != 7 {
		t.Fatalf("Melati's batch holds %d, want 7 — another team's cancel must release nothing", batch.StockCount)
	}
}

// A CANCEL STILL MEETS THE COUNT FIRST (a-cancel-still-meets-the-count-first): while a count holds the take's rack the
// listener answers an ERROR, so the broker redelivers; nothing is put back. Once the count is called off, the next
// delivery releases.
func TestInventoryTxCancel_ACountLockIsAnErrorUntilTheCountEnds(t *testing.T) {
	f := opnameStocked(t)

	_, err := orderKaosHitam(f, "K-counted", 1)
	if err != nil {
		t.Fatalf("take before the count: %v", err)
	}

	a, b, _ := kaosHitamOn(t, f)

	s := countKaosHitam(t, f)

	err = txCancel(f.svc, otMelati, "K-counted")
	if err == nil {
		t.Fatal("a cancel under the count was acknowledged — it must be redelivered until the count ends")
	}

	if a2, b2, _ := kaosHitamOn(t, f); a2 != a || b2 != b {
		t.Fatalf("Rak A %d → %d, B %d → %d — a refused cancel put units back", a, a2, b, b2)
	}

	cancelCount(t, f, s.GetId())

	err = txCancel(f.svc, otMelati, "K-counted")
	if err != nil {
		t.Fatalf("the redelivery after the count: %v", err)
	}

	if a3, b3, _ := kaosHitamOn(t, f); a3+b3 != 10 {
		t.Fatalf("Rak A %d + B %d, want 10 once released", a3, b3)
	}
}
