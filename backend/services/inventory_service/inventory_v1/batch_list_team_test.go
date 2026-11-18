package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE BATCH LIST FILTERS BY TEAM (the-batch-list-filters-by-team; owner: *"oke, kasih tim"*) — whose goods, read off the
// owner written on the batch at mint (a-batch-carries-its-owner).
//
//	Gudang 5   Melati's Kaos Hitam   two batches — 8 for Rp 80.000, 2 for Rp 24.000
//	           Sinar's  Kaos Polos   one batch — 4 for Rp 80.000
//	Gudang 6   Melati's Kaos Hitam   one batch — another building's, never on Gudang 5's list
type batchTeamFixture struct {
	svc    *inventory_v1.Service
	db     *gorm.DB
	melati []uint64 // Melati's Gudang 5 batches, newest first — the list's order
	sinar  []uint64
}

func batchTeamStocked(t *testing.T) batchTeamFixture {
	t.Helper()

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, wpsFacts(), nil, nil, nil, nil)

	rak := newRack(t, svc, otWarehouse, "rak-a")
	otRestock(t, svc, otMelati, otKaosHitam, 8, 80000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 8}})
	otRestock(t, svc, otSinar, otKaosPolos, 4, 80000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 4}})
	otRestock(t, svc, otMelati, otKaosHitam, 2, 24000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 2}})

	// Melati's goods in another building: the same team, never this warehouse's row.
	rakOther := newRack(t, svc, wpsOther, "rak-z")

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: wpsOther,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: otKaosHitam, ProductCode: "KH-01", Name: "Kaos Hitam", Count: 3, Total: 30000}},
	}))
	if err != nil {
		t.Fatalf("restock Gudang 6: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wpsOther, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: 3,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rakOther, Quantity: 3}},
		}},
	}))
	if err != nil {
		t.Fatalf("accept Gudang 6: %v", err)
	}

	f := batchTeamFixture{svc: svc, db: db}
	f.melati = teamBatchIDs(t, db, otWarehouse, otMelati)
	f.sinar = teamBatchIDs(t, db, otWarehouse, otSinar)

	if len(f.melati) != 2 || len(f.sinar) != 1 {
		t.Fatalf("fixture: Melati %v, Sinar %v — want two batches and one", f.melati, f.sinar)
	}

	return f
}

// teamBatchIDs is a team's batches in a warehouse, newest first, straight off the ledger.
func teamBatchIDs(t *testing.T, db *gorm.DB, warehouse, team uint64) []uint64 {
	t.Helper()

	var ids []uint64

	err := db.
		Raw(`SELECT id FROM batches WHERE warehouse_id = ? AND team_id = ? ORDER BY id DESC`, warehouse, team).
		Scan(&ids).
		Error
	if err != nil {
		t.Fatalf("batches of team %d: %v", team, err)
	}

	return ids
}

// teamBatchList is one page of Gudang 5's batch list as its staff read it, narrowed by the filter given.
func teamBatchList(
	t *testing.T,
	svc *inventory_v1.Service,
	filter *inventoryv1.BatchListFilter,
	page, limit uint32,
) *inventoryv1.BatchListResponse {
	t.Helper()

	res, err := svc.BatchList(ctxAs(41, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.BatchListRequest{
			TeamId: otWarehouse,
			Filter: filter,
			Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
		},
	))
	if err != nil {
		t.Fatalf("batch list %+v: %v", filter, err)
	}

	return res.Msg
}

// Picked Melati, the list is Melati's batches here — the rows, the count and the header's ready value alike; picked
// Sinar, Sinar's. No pick is every team's, as before.
func TestBatchList_FiltersByOwnerTeam(t *testing.T) {
	f := batchTeamStocked(t)

	cases := []struct {
		name  string
		owner uint64
		want  []uint64
		value float64
	}{
		{"Melati", otMelati, f.melati, 104000},
		{"Sinar", otSinar, f.sinar, 80000},
		{"every team", 0, append(slices.Clone(f.melati[:1]), append(slices.Clone(f.sinar), f.melati[1])...), 184000},
		{"a team with nothing here", 999, nil, 0},
	}

	for _, c := range cases {
		res := teamBatchList(t, f.svc, &inventoryv1.BatchListFilter{OwnerTeamId: c.owner}, 1, 20)

		if !slices.Equal(res.GetIds(), c.want) {
			t.Fatalf("%s: ids = %v, want %v (newest first)", c.name, res.GetIds(), c.want)
		}

		if res.GetPageInfo().GetTotalItems() != uint64(len(c.want)) {
			t.Fatalf("%s: total = %d, want %d", c.name, res.GetPageInfo().GetTotalItems(), len(c.want))
		}

		if !san_money.Equal(res.GetReadyValueTotal(), c.value) {
			t.Fatalf("%s: ready value = %v, want %v — the header counts the picked team's batches only",
				c.name, res.GetReadyValueTotal(), c.value)
		}
	}
}

// The team narrows the whole filtered set, not one page of it: Melati's two batches walk over two pages of one.
func TestBatchList_OwnerTeamPages(t *testing.T) {
	f := batchTeamStocked(t)

	first := teamBatchList(t, f.svc, &inventoryv1.BatchListFilter{OwnerTeamId: otMelati}, 1, 1)
	second := teamBatchList(t, f.svc, &inventoryv1.BatchListFilter{OwnerTeamId: otMelati}, 2, 1)

	if !slices.Equal(first.GetIds(), f.melati[:1]) || !slices.Equal(second.GetIds(), f.melati[1:]) {
		t.Fatalf("pages = %v then %v, want %v then %v", first.GetIds(), second.GetIds(), f.melati[:1], f.melati[1:])
	}

	info := first.GetPageInfo()
	if info.GetTotalItems() != 2 || info.GetTotalPage() != 2 {
		t.Fatalf("page info = %+v, want 2 batches over 2 pages", info)
	}
}

// The team and the other filters narrow together: Melati's batches among those of a product only Sinar holds is none.
func TestBatchList_OwnerTeamWithTheOtherFilters(t *testing.T) {
	f := batchTeamStocked(t)

	none := teamBatchList(t, f.svc, &inventoryv1.BatchListFilter{OwnerTeamId: otMelati, ProductId: otKaosPolos}, 1, 20)
	if len(none.GetIds()) != 0 || none.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("Melati's Kaos Polos = %v, want none — Kaos Polos is Sinar's", none.GetIds())
	}

	sinar := teamBatchList(t, f.svc, &inventoryv1.BatchListFilter{OwnerTeamId: otSinar, ProductId: otKaosPolos}, 1, 20)
	if !slices.Equal(sinar.GetIds(), f.sinar) {
		t.Fatalf("Sinar's Kaos Polos = %v, want %v", sinar.GetIds(), f.sinar)
	}
}
