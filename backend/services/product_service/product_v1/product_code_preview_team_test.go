package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE TEAM CODE PREVIEW'S PRODUCTS (backlog #150): what RecomposeTeamCodes WOULD do, for the confirm team_service's
// TeamCodePreview opens — the same products (under `<old>-`, archived too), one example (an active one first), and the
// warehouses the same shelves seam names. The shelves come from the fake stock seam here; cmd/app_development's
// product_code_preview_test.go reads the real one.

const (
	pvTeam  = 7201
	pvOther = 7202
	pvWhA   = 7211
	pvWhB   = 7212
	pvWhC   = 7213
)

// Every product under the old code counts — archived ones too, as the write moves them — and none else; the example is
// an ACTIVE product (the lowest id among them) even when an archived one has a lower id; the warehouses are those
// holding units of the counted products, sorted — a product with nothing on a shelf is counted and names none, and a
// left-alone or another team's product on a shelf adds none. Nothing is written.
func TestPreviewTeamRecompose_CountsTheMovingProductsAndNamesTheirShelves(t *testing.T) {
	db := san_testdb.DB(t)

	archived := insertProduct(t, db, pvTeam, "PV-ABC-001", "Diarsip")
	active := insertProduct(t, db, pvTeam, "PV-ABC-002", "Aktif")
	empty := insertProduct(t, db, pvTeam, "PV-ABC-003", "Kosong")
	bare := insertProduct(t, db, pvTeam, "BARE-PV-9", "Lama")
	theirs := insertProduct(t, db, pvOther, "PV-ABC-004", "Bukan kita")

	rcArchive(t, db, archived)

	stock := &fakeStock{onShelves: []product_v1.ShelvedIn{
		{ProductID: archived, WarehouseID: pvWhB},
		{ProductID: active, WarehouseID: pvWhB},
		{ProductID: active, WarehouseID: pvWhA},
		{ProductID: bare, WarehouseID: pvWhC},
		{ProductID: theirs, WarehouseID: pvWhC},
	}}
	svc := rcService(db, stock)

	got, err := svc.PreviewTeamRecompose(context.Background(), db, pvTeam, "PV-ABC", "PV-XYZ")
	if err != nil {
		t.Fatalf("PreviewTeamRecompose: %v", err)
	}

	if got.Products != 3 {
		t.Errorf("products = %d, want 3 (two active + one archived, not the bare one nor another team's)", got.Products)
	}

	if got.ExampleOld != "PV-ABC-002" || got.ExampleNew != "PV-XYZ-002" {
		t.Errorf("example = %q → %q, want the ACTIVE PV-ABC-002 → PV-XYZ-002", got.ExampleOld, got.ExampleNew)
	}

	if want := []uint64{pvWhA, pvWhB}; !slices.Equal(got.WarehouseIDs, want) {
		t.Errorf("warehouses = %v, want %v (sorted, once each, never the bare or another team's shelf)", got.WarehouseIDs, want)
	}

	for id, want := range map[uint64]string{archived: "PV-ABC-001", active: "PV-ABC-002", empty: "PV-ABC-003", bare: "BARE-PV-9"} {
		if code := rcCode(t, db, id); code != want {
			t.Errorf("product %d's code = %q — the preview moved it", id, code)
		}

		if len(rcLogs(t, db, id)) != 0 || rcTagged(t, db, id) || len(rcWaits(t, db, id)) != 0 {
			t.Errorf("product %d got a history line, a tag or a wait — the preview writes nothing", id)
		}
	}
}

// Only archived products under the old code: the example is an archived one — never none while some would move.
func TestPreviewTeamRecompose_AnArchivedExampleWhenNoneIsActive(t *testing.T) {
	db := san_testdb.DB(t)

	a := insertProduct(t, db, pvTeam, "PV2-ABC-A", "Satu")
	rcArchive(t, db, a)

	got, err := rcService(db, &fakeStock{}).PreviewTeamRecompose(context.Background(), db, pvTeam, "PV2-ABC", "PV2-Q")
	if err != nil {
		t.Fatal(err)
	}

	if got.Products != 1 || got.ExampleOld != "PV2-ABC-A" || got.ExampleNew != "PV2-Q-A" || len(got.WarehouseIDs) != 0 {
		t.Errorf("preview = %+v, want 1 product, PV2-ABC-A → PV2-Q-A, no warehouse", got)
	}
}

// A dash in either code is no ambiguity: the exact old prefix comes off (AB → AB-C), as the write does it.
func TestPreviewTeamRecompose_ADashInTheNewCode(t *testing.T) {
	db := san_testdb.DB(t)

	insertProduct(t, db, pvTeam, "PV3AB-1", "Satu")

	got, err := rcService(db, &fakeStock{}).PreviewTeamRecompose(context.Background(), db, pvTeam, "PV3AB", "PV3AB-C")
	if err != nil {
		t.Fatal(err)
	}

	if got.Products != 1 || got.ExampleOld != "PV3AB-1" || got.ExampleNew != "PV3AB-C-1" {
		t.Errorf("preview = %+v, want PV3AB-1 → PV3AB-C-1", got)
	}
}

// No product under the old code: nothing moves — zero, no example, no warehouse.
func TestPreviewTeamRecompose_NoProducts(t *testing.T) {
	db := san_testdb.DB(t)

	insertProduct(t, db, pvTeam, "BARE-PV4", "Lama")

	got, err := rcService(db, &fakeStock{}).PreviewTeamRecompose(context.Background(), db, pvTeam, "PV4-ABC", "PV4-XYZ")
	if err != nil {
		t.Fatal(err)
	}

	if got.Products != 0 || got.ExampleOld != "" || got.ExampleNew != "" || len(got.WarehouseIDs) != 0 {
		t.Errorf("preview = %+v, want nothing", got)
	}
}

// No shelves to read refuses, as the write does — a preview naming no warehouse would say "nothing to reprint" falsely.
// And the same code is no change to preview.
func TestPreviewTeamRecompose_RefusesWithoutTheShelvesOrAChange(t *testing.T) {
	db := san_testdb.DB(t)

	insertProduct(t, db, pvTeam, "PV5-ABC-A", "Satu")

	_, err := product_v1.NewService(db, history, teamCodes, nil, nil).PreviewTeamRecompose(context.Background(), db, pvTeam, "PV5-ABC", "PV5-XYZ")
	if err == nil {
		t.Error("no stock seam: the preview answered")
	}

	_, err = rcService(db, &fakeStock{}).PreviewTeamRecompose(context.Background(), db, pvTeam, "PV5-ABC", "PV5-ABC")
	if err == nil {
		t.Error("a preview of the same code was not refused")
	}
}
