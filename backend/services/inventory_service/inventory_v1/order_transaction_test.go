package inventory_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// AN ORDER'S TAKE ON THE DECIDED LEDGERS (docs/business/inventory/order.md §Inventory Service Flow When Order Created
// Called Our `OrderTransactionCreate`), and its release by the key.

const (
	otMelati    uint64 = 2
	otSinar     uint64 = 3
	otWarehouse uint64 = 5

	otKaosHitam  uint64 = 701 // Melati's own
	otKaosPolos  uint64 = 702 // Sinar's, 10% markup
	otKaosMerah  uint64 = 703 // Sinar's, private
	otKaosBiru   uint64 = 704 // Sinar's, reserve 10
	otKaosKuning uint64 = 705 // nobody's
)

type fakeFacts map[uint64]inventory_v1.ProductFact

func (f fakeFacts) Facts(_ context.Context, _ uint64, ids []uint64) (map[uint64]inventory_v1.ProductFact, error) {
	out := make(map[uint64]inventory_v1.ProductFact, len(ids))

	for _, id := range ids {
		if fact, ok := f[id]; ok {
			out[id] = fact
		}
	}

	return out, nil
}

func otFacts() fakeFacts {
	return fakeFacts{
		otKaosHitam: {TeamID: otMelati},
		otKaosPolos: {TeamID: otSinar, CrossMarkupBps: 1000},
		otKaosMerah: {TeamID: otSinar, Private: true},
		otKaosBiru:  {TeamID: otSinar, ReservedStock: 10},
	}
}

// otStocked builds the service and stocks Gudang 5: Melati's Kaos Hitam 10 at 10.000 on one rack; Sinar's Kaos Polos 5
// at 20.000 split 2 on Rak A and 3 on Rak B; Kaos Merah 5 and Kaos Biru 8 (below its reserve of 10).
func otStocked(t *testing.T) (*inventory_v1.Service, *gorm.DB, uint64, uint64) {
	t.Helper()

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts())

	rakA := newRack(t, svc, otWarehouse, "rak-a")
	rakB := newRack(t, svc, otWarehouse, "rak-b")

	otRestock(t, svc, otMelati, otKaosHitam, 10, 100000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 10}})
	otRestock(t, svc, otSinar, otKaosPolos, 5, 100000, []*inventoryv1.RestockPlacement{
		{PlacementId: rakA, Quantity: 2}, {PlacementId: rakB, Quantity: 3},
	})
	otRestock(t, svc, otSinar, otKaosMerah, 5, 50000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 5}})
	otRestock(t, svc, otSinar, otKaosBiru, 8, 80000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 8}})

	return svc, db, rakA, rakB
}

func otRestock(t *testing.T, svc *inventory_v1.Service, team, product uint64, count, total int64, placements []*inventoryv1.RestockPlacement) {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: otWarehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, Sku: "SKU", Name: "Kaos", Count: count, Total: float64(total)}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: otWarehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: r.GetItems()[0].GetId(), ReceivedCount: count, Placements: placements},
		},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}
}

func take(svc *inventory_v1.Service, key string, lines ...*inventoryv1.OrderTransactionLine) (*inventoryv1.OrderTransactionCreateResponse, error) {
	res, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: key, WarehouseId: otWarehouse, Lines: lines,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func line(product uint64, qty int64) *inventoryv1.OrderTransactionLine {
	return &inventoryv1.OrderTransactionLine{ProductId: product, Quantity: qty}
}

func refusalOf(t *testing.T, err error) *inventoryv1.OrderTransactionRefusal {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("err = %v, want a Connect error", err)
	}

	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}

		if r, ok := value.(*inventoryv1.OrderTransactionRefusal); ok {
			return r
		}
	}

	t.Fatalf("err %v carries no OrderTransactionRefusal", err)

	return nil
}

func countTransactions(db *gorm.DB, txType models.TxType) int64 {
	var n int64
	db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", txType).Count(&n)

	return n
}

