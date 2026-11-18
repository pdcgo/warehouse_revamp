package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// RIWAYAT STOK IS EVERYONE'S (stock-history-is-everyones: *"riwayat stok boleh dibaca semua orang"*): the discover
// detail reads ANOTHER team's product's stock history — the owner's ledger, its units only. Melati owns Kaos Hitam
// (otStocked: 10 in Gudang 5); Sinar, another selling team, reads it.

// dsSecondWarehouse is a second building Melati's Kaos Hitam is restocked into, so the lens has two to tell apart.
const dsSecondWarehouse uint64 = 6

// discoverHistory reads one page of a product's history as `reader` — a selling team that is NOT the owner.
func discoverHistory(
	t *testing.T,
	svc *inventory_v1.Service,
	reader, product, warehouse uint64,
	page *commonv1.CommonPagination,
) (*inventoryv1.DiscoverStockHistoryResponse, []*inventoryv1.DiscoverMovement) {
	t.Helper()

	res, err := svc.DiscoverStockHistory(ctxAs(41, reader, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&inventoryv1.DiscoverStockHistoryRequest{
		TeamId: reader,
		Filter: &inventoryv1.DiscoverStockHistoryFilter{ProductId: product, WarehouseId: warehouse},
		Page:   page,
	}))
	if err != nil {
		t.Fatalf("DiscoverStockHistory: %v", err)
	}

	var rows []*inventoryv1.DiscoverMovement

	for _, item := range res.Msg.GetItems() {
		m := item.GetMovement().GetMapData()
		for _, id := range res.Msg.GetIds() {
			if mv, ok := m[id]; ok {
				rows = append(rows, mv)
			}
		}
	}

	return res.Msg, rows
}

// dsLedger stocks Gudang 5 (otStocked), takes 3 of Melati's Kaos Hitam, corrects its price, and restocks 4 more into a
// second warehouse — so the owner's ledger holds a receipt, an order take and a price correction in one building and a
// receipt in another.
func dsLedger(t *testing.T) *inventory_v1.Service {
	t.Helper()

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

	rack := newRack(t, svc, dsSecondWarehouse, "rak-c")

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: dsSecondWarehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: otKaosHitam, ProductCode: "KH-001", Name: "Kaos Hitam", Count: 4, Total: 48000}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: dsSecondWarehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: 4,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: 4}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}

	return svc
}

// ANOTHER TEAM READS THE OWNER'S LEDGER, ROW FOR ROW: every unit row OwnerStockHistory answers Melati — the same ids,
// kinds, changes, buildings, times and the SAME running balance — and nothing else. The price correction (a row that
// moved no unit, only money) is not there, and leaving it out changes no balance.
func TestDiscoverStockHistory_AnotherTeamReadsTheOwnersUnits(t *testing.T) {
	svc := dsLedger(t)

	owner := ownerHistory(t, svc, otMelati, otKaosHitam, 0)
	if len(owner) != 4 {
		t.Fatalf("owner's ledger = %d rows, want receipt, take, correction, receipt", len(owner))
	}

	res, rows := discoverHistory(t, svc, otSinar, otKaosHitam, 0, page1())

	var want []*inventoryv1.OwnerMovement

	for _, m := range owner {
		if m.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION {
			want = append(want, m)
		}
	}

	if len(rows) != 3 || res.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("another team read %d rows (total %d), want the owner's 3 unit rows", len(rows), res.GetPageInfo().GetTotalItems())
	}

	for i, got := range rows {
		w := want[i]
		if got.GetId() != w.GetId() || got.GetKind() != w.GetKind() || got.GetDelta() != w.GetDelta() ||
			got.GetBalance() != w.GetBalance() || got.GetWarehouseId() != w.GetWarehouseId() ||
			got.GetProductId() != w.GetProductId() || got.GetCreatedAtUnix() != w.GetCreatedAtUnix() {
			t.Fatalf("row %d = %+v, want the owner's %+v (units, building, time, balance)", i, got, w)
		}
	}

	// Newest first: the second building's receipt, then Gudang 5's take (7 left) and its receipt (10).
	if rows[0].GetWarehouseId() != dsSecondWarehouse || rows[0].GetBalance() != 4 ||
		rows[1].GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_PICK || rows[1].GetDelta() != -3 || rows[1].GetBalance() != 7 ||
		rows[2].GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE || rows[2].GetBalance() != 10 {
		t.Fatalf("rows = %+v, want +4 (4) in the second warehouse, then -3 (7) and +10 (10) in Gudang 5", rows)
	}
}

// NOTHING OF THE OWNER'S BUT THE UNITS: a DiscoverMovement has no field for a price, a value, a batch, a reason, a
// reference or a person — pinned on the contract itself, so one cannot be added without this test saying so.
func TestDiscoverStockHistory_CarriesNoMoneyNorAnythingElseOfTheOwners(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.DiscoverMovement"))
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	fields := desc.(protoreflect.MessageDescriptor).Fields()

	var got []string
	for i := range fields.Len() {
		got = append(got, string(fields.Get(i).Name()))
	}

	want := []string{"id", "product_id", "warehouse_id", "kind", "delta", "balance", "created_at_unix"}
	if !slices.Equal(got, want) {
		t.Fatalf("DiscoverMovement fields = %v, want exactly %v — never the owner's price, value, batch, reason, ref or person", got, want)
	}
}

