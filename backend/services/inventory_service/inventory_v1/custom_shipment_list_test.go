package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE LIST'S FIXTURE (backlog #88 P2), on csStocked's Melati, Sinar, Gudang 5 (A) and Gudang 6 (B):
//
//	sample   Melati → Budi from A, 3 Kaos Hitam + 1 Kaos Polos, the team paying Rp 15.000 — value Rp 37.000
//	reship   Melati → Toko Sumber from A, 2 broken Widgets, the warehouse paying at the handover
//	sampleB  Melati → Citra from B, 1 Kaos Polos, the team paying (written straight to the table: B holds no stock)
//	sinar    Sinar → Dewi from A, 2 Kaos Merah, the team paying
//
// Newest first is sinar, sampleB, reship, sample.
type csListFixture struct {
	*csFixture

	sample, reship, sampleB, sinar uint64
}

func csListed(t *testing.T) *csListFixture {
	t.Helper()

	f := &csListFixture{csFixture: csStocked(t)}

	f.sample = f.mustCreate(t, csSample("k-1", csProduct(wtKaosHitam, 3), csProduct(wtKaosPolos, 1))).GetId()
	f.reship = f.mustCreate(t, f.csReship("r-1", csRestockLine(f.line[csWidget], 2))).GetId()

	b := models.CustomShipment{
		TeamID: otMelati, WarehouseID: wtB, Kind: models.CustomShipmentSample, Status: models.CustomShipmentRequested,
		RecipientName: "Citra", RecipientPhone: "0815-3333", RecipientAddress: "Jl. Melati 3, Jakarta",
		ShipmentChannelID: csCourier, Payer: models.CustomShipmentPayerTeam, FinanceAccountID: wtAccount,
		ShippingCost: 9000, Total: 5000, IdempotencyKey: "b-1", CreatedByUserID: wtSeller,
		Items: []models.CustomShipmentItem{{ProductID: wtKaosPolos, ProductCode: "KP-001", Name: "Kaos Polos", Quantity: 1, Total: 5000}},
	}

	err := f.db.Create(&b).Error
	if err != nil {
		t.Fatalf("Melati's parcel from B: %v", err)
	}

	f.sampleB = b.ID

	sinar := csSample("s-1", csProduct(wtKaosMerah, 2))
	sinar.TeamId = otSinar
	sinar.Recipient = &inventoryv1.CustomShipmentRecipient{Name: "Dewi", Phone: "0816-4444", Address: "Jl. Kenanga 4"}

	res, err := f.svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(sinar))
	if err != nil {
		t.Fatalf("Sinar's sample: %v", err)
	}

	f.sinar = res.Msg.GetCustomShipment().GetId()

	return f
}

// listIDs is the ids of a list's rows, in order.
func listIDs(res *inventoryv1.CustomShipmentListResponse) []uint64 {
	ids := make([]uint64, 0, len(res.GetCustomShipments()))
	for _, cs := range res.GetCustomShipments() {
		ids = append(ids, cs.GetId())
	}

	return ids
}

// The selling team lists ITS OWN parcels, from every warehouse, newest first, each with its money; another selling
// team's are absent — Sinar lists only its one.
func TestCustomShipmentList_TheSellingTeamListsItsOwn(t *testing.T) {
	f := csListed(t)

	melati := f.listAs(t, otMelati, nil, 1, 20)

	if got, want := listIDs(melati), []uint64{f.sampleB, f.reship, f.sample}; !slices.Equal(got, want) {
		t.Fatalf("Melati lists %v, want its own newest first %v (Sinar's %d absent)", got, want, f.sinar)
	}

	if info := melati.GetPageInfo(); info.GetTotalItems() != 3 || info.GetTotalPage() != 1 || info.GetCurrentPage() != 1 {
		t.Fatalf("page info = %+v, want 3 items on 1 page", info)
	}

	sample := melati.GetCustomShipments()[2]
	if sample.GetTotal() != 37000 || sample.GetFinanceAccountId() != wtAccount || sample.GetShippingCost() != 15000 ||
		len(sample.GetItems()) != 2 || csItemOf(t, sample, wtKaosHitam).GetTotal() != 32000 {
		t.Fatalf("Melati's sample on its list = %+v, want its value, account, cost and two lines", sample)
	}

	if len(sample.GetLogs()) != 0 {
		t.Fatal("a list row carries the trail — that is Detail's alone")
	}

	if got := listIDs(f.listAs(t, otSinar, nil, 1, 20)); !slices.Equal(got, []uint64{f.sinar}) {
		t.Fatalf("Sinar lists %v, want only its own %d", got, f.sinar)
	}
}

