package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE PRODUCT PAGES KEEP THEIR KINDS (#143). The warehouse's Stock History now names a cancel, a broken unit and a found
// unit each by its own kind (CANCEL, BROKEN, FOUND — TestStockHistory_AProductsKindsAreEachTheirOwn). The selling product
// page's Stock History (OwnerStockHistory) and Discover's Riwayat Stok (DiscoverStockHistory) share kindOf, but their
// decisions name no word for those kinds (the-product-history-names-the-transaction: Retur, Penyesuaian;
// stock-history-is-everyones, the-discover-history-names-no-batch): they answer exactly what they answered before — the
// cancel RETURN, the broken and the found ADJUST — while the warehouse's read of the same rows says the new kinds.

// ppKindsLedger stocks Gudang 5 (opnameStocked: Melati's Kaos Hitam, batch 1 — 8 on Rak A 5 + Rak B 3 — and batch 2 —
// 2 on Rak B), then an order takes 1 and is cancelled, 1 of batch 2 is found damaged on Rak B, and 1 is found on Rak A,
// reported and approved.
func ppKindsLedger(t *testing.T) *opnameFixture {
	t.Helper()

	f := opnameStocked(t)
	b2 := productBatches(t, f.db, otKaosHitam)[1].ID

	_, err := takeAs(f.svc, otMelati, "key-143-pages", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	_, err = release(f.svc, otMelati, "key-143-pages")
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	_, err = f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: otKaosHitam,
		Place:      &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakB},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED,
		BatchId:    b2, Quantity: 1, Reason: "kardus basah",
	}))
	if err != nil {
		t.Fatalf("damaged: %v", err)
	}

	found := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)

	_, err = f.approve(opOwner(opDewi), found.GetId())
	if err != nil {
		t.Fatalf("approve the found: %v", err)
	}

	return f
}

// ppWant is the four newest rows as the product pages read them: the found, the broken, the cancel, the take.
var ppWant = []struct {
	kind  inventoryv1.MovementKind
	delta int64
}{
	{inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, 1},
	{inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, -1},
	{inventoryv1.MovementKind_MOVEMENT_KIND_RETURN, 1},
	{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, -1},
}

// ppSplitKind is whether a kind is one #143 split out — none reaches a product page.
func ppSplitKind(kind inventoryv1.MovementKind) bool {
	return kind == inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL ||
		kind == inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN ||
		kind == inventoryv1.MovementKind_MOVEMENT_KIND_FOUND
}

// The selling product page's Stock History: the cancel reads RETURN, the broken and the found ADJUST — and its RETURN and
// ADJUST filters reach them as before — while the warehouse's Stock History of the same product says CANCEL, BROKEN and
// FOUND.
func TestOwnerStockHistory_KeepsItsKinds(t *testing.T) {
	f := ppKindsLedger(t)

	rows := ownerHistory(t, f.svc, otMelati, otKaosHitam, 0)
	if len(rows) < len(ppWant) {
		t.Fatalf("owner history = %d rows, want at least the found, the broken, the cancel and the take", len(rows))
	}

	for i, want := range ppWant {
		if m := rows[i]; m.GetKind() != want.kind || m.GetDelta() != want.delta {
			t.Fatalf("owner row %d = %v %d, want %v %d", i, m.GetKind(), m.GetDelta(), want.kind, want.delta)
		}
	}

	for _, m := range rows {
		if ppSplitKind(m.GetKind()) {
			t.Fatalf("owner history answered %v — a kind the product page never showed", m.GetKind())
		}
	}

	for kind, want := range map[inventoryv1.MovementKind]int{
		inventoryv1.MovementKind_MOVEMENT_KIND_RETURN: 1,
		inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST: 2,
	} {
		res, err := f.svc.OwnerStockHistory(opOwner(opDewi), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
			TeamId: otMelati,
			Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: otKaosHitam, Kind: kind},
			Page:   page1(),
		}))
		if err != nil {
			t.Fatalf("OwnerStockHistory %v: %v", kind, err)
		}

		if n := len(res.Msg.GetIds()); n != want {
			t.Fatalf("owner %v filter = %d rows, want %d", kind, n, want)
		}
	}

	// The warehouse's read of the same rows names the new kinds: the fold is the product pages' alone.
	got := map[inventoryv1.MovementKind]bool{}
	for _, m := range productHistoryOf(t, f.svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED) {
		got[m.GetKind()] = true
	}

	if !got[inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL] || !got[inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN] ||
		!got[inventoryv1.MovementKind_MOVEMENT_KIND_FOUND] {
		t.Fatalf("warehouse Stock History kinds = %v, want CANCEL, BROKEN and FOUND", got)
	}
}

// Discover's Riwayat Stok, read by another team (Sinar): the same old kinds, row for row.
func TestDiscoverStockHistory_KeepsItsKinds(t *testing.T) {
	f := ppKindsLedger(t)

	_, rows := discoverHistory(t, f.svc, otSinar, otKaosHitam, 0, page1())
	if len(rows) < len(ppWant) {
		t.Fatalf("discover history = %d rows, want at least the found, the broken, the cancel and the take", len(rows))
	}

	for i, want := range ppWant {
		if m := rows[i]; m.GetKind() != want.kind || m.GetDelta() != want.delta {
			t.Fatalf("discover row %d = %v %d, want %v %d", i, m.GetKind(), m.GetDelta(), want.kind, want.delta)
		}
	}

	for _, m := range rows {
		if ppSplitKind(m.GetKind()) {
			t.Fatalf("discover history answered %v — a kind the discover detail never showed", m.GetKind())
		}
	}
}