// Melati's own Kaos Hitam and Sinar's Kaos Polos in ONE order transaction of Melati: each line names its owner, the
// borrowed one carries Sinar's 10% markup, the own one none, and both invariants hold.
func TestOrderTransactionCreate_TakesOwnAndBorrowedInOneTransaction(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	res, err := take(svc, "K-1", line(otKaosHitam, 3), line(otKaosPolos, 2))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	var tx models.InventoryTransaction
	db.First(&tx, res.GetTransactionId())

	if tx.TxType != models.TxOrder || tx.TeamID != otMelati {
		t.Fatalf("transaction = %+v, want an order of the ordering team %d", tx, otMelati)
	}

	if len(res.GetItems()) != 2 {
		t.Fatalf("items = %d, want 2", len(res.GetItems()))
	}

	hitam, polos := res.GetItems()[0], res.GetItems()[1]

	if hitam.GetOwnerTeamId() != otMelati || !san_money.Equal(hitam.GetUnitCost(), 10000) || !san_money.Equal(hitam.GetMarkupTotal(), 0) {
		t.Fatalf("Kaos Hitam = %+v, want Melati's at 10000 with no markup", hitam)
	}

	if polos.GetOwnerTeamId() != otSinar || !san_money.Equal(polos.GetUnitCost(), 20000) ||
		!san_money.Equal(polos.GetUnitCostWithMarkup(), 22000) || !san_money.Equal(polos.GetTotal(), 44000) ||
		!san_money.Equal(polos.GetMarkupTotal(), 4000) {
		t.Fatalf("Kaos Polos = %+v, want Sinar's at 20000, 22000 with markup, total 44000", polos)
	}

	if !san_money.Equal(res.GetTotal(), 30000+44000) {
		t.Fatalf("total = %v, want 74000", res.GetTotal())
	}

	err = inventory_ledgers.Verify(db, res.GetTransactionId())
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	// Kaos Polos sat 2 on Rak A and 3 on Rak B: the rack holding the fewest, Rak A, gave both.
	var polosLogs []models.ProductPlacementLog
	db.Where("transaction_id = ? AND product_id = ?", res.GetTransactionId(), otKaosPolos).Find(&polosLogs)
	if len(polosLogs) != 1 || polosLogs[0].StockChange != -2 || polosLogs[0].StockAfter != 0 {
		t.Fatalf("Kaos Polos rack rows = %+v, want Rak A -2 to 0", polosLogs)
	}
}

// The take's round trips do not grow with its lines (ledger-writes-are-set-based): one line, or two with the second
// split over two racks, costs the same statements. The audit's N+1, pinned at the RPC.
func TestOrderTransactionCreate_TheStatementsDoNotGrowWithTheLines(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts())

	rakA := newRack(t, svc, otWarehouse, "rak-a")
	rakB := newRack(t, svc, otWarehouse, "rak-b")

	otRestock(t, svc, otMelati, otKaosHitam, 10, 100000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 10}})
	otRestock(t, svc, otSinar, otKaosPolos, 5, 100000, []*inventoryv1.RestockPlacement{
		{PlacementId: rakA, Quantity: 2}, {PlacementId: rakB, Quantity: 3},
	})

	probe.Reset()

	_, err := take(svc, "K-1", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("one-line take: %v", err)
	}

	one := probe.Count()
	probe.Reset()

	res, err := take(svc, "K-2", line(otKaosHitam, 1), line(otKaosPolos, 3))
	if err != nil {
		t.Fatalf("two-line take: %v", err)
	}

	two := probe.Count()

	if one != two {
		t.Fatalf("a one-line take cost %d statements and a two-line one %d, want the same", one, two)
	}

	err = inventory_ledgers.Verify(db, res.GetTransactionId())
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// A used key is refused, never answered with the earlier take (a-used-key-is-refused-first).
func TestOrderTransactionCreate_AUsedKeyIsRefused(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	_, err := take(svc, "K-1", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("first take: %v", err)
	}

	_, err = take(svc, "K-1", line(otKaosHitam, 1))
	if connect.CodeOf(err) != connect.CodeAlreadyExists ||
		refusalOf(t, err).GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED {
		t.Fatalf("second take with K-1: err = %v, want AlreadyExists, KEY_USED", err)
	}

	if n := countTransactions(db, models.TxOrder); n != 1 {
		t.Fatalf("%d order transactions, want 1", n)
	}
}