// ⚠ THE WAREHOUSE'S LIST CARRIES NO SELLER MONEY — on screen or in the data (a-warehouse-sees-no-seller-money,
// the-custom-shipments-prototype-is-accepted). Gudang 5 lists the parcels it ships — Melati's and Sinar's, never the one
// leaving Gudang 6 — and the whole response, walked field by field, carries no sample value, no line value, no account
// and no team's cost: only the ongkir of the parcel IT pays the courier for (the-warehouse-sees-the-ongkir-it-paid).
func TestCustomShipmentList_TheWarehouseListReceivesNoSellerMoney(t *testing.T) {
	f := csListed(t)

	res := f.listAs(t, wtA, nil, 1, 20)

	if got, want := listIDs(res), []uint64{f.sinar, f.reship, f.sample}; !slices.Equal(got, want) {
		t.Fatalf("Gudang 5 lists %v, want the parcels it ships %v (Gudang 6's %d absent)", got, want, f.sampleB)
	}

	got := moneySet(res.ProtoReflect(), "")
	if want := []string{"custom_shipments[].shipping_cost"}; !slices.Equal(got, want) {
		t.Fatalf("seller money in the warehouse's list = %v, want only the reship's ongkir it pays %v", got, want)
	}

	for _, cs := range res.GetCustomShipments() {
		if cs.Total != nil || (cs.GetPayer() == inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM && cs.ShippingCost != nil) {
			t.Fatalf("parcel %d carries a money field (even 0) for the warehouse", cs.GetId())
		}

		for _, item := range cs.GetItems() {
			if item.Total != nil {
				t.Fatalf("parcel %d's line %d carries its value for the warehouse", cs.GetId(), item.GetId())
			}
		}
	}

	if reship := res.GetCustomShipments()[1]; reship.ShippingCost == nil || reship.GetShippingCost() != 0 {
		t.Fatalf("the reship the warehouse pays for = %+v, want its ongkir set, 0 until the handover", reship)
	}

	if got := listIDs(f.listAs(t, wtB, nil, 1, 20)); !slices.Equal(got, []uint64{f.sampleB}) {
		t.Fatalf("Gudang 6 lists %v, want only the parcel leaving it %d", got, f.sampleB)
	}
}

// Every reader's row IS its Detail without the trail — the same mapper, the same money rule, row by row: the owner's,
// the warehouse's and the root team's.
func TestCustomShipmentList_ARowIsTheDetailWithoutTheTrail(t *testing.T) {
	f := csListed(t)

	for _, reader := range []uint64{otMelati, otSinar, wtA, wtB, san_auth.RootTeamID} {
		for _, row := range f.listAs(t, reader, nil, 1, 20).GetCustomShipments() {
			detail, err := f.detail(reader, row.GetId())
			if err != nil {
				t.Fatalf("team %d opens its listed parcel %d: %v", reader, row.GetId(), err)
			}

			detail.Logs = nil
			if !proto.Equal(row, detail) {
				t.Fatalf("team %d's row %d\n= %v\nwant its detail without the trail\n= %v", reader, row.GetId(), row, detail)
			}
		}
	}
}

// The root team lists every parcel of every team and warehouse, with the money.
func TestCustomShipmentList_TheRootTeamListsEveryParcel(t *testing.T) {
	f := csListed(t)

	res := f.listAs(t, san_auth.RootTeamID, nil, 1, 20)

	if got, want := listIDs(res), []uint64{f.sinar, f.sampleB, f.reship, f.sample}; !slices.Equal(got, want) {
		t.Fatalf("root lists %v, want every parcel %v", got, want)
	}

	if res.GetCustomShipments()[3].GetTotal() != 37000 {
		t.Fatal("root reads the sample without its value")
	}
}

// PAGING: newest first, a page at a time — the pages are disjoint, together they are the whole list, and the page info
// counts the whole list, not the page. A page past the end is empty with the same count.
func TestCustomShipmentList_Pages(t *testing.T) {
	f := csListed(t)

	first := f.listAs(t, san_auth.RootTeamID, nil, 1, 3)
	second := f.listAs(t, san_auth.RootTeamID, nil, 2, 3)
	past := f.listAs(t, san_auth.RootTeamID, nil, 3, 3)

	if got, want := listIDs(first), []uint64{f.sinar, f.sampleB, f.reship}; !slices.Equal(got, want) {
		t.Fatalf("page 1 = %v, want %v", got, want)
	}

	if got, want := listIDs(second), []uint64{f.sample}; !slices.Equal(got, want) {
		t.Fatalf("page 2 = %v, want %v", got, want)
	}

	if len(past.GetCustomShipments()) != 0 {
		t.Fatalf("page 3 = %v, want empty", listIDs(past))
	}

	for i, res := range []*inventoryv1.CustomShipmentListResponse{first, second, past} {
		info := res.GetPageInfo()
		if info.GetTotalItems() != 4 || info.GetTotalPage() != 2 || info.GetCurrentPage() != uint32(i+1) {
			t.Fatalf("page %d info = %+v, want 4 items on 2 pages", i+1, info)
		}
	}
}

