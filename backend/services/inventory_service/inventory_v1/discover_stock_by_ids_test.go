package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// DISCOVER'S CARD FIGURES (a-discover-card-shows-its-stock, discover-shows-the-cross-price,
// discovers-warehouse-keeps-ready-stock-there, a-discover-card-says-locked-as-the-title-does).
//
//	product              owner, markup     Gudang 61                         Gudang 62          on its way
//	Kaos Hijau (A)       Melati, 10%       4 @ 8.000 (emptied by a take)     5 @ 12.000         —
//	                                       10 @ 10.000
//	Kaos Biru (B)        Sinar, none       —                                 —                  7 to Gudang 62
//	Kaos Abu (C)         nobody            —                                 —                  —
//
// The caller is Sinar — another team than Kaos Hijau's owner — so what it reads of Kaos Hijau is the cross price, never
// the 8.000, 10.000 or 12.000 Melati paid.
const (
	dsMelati  uint64 = 2
	dsSinar   uint64 = 3
	dsGudang1 uint64 = 61
	dsGudang2 uint64 = 62

	dsKaosHijau uint64 = 811
	dsKaosBiru  uint64 = 812
	dsKaosAbu   uint64 = 813
)

func dsService(t *testing.T) *inventory_v1.Service {
	t.Helper()

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, fakeFacts{
		dsKaosHijau: {TeamID: dsMelati, CrossMarkupBps: 1000},
		dsKaosBiru:  {TeamID: dsSinar},
	}, nil, nil)

	rak1 := newRack(t, svc, dsGudang1, "ds-rak-1")
	rak2 := newRack(t, svc, dsGudang2, "ds-rak-2")

	// The oldest first, so the take below empties it.
	dsRestock(t, svc, dsMelati, dsGudang1, rak1, dsKaosHijau, 4, 32_000, true)
	dsRestock(t, svc, dsMelati, dsGudang1, rak1, dsKaosHijau, 10, 100_000, true)
	dsRestock(t, svc, dsMelati, dsGudang2, rak2, dsKaosHijau, 5, 60_000, true)
	// Raised, not accepted: on its way.
	dsRestock(t, svc, dsSinar, dsGudang2, rak2, dsKaosBiru, 7, 70_000, false)

	// Melati sells 4 from Gudang 61: the 8.000 batch, oldest, is emptied.
	_, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: dsMelati, IdempotencyKey: "key-ds-1", WarehouseId: dsGudang1,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: dsKaosHijau, Quantity: 4}},
	}))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	return svc
}

func dsRestock(
	t *testing.T,
	svc *inventory_v1.Service,
	team, warehouse, rack, product uint64,
	count int64,
	total float64,
	accept bool,
) {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, ProductCode: "SKU", Name: "Kaos", Count: count, Total: total}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	if !accept {
		return
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: count}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}
}

func dsRead(t *testing.T, svc *inventory_v1.Service, warehouse uint64) []*inventoryv1.DiscoverStockItem {
	t.Helper()

	res, err := svc.DiscoverStockByIds(ctxUser(9), connect.NewRequest(&inventoryv1.DiscoverStockByIdsRequest{
		TeamId: dsSinar, ProductIds: []uint64{dsKaosAbu, dsKaosHijau, dsKaosBiru}, WarehouseId: warehouse,
	}))
	if err != nil {
		t.Fatalf("DiscoverStockByIds(warehouse %d): %v", warehouse, err)
	}

	return res.Msg.GetItems()
}

type dsWant struct {
	ready, ongoing, total int64
	known                 bool
	min, max              float64
}

func dsCheck(t *testing.T, label string, got *inventoryv1.DiscoverStockItem, want dsWant) {
	t.Helper()

	if got.GetReadyQty() != want.ready || got.GetOngoingQty() != want.ongoing || got.GetTotalReadyQty() != want.total ||
		got.GetCrossKnown() != want.known ||
		!san_money.Equal(got.GetCrossMin(), want.min) || !san_money.Equal(got.GetCrossMax(), want.max) {
		t.Fatalf("%s: ready %d ongoing %d total %d cross %v %v–%v, want %+v", label,
			got.GetReadyQty(), got.GetOngoingQty(), got.GetTotalReadyQty(),
			got.GetCrossKnown(), got.GetCrossMin(), got.GetCrossMax(), want)
	}
}