// THE WAREHOUSE LENS: one building's rows only, its own running balance; a building that never held the product reads
// none. The paging is the owner's ledger's: newest first, a page at a time, the total over the whole lens.
func TestDiscoverStockHistory_FollowsTheLensAndPages(t *testing.T) {
	svc := dsLedger(t)

	_, here := discoverHistory(t, svc, otSinar, otKaosHitam, otWarehouse, page1())
	if len(here) != 2 || here[0].GetBalance() != 7 || here[1].GetBalance() != 10 {
		t.Fatalf("Gudang 5's lens = %+v, want the take (7) then the receipt (10)", here)
	}

	for _, m := range here {
		if m.GetWarehouseId() != otWarehouse {
			t.Fatalf("a row of warehouse %d in Gudang 5's lens", m.GetWarehouseId())
		}
	}

	_, nowhere := discoverHistory(t, svc, otSinar, otKaosHitam, 99, page1())
	if len(nowhere) != 0 {
		t.Fatalf("a building that never held it = %d rows, want 0", len(nowhere))
	}

	first, page := discoverHistory(t, svc, otSinar, otKaosHitam, 0, &commonv1.CommonPagination{Page: 1, Limit: 2})
	_, second := discoverHistory(t, svc, otSinar, otKaosHitam, 0, &commonv1.CommonPagination{Page: 2, Limit: 2})

	if len(page) != 2 || len(second) != 1 || first.GetPageInfo().GetTotalItems() != 3 || first.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("pages = %d + %d rows (total %d over %d pages), want 2 + 1 of 3 over 2",
			len(page), len(second), first.GetPageInfo().GetTotalItems(), first.GetPageInfo().GetTotalPage())
	}

	if page[0].GetId() <= page[1].GetId() || page[1].GetId() <= second[0].GetId() {
		t.Fatalf("pages not newest first: %d, %d | %d", page[0].GetId(), page[1].GetId(), second[0].GetId())
	}
}

// A PRODUCT NOBODY OWNS (an unknown id) has no ledger: an empty page, not an error — as DiscoverStockByIds answers zeros.
// And another team's product is never read from the READER's own batches: Sinar's Kaos Polos stays out of Kaos Hitam's.
func TestDiscoverStockHistory_UnknownProductReadsNothing(t *testing.T) {
	svc := dsLedger(t)

	res, rows := discoverHistory(t, svc, otSinar, 999_999, 0, page1())
	if len(rows) != 0 || res.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("an unknown product = %d rows (total %d), want none", len(rows), res.GetPageInfo().GetTotalItems())
	}

	_, polos := discoverHistory(t, svc, otMelati, otKaosPolos, 0, page1())
	for _, m := range polos {
		if m.GetProductId() != otKaosPolos {
			t.Fatalf("Kaos Polos's history holds product %d", m.GetProductId())
		}
	}

	if len(polos) != 1 || polos[0].GetDelta() != 5 {
		t.Fatalf("Melati reading Sinar's Kaos Polos = %+v, want its one receipt of 5", polos)
	}
}

// THE OWNING TEAM'S OWN READ IS UNCHANGED: OwnerStockHistory still answers Melati her whole ledger with the price
// correction and its money on it — the discover read is a sibling, not a change to it.
func TestDiscoverStockHistory_TheOwnersLedgerIsUnchanged(t *testing.T) {
	svc := dsLedger(t)

	owner := ownerHistory(t, svc, otMelati, otKaosHitam, otWarehouse)

	var correction *inventoryv1.OwnerMovement

	for _, m := range owner {
		if m.GetKind() == inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION {
			correction = m
		}
	}

	if len(owner) != 3 || correction == nil || correction.GetPriceUnitAfter() != 9000 || correction.GetReason() != revalueReason {
		t.Fatalf("the owner's Gudang 5 ledger = %+v, want receipt, take and the correction with its price and reason", owner)
	}

	// The owner's ledger answers ONLY the owner: Sinar asking OwnerStockHistory for Melati's product reads nothing.
	if theirs := ownerHistory(t, svc, otSinar, otKaosHitam, 0); len(theirs) != 0 {
		t.Fatalf("OwnerStockHistory answered Sinar %d rows of Melati's product, want none", len(theirs))
	}
}

// WHO MAY READ IT (stock-history-is-everyones, DiscoverStockByIds' policy): every selling role, Root and the
// Administrator — never a warehouse role (Discover serves no warehouse; a warehouse sees no seller's ledger through it).
// team_id is the scope. A READ: marked side-effect free, so the admin team's monitor and an agent's credential may call it.
func TestDiscoverStockHistory_PolicyIsDiscovers(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.DiscoverStockHistoryRequest"))
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	md := desc.(protoreflect.MessageDescriptor)

	policy := san_auth.PolicyOf(md)
	if policy == nil {
		t.Fatalf("DiscoverStockHistoryRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}

	got := slices.Clone(policy.GetRoles())
	slices.Sort(got)
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Fatalf("policy roles = %v, want exactly %v", got, want)
	}

	scope, ok := san_auth.ScopeOf(&inventoryv1.DiscoverStockHistoryRequest{TeamId: 12})
	if !ok || scope != 12 {
		t.Fatalf("scope = %d (%v), want team_id 12", scope, ok)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.InventoryService.DiscoverStockHistory"))
	if err != nil {
		t.Fatalf("method: %v", err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("DiscoverStockHistory is not marked a read")
	}

}