// THE FILTERS the accepted list screen sends — each narrows the reader's own parcels, and the count with the rows.
func TestCustomShipmentList_EachFilterNarrows(t *testing.T) {
	f := csListed(t)

	// The reship has been picked (P3 writes it; here the row is moved by hand).
	err := f.db.
		Model(&models.CustomShipment{}).
		Where("id = ?", f.reship).
		Update("status", models.CustomShipmentPicked).
		Error
	if err != nil {
		t.Fatalf("pick the reship: %v", err)
	}

	cases := []struct {
		name   string
		team   uint64
		filter *inventoryv1.CustomShipmentListFilter
		want   []uint64
	}{
		{"status requested", otMelati, &inventoryv1.CustomShipmentListFilter{
			Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED}, []uint64{f.sampleB, f.sample}},
		{"status picked", otMelati, &inventoryv1.CustomShipmentListFilter{
			Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_PICKED}, []uint64{f.reship}},
		{"status cancelled", otMelati, &inventoryv1.CustomShipmentListFilter{
			Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_CANCELLED}, []uint64{}},
		{"the warehouse's queue (requested)", wtA, &inventoryv1.CustomShipmentListFilter{
			Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED}, []uint64{f.sinar, f.sample}},
		{"kind sample", otMelati, &inventoryv1.CustomShipmentListFilter{
			Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE}, []uint64{f.sampleB, f.sample}},
		{"kind reship", wtA, &inventoryv1.CustomShipmentListFilter{
			Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP}, []uint64{f.reship}},
		{"the warehouse it ships from", otMelati, &inventoryv1.CustomShipmentListFilter{WarehouseId: wtB}, []uint64{f.sampleB}},
		{"the warehouse narrows, never widens", otSinar, &inventoryv1.CustomShipmentListFilter{WarehouseId: wtB}, []uint64{}},
		{"its number with the hash", otMelati, &inventoryv1.CustomShipmentListFilter{Q: "#" + itoa(f.reship)}, []uint64{f.reship}},
		// Gudang 6 ships one parcel, so a short id that a product code also holds ("1" in KP-001) still reads one row.
		{"its number bare", wtB, &inventoryv1.CustomShipmentListFilter{Q: " " + itoa(f.sampleB) + " "}, []uint64{f.sampleB}},
		{"another team's number", otSinar, &inventoryv1.CustomShipmentListFilter{Q: "#" + itoa(f.sample)}, []uint64{}},
		{"the recipient, any case", otMelati, &inventoryv1.CustomShipmentListFilter{Q: "bUDi"}, []uint64{f.sample}},
		{"a line's product code", otMelati, &inventoryv1.CustomShipmentListFilter{Q: "wg-1"}, []uint64{f.reship}},
		{"a line's product name, two lines match once", otMelati, &inventoryv1.CustomShipmentListFilter{Q: "kaos"},
			[]uint64{f.sampleB, f.sample}},
		{"text matching nothing", otMelati, &inventoryv1.CustomShipmentListFilter{Q: "zzz"}, []uint64{}},
		{"filters AND together", otMelati, &inventoryv1.CustomShipmentListFilter{
			Kind:   inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE,
			Status: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED, WarehouseId: wtA, Q: "kaos",
		}, []uint64{f.sample}},
	}

	for _, c := range cases {
		res := f.listAs(t, c.team, c.filter, 1, 20)

		if got := listIDs(res); !slices.Equal(got, c.want) {
			t.Fatalf("%s: lists %v, want %v", c.name, got, c.want)
		}

		if res.GetPageInfo().GetTotalItems() != uint64(len(c.want)) {
			t.Fatalf("%s: counts %d, want %d — the count reads the rows' set", c.name, res.GetPageInfo().GetTotalItems(), len(c.want))
		}
	}
}

// A team with no parcel lists nothing, counted 0 — never an error.
func TestCustomShipmentList_NothingYet(t *testing.T) {
	f := csStocked(t)

	res := f.listAs(t, otMelati, nil, 1, 20)
	if len(res.GetCustomShipments()) != 0 || res.GetPageInfo().GetTotalItems() != 0 || res.GetPageInfo().GetTotalPage() != 0 {
		t.Fatalf("an empty list = %+v", res)
	}
}

func (f *csFixture) listAs(
	t *testing.T,
	teamID uint64,
	filter *inventoryv1.CustomShipmentListFilter,
	page, limit uint32,
) *inventoryv1.CustomShipmentListResponse {
	t.Helper()

	res, err := f.svc.CustomShipmentList(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentListRequest{
		TeamId: teamID, Filter: filter, Page: &commonv1.CommonPagination{Page: page, Limit: limit},
	}))
	if err != nil {
		t.Fatalf("list as team %d: %v", teamID, err)
	}

	return res.Msg
}