// EVERY WAREHOUSE: ready summed over both buildings, the cross range over the batches still holding units (the emptied
// 8.000 batch is not stock and is not priced), one row per id asked, in the order asked — an unknown product too.
func TestDiscoverStockByIds_EveryWarehouse(t *testing.T) {
	svc := dsService(t)
	items := dsRead(t, svc, 0)

	if len(items) != 3 || items[0].GetProductId() != dsKaosAbu || items[1].GetProductId() != dsKaosHijau ||
		items[2].GetProductId() != dsKaosBiru {
		t.Fatalf("items %v, want one per id asked, in the order asked", items)
	}

	dsCheck(t, "Kaos Abu — nobody's", items[0], dsWant{})
	// 10 × 10.000 and 5 × 12.000 with 10% on top: 11.000 – 13.200. Never 8.800: that batch is empty.
	dsCheck(t, "Kaos Hijau", items[1], dsWant{ready: 15, total: 15, known: true, min: 11_000, max: 13_200})
	dsCheck(t, "Kaos Biru — on its way only", items[2], dsWant{ongoing: 7})
}

// ONE WAREHOUSE: ready, on its way and the cross range read that building alone; the total the lock badge reads stays
// every warehouse's.
func TestDiscoverStockByIds_OneWarehouse(t *testing.T) {
	svc := dsService(t)

	g1 := dsRead(t, svc, dsGudang1)
	dsCheck(t, "Kaos Hijau in Gudang 61", g1[1], dsWant{ready: 10, total: 15, known: true, min: 11_000, max: 11_000})
	dsCheck(t, "Kaos Biru in Gudang 61 — bound elsewhere", g1[2], dsWant{})

	g2 := dsRead(t, svc, dsGudang2)
	dsCheck(t, "Kaos Hijau in Gudang 62", g2[1], dsWant{ready: 5, total: 15, known: true, min: 13_200, max: 13_200})
	dsCheck(t, "Kaos Biru in Gudang 62", g2[2], dsWant{ongoing: 7})

	// A building holding none of it: no price, but the lock's total is still every warehouse's.
	none := dsRead(t, svc, 99)
	dsCheck(t, "Kaos Hijau in a building holding none", none[1], dsWant{total: 15})
}

// AN EMPTIED BATCH is not stock: emptied to the last unit, a product reads 0 ready and no price — not the price of
// what left.
func TestDiscoverStockByIds_AnEmptiedProductHasNoPrice(t *testing.T) {
	svc := dsService(t)

	_, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: dsMelati, IdempotencyKey: "key-ds-2", WarehouseId: dsGudang2,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: dsKaosHijau, Quantity: 5}},
	}))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	g2 := dsRead(t, svc, dsGudang2)
	dsCheck(t, "Kaos Hijau in Gudang 62, emptied", g2[1], dsWant{ready: 0, total: 10})

	all := dsRead(t, svc, 0)
	dsCheck(t, "Kaos Hijau everywhere", all[1], dsWant{ready: 10, total: 10, known: true, min: 11_000, max: 11_000})
}

// ANOTHER TEAM'S COST IS NEVER IN THE ANSWER: not as a field — the message has none — and not as a value. Every number
// Sinar reads of Melati's product is checked against the three unit costs Melati paid.
func TestDiscoverStockByIds_NeverSendsAnotherTeamsCost(t *testing.T) {
	svc := dsService(t)
	costs := []float64{8_000, 10_000, 12_000}

	fields := (&inventoryv1.DiscoverStockItem{}).ProtoReflect().Descriptor().Fields()
	for i := range fields.Len() {
		name := string(fields.Get(i).Name())
		if name != "cross_min" && name != "cross_max" && fields.Get(i).Kind() == protoreflect.DoubleKind {
			t.Fatalf("DiscoverStockItem carries money field %q — only the cross price may leave", name)
		}
	}

	for _, warehouse := range []uint64{0, dsGudang1, dsGudang2} {
		item := dsRead(t, svc, warehouse)[1]

		item.ProtoReflect().Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
			if fd.Kind() != protoreflect.DoubleKind {
				return true
			}

			for _, cost := range costs {
				if san_money.Equal(v.Float(), cost) {
					t.Fatalf("warehouse %d: %s = %v — Melati's own unit cost, sent to Sinar", warehouse, fd.Name(), v.Float())
				}
			}

			return true
		})
	}
}
