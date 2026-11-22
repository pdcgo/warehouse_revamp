package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
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
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil, nil, nil)
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

// THE OWNER'S STOCK HISTORY NAMES WHO RECEIVED A SAMPLE (a-sample-keeps-its-recipient — *Melati's history: 2 Kaos Hitam to
// Budi*): the owning team checks its samples by who got them, so its own history's sample row carries the recipient from
// the sample's inventory transaction, the staff's note still apart in `reason`; the receive and the take name nobody — not
// even when their transaction somehow carries a name, since only a sample row asks. It is read on the PAGE: page 2 of
// one-row pages (the OFFSET skipping the take) still names Pak Budi.
func TestOwnerStockHistory_ASampleRowNamesWhoReceivedIt(t *testing.T) {
	svc, db, rakA, _ := otStocked(t)

	_, err := svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: otWarehouse, RackId: rakA, Recipient: "Pak Budi", Description: "for a review video",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosHitam, Quantity: 2}},
	}))
	if err != nil {
		t.Fatalf("sample: %v", err)
	}

	_, err = take(svc, "key-1", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	rows := ownerHistory(t, svc, otMelati, otKaosHitam, 0)

	kinds := []inventoryv1.MovementKind{
		inventoryv1.MovementKind_MOVEMENT_KIND_PICK,
		inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE,
		inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
	}
	if len(rows) != len(kinds) {
		t.Fatalf("owner history = %d rows, want the take, the sample and the receive", len(rows))
	}

	for i, m := range rows {
		if m.GetKind() != kinds[i] {
			t.Fatalf("row %d = %s, want %s", i, m.GetKind(), kinds[i])
		}
	}

	if s := rows[1]; s.GetRecipient() != "Pak Budi" || s.GetReason() != "for a review video" || s.GetDelta() != -2 {
		t.Fatalf("the sample row = recipient %q, reason %q, %d — want Pak Budi, the note on its own, -2",
			s.GetRecipient(), s.GetReason(), s.GetDelta())
	}

	// A name on the take's transaction — no write sets one, but a row that is not a sample never reads it.
	err = db.
		Exec("UPDATE inventory_transactions SET recipient = ? WHERE id = ?", "Nobody", rows[0].GetMovementId()).
		Error
	if err != nil {
		t.Fatalf("a stray name on the take: %v", err)
	}

	for _, m := range ownerHistory(t, svc, otMelati, otKaosHitam, 0) {
		if m.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE && m.GetRecipient() != "" {
			t.Fatalf("a %s row names %q, want nobody — only a sample has a recipient", m.GetKind(), m.GetRecipient())
		}
	}

	res, err := svc.OwnerStockHistory(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
		TeamId: otMelati,
		Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: otKaosHitam},
		Page:   &commonv1.CommonPagination{Page: 2, Limit: 1},
	}))
	if err != nil {
		t.Fatalf("OwnerStockHistory page 2: %v", err)
	}

	ids := res.Msg.GetIds()
	if len(ids) != 1 || ids[0] != rows[1].GetId() {
		t.Fatalf("page 2 of one = %v, want the sample row %d", ids, rows[1].GetId())
	}

	var onPage *inventoryv1.OwnerMovement

	for _, item := range res.Msg.GetItems() {
		if mv := item.GetMovement(); mv != nil {
			onPage = mv.GetMapData()[ids[0]]
		}
	}

	if onPage.GetRecipient() != "Pak Budi" {
		t.Fatalf("page 2's sample row names %q, want Pak Budi — read on the page, past the OFFSET", onPage.GetRecipient())
	}
}