// A borrowed private product, one below its reserve, and one that exists nowhere: ONE refusal naming all three, and
// nothing written — the own line beside them does not slip through.
func TestOrderTransactionCreate_NotAllowedNamesEveryRefusedLine(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	_, err := take(svc, "K-1", line(otKaosHitam, 1), line(otKaosMerah, 1), line(otKaosBiru, 1), line(otKaosKuning, 1))

	r := refusalOf(t, err)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition ||
		r.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ALLOWED {
		t.Fatalf("err = %v, want FailedPrecondition, NOT_ALLOWED", err)
	}

	named := map[uint64]bool{}
	for _, l := range r.GetLines() {
		named[l.GetProductId()] = true
	}

	if len(named) != 3 || !named[otKaosMerah] || !named[otKaosBiru] || !named[otKaosKuning] {
		t.Fatalf("refused lines = %+v, want Kaos Merah, Kaos Biru and Kaos Kuning", r.GetLines())
	}

	if n := countTransactions(db, models.TxOrder); n != 0 {
		t.Fatalf("a refused take wrote %d order transactions", n)
	}
}

// Two lines short: ONE refusal naming both, each with what it wanted and what the warehouse holds; nothing written.
func TestOrderTransactionCreate_NotEnoughStockNamesEveryShortLine(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	_, err := take(svc, "K-1", line(otKaosHitam, 11), line(otKaosPolos, 6))

	r := refusalOf(t, err)
	if r.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ENOUGH_STOCK || len(r.GetLines()) != 2 {
		t.Fatalf("refusal = %+v, want NOT_ENOUGH_STOCK naming both lines", r)
	}

	for _, l := range r.GetLines() {
		want := map[uint64]int64{otKaosHitam: 10, otKaosPolos: 5}[l.GetProductId()]
		if l.GetAvailable() != want {
			t.Fatalf("line %d: available %d, want %d", l.GetProductId(), l.GetAvailable(), want)
		}
	}

	if n := countTransactions(db, models.TxOrder); n != 0 {
		t.Fatalf("a refused take wrote %d order transactions", n)
	}
}

func release(svc *inventory_v1.Service, team uint64, key string) (*inventoryv1.OrderTransactionReleaseResponse, error) {
	res, err := svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: team, IdempotencyKey: key,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// A release rolls the take back once: every batch and rack gets back exactly what it gave, and a second release does
// nothing (an-undo-rolls-the-transaction-back-once).
func TestOrderTransactionRelease_RollsTheTakeBackOnce(t *testing.T) {
	svc, db, rakA, _ := otStocked(t)

	res, err := take(svc, "K-1", line(otKaosHitam, 10))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	first, err := release(svc, otMelati, "K-1")
	if err != nil || !first.GetReleased() || first.GetTransactionId() != res.GetTransactionId() {
		t.Fatalf("first release = %+v, %v — want released transaction %d", first, err, res.GetTransactionId())
	}

	var batch models.Batch
	db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&batch)
	if batch.StockCount != 10 || !san_money.Equal(batch.StockValuation, 100000) {
		t.Fatalf("batch after release holds %d worth %v, want all 10 worth 100000 back", batch.StockCount, batch.StockValuation)
	}

	var rack models.ProductPlacement
	db.Where("product_id = ? AND placement_id = ?", otKaosHitam, rakA).First(&rack)
	if rack.StockCount != 10 {
		t.Fatalf("Rak A holds %d after release, want 10", rack.StockCount)
	}

	second, err := release(svc, otMelati, "K-1")
	if err != nil || second.GetReleased() {
		t.Fatalf("second release = %+v, %v — want nothing rolled back", second, err)
	}
}

// A release that arrives before the take claims the key with none, so the late take is refused as a used key.
func TestOrderTransactionRelease_BeforeTheTakeRefusesTheLateTake(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	res, err := release(svc, otMelati, "K-early")
	if err != nil || res.GetReleased() || res.GetTransactionId() != 0 {
		t.Fatalf("early release = %+v, %v — want nothing to release", res, err)
	}

	_, err = take(svc, "K-early", line(otKaosHitam, 1))
	if refusalOf(t, err).GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED {
		t.Fatalf("late take: err = %v, want KEY_USED", err)
	}

	if n := countTransactions(db, models.TxOrder); n != 0 {
		t.Fatalf("the late take wrote %d order transactions", n)
	}
}

// The key alone never lets another team release an order: Sinar releasing Melati's K reads NotFound.
func TestOrderTransactionRelease_AnotherTeamReadsNotFound(t *testing.T) {
	svc, _, _, _ := otStocked(t)

	_, err := take(svc, "K-1", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	_, err = release(svc, otSinar, "K-1")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("Sinar releasing Melati's order: err = %v, want NotFound", err)
	}
}
