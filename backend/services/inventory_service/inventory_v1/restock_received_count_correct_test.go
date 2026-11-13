package inventory_v1_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// KOREKSI JUMLAH TERIMA ON A RESTOCK (adjustment_decision.md — the-warehouse-corrects-a-wrong-stock-in-alone,
// a-stock-in-correction-keeps-the-batch-price, a-wrong-stock-in-is-a-received-count-correction,
// the-received-count-prototype-is-accepted, a-received-count-correction-counts-on-its-own-day). The fixture is the
// ledger test's restock (team 2 → Gudang 5, supplier 61 on both lines), accepted TWO DAYS AGO with Rp 3.000 freight:
//
//	Kaos Hitam   10 ordered for Rp 100.000 · 10 in the box, 1 broken → 9 good at 10.200 on Rak A
//	Kaos Polos    5 ordered for Rp 60.000  ·  4 in the box (1 missing) → 4 good at 12.200 on Rak B
//
// Every correction below is made TODAY by the warehouse's Owner (user 70), unless it says otherwise.

const (
	rcOwner    uint64 = 70
	rcSupplier uint64 = 61
	rcReason          = "Salah ketik saat terima — dus berisi 8"
)

type rcFixture struct {
	db               *gorm.DB
	svc              *inventory_v1.Service
	sender           *recordingSender
	rakA, rakB, rakC uint64
	restock          *inventoryv1.RestockRequest
	hitam, polos     *inventoryv1.RestockRequestItem
}

func rcFacts() fakeFacts {
	return fakeFacts{
		ledgerKaosHitam: {TeamID: ledgerSellingTeam, ProductCode: "KH", Name: "Kaos Hitam"},
		ledgerKaosPolos: {TeamID: ledgerSellingTeam, ProductCode: "KP", Name: "Kaos Polos"},
	}
}

func rcAccepted(t *testing.T) *rcFixture {
	t.Helper()

	db := san_testdb.DB(t)
	f := &rcFixture{db: db, sender: &recordingSender{}}
	f.svc = inventory_v1.NewService(db, nil, nil, nil, f.sender.send, rcFacts(), nil, nil)

	f.rakA = newRack(t, f.svc, ledgerWarehouse, "rak-a")
	f.rakB = newRack(t, f.svc, ledgerWarehouse, "rak-b")
	f.rakC = newRack(t, f.svc, ledgerWarehouse, "rak-c")

	f.restock = ledgerRestock(t, f.svc, 3000)
	f.hitam = itemFor(f.restock, ledgerKaosHitam)
	f.polos = itemFor(f.restock, ledgerKaosPolos)

	err := db.Exec(`UPDATE restock_items SET supplier_id = ? WHERE restock_id = ?`, rcSupplier, f.restock.GetId()).Error
	if err != nil {
		t.Fatalf("name the supplier: %v", err)
	}

	_, err = f.svc.RestockRequestAccept(on(ctxUser(7), 2), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: f.restock.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: f.hitam.GetId(), ReceivedCount: 10, BrokenCount: 1, Placements: placedOn(f.rakA, 9)},
			{ItemId: f.polos.GetId(), ReceivedCount: 4, Placements: placedOn(f.rakB, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("accept 2 days ago: %v", err)
	}

	f.sender.sent = nil

	return f
}

// asWarehouseOwner is the receiving warehouse's Owner, as the interceptor leaves the request.
func asWarehouseOwner() context.Context {
	return ctxAs(rcOwner, ledgerWarehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
}

func rcLine(item *inventoryv1.RestockRequestItem, expected, real int64, rack uint64) *inventoryv1.ReceivedCountLine {
	return &inventoryv1.ReceivedCountLine{
		ItemId: item.GetId(), ExpectedReceivedCount: expected, ReceivedCount: real, PlacementId: rack,
	}
}

func (f *rcFixture) correct(
	ctx context.Context,
	lines ...*inventoryv1.ReceivedCountLine,
) (*inventoryv1.RestockRequest, error) {
	res, err := f.svc.RestockReceivedCountCorrect(ctx, connect.NewRequest(&inventoryv1.RestockReceivedCountCorrectRequest{
		TeamId: ledgerWarehouse, RequestId: f.restock.GetId(), Reason: rcReason, Lines: lines,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRequest(), nil
}

func (f *rcFixture) mustCorrect(t *testing.T, ctx context.Context, lines ...*inventoryv1.ReceivedCountLine) *inventoryv1.RestockRequest {
	t.Helper()

	got, err := f.correct(ctx, lines...)
	if err != nil {
		t.Fatalf("correct: %v", err)
	}

	return got
}

func (f *rcFixture) detail(t *testing.T, team uint64) *inventoryv1.RestockRequest {
	t.Helper()

	res, err := f.svc.RestockRequestDetail(context.Background(), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: team, RequestId: f.restock.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail as team %d: %v", team, err)
	}

	return res.Msg.GetRequest()
}

// productBatches is a product's batches in Gudang 5, oldest first.
func productBatches(t *testing.T, db *gorm.DB, product uint64) []models.Batch {
	t.Helper()

	var out []models.Batch

	err := db.Where("warehouse_id = ? AND product_id = ?", ledgerWarehouse, product).Order("id").Find(&out).Error
	if err != nil {
		t.Fatalf("batches of %d: %v", product, err)
	}

	return out
}

func rackUnits(t *testing.T, db *gorm.DB, product, rack uint64) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE product_id = ? AND placement_id = ?`,
		product, rack).Scan(&n).Error
	if err != nil {
		t.Fatalf("rack units: %v", err)
	}

	return n
}

// doorOn is the restock door's broken and missing of a product on a day.
func doorOn(t *testing.T, db *gorm.DB, day string, product uint64) (int64, int64) {
	t.Helper()

	var row struct {
		Broken  int64
		Missing int64
	}

	err := db.Raw(`SELECT COALESCE(SUM(broken_count), 0) AS broken, COALESCE(SUM(missing_count), 0) AS missing
		FROM inventory_door_daily_reports WHERE day = CAST(? AS date) AND product_id = ? AND source = 'restock'`,
		day, product).Scan(&row).Error
	if err != nil {
		t.Fatalf("door: %v", err)
	}

	return row.Broken, row.Missing
}

func countCorrectionRows(t *testing.T, db *gorm.DB) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT
		(SELECT COUNT(*) FROM restock_count_corrections) + (SELECT COUNT(*) FROM warehouse_transfer_count_corrections)`).
		Scan(&n).Error
	if err != nil {
		t.Fatalf("count corrections: %v", err)
	}

	return n
}

func wireItem(r *inventoryv1.RestockRequest, product uint64) *inventoryv1.RestockRequestItem {
	return itemFor(r, product)
}

// TOO MANY TYPED — 10 → 8 on Kaos Hitam: the 2 phantom units leave its batch at 10.200 and Rak A, they are MISSING at
// the door (koreksi) TODAY, the Restock metric reads accepted −2 / −Rp 20.400 and missing +2 TODAY while the accept's
// day stays as it was, the supplier hears it, and nothing posts between the teams.
func TestRestockReceivedCountCorrect_TooManyTakesUnitsOutOnTheCorrectionDay(t *testing.T) {
	f := rcAccepted(t)

	got := f.mustCorrect(t, asWarehouseOwner(), rcLine(f.hitam, 10, 8, f.rakA))

	// THE STOCK — the batch and the rack, at the batch's price.
	hitam := productBatches(t, f.db, ledgerKaosHitam)
	if len(hitam) != 1 || hitam[0].StockCount != 7 || !san_money.Equal(hitam[0].StockValuation, 7*10200) ||
		!san_money.Equal(hitam[0].PriceUnit, 10200) {
		t.Fatalf("Kaos Hitam's batches = %+v — want one batch of 7 at 10.200 (worth 71.400)", hitam)
	}

	if n := rackUnits(t, f.db, ledgerKaosHitam, f.rakA); n != 7 {
		t.Fatalf("Rak A holds %d Kaos Hitam, want 7", n)
	}

	// ONE `adjustment` transaction of the OWNING team, not an override; its rows carry the correction's type.
	actor, override := lastTransactionOverride(t, f.db, string(models.TxAdjustment))
	if actor != rcOwner || override {
		t.Fatalf("the adjustment = actor %d override %v, want %d not stamped", actor, override, rcOwner)
	}

	var types []string

	err := f.db.Raw(`SELECT change_type FROM batch_logs WHERE change_type = ? UNION ALL
		SELECT change_type FROM product_placement_logs WHERE change_type = ?`,
		models.ChangeRestockCorrection, models.ChangeRestockCorrection).Scan(&types).Error
	if err != nil || len(types) != 2 {
		t.Fatalf("correction log rows = %v (%v) — want one batch row and one rack row", types, err)
	}

	// THE LINE AND ITS HISTORY ROW — the warehouse reads units, never the money.
	line := wireItem(got, ledgerKaosHitam)
	if line.GetReceivedCount() != 8 || line.CorrectedFrom == nil || line.GetCorrectedFrom() != 10 ||
		line.GetMissingByCorrection() != 2 || line.MissingByCorrectionTotal != nil {
		t.Fatalf("the warehouse's line = received %d, from %v, koreksi %d, total set %v — want 8, 10, 2, unset",
			line.GetReceivedCount(), line.CorrectedFrom, line.GetMissingByCorrection(), line.MissingByCorrectionTotal != nil)
	}

	if len(got.GetCountCorrections()) != 1 {
		t.Fatalf("history = %v — want one correction row", got.GetCountCorrections())
	}

	row := got.GetCountCorrections()[0]
	if row.GetFromCount() != 10 || row.GetToCount() != 8 || row.GetUnitsOut() != 2 || row.GetReason() != rcReason ||
		row.GetActorUserId() != rcOwner || row.GetIsOverride() || row.GetBatchId() != hitam[0].ID ||
		row.GetPlacementId() != f.rakA || row.PriceUnit != nil || row.Total != nil {
		t.Fatalf("the warehouse's history row = %+v — want 10 → 8, 2 out of batch %d off Rak A, why, who, no money", row, hitam[0].ID)
	}

	facts := line.GetCorrectionFacts()
	if facts.GetBatchId() != hitam[0].ID || facts.GetBatchHolds() != 7 || len(facts.GetShelves()) != 1 ||
		facts.GetShelves()[0].GetPlacementId() != f.rakA || facts.GetShelves()[0].GetUnits() != 7 {
		t.Fatalf("the form's facts = %+v — want batch %d holding 7, Rak A with 7", facts, hitam[0].ID)
	}

	// No trail row: a correction must never read as the selling team's edit.
	if len(got.GetLogs()) != len(f.detail(t, ledgerSellingTeam).GetLogs()) {
		t.Fatal("the trail differs between the sides")
	}

	for _, l := range got.GetLogs() {
		if l.GetFromStatus() == accepted && l.GetToStatus() == accepted {
			t.Fatalf("a correction wrote a trail row %+v", l)
		}
	}

	// THE SELLING TEAM reads the value it bears: 2 × 10.200, and no form facts.
	seller := wireItem(f.detail(t, ledgerSellingTeam), ledgerKaosHitam)
	if seller.MissingByCorrectionTotal == nil || !san_money.Equal(seller.GetMissingByCorrectionTotal(), 20400) ||
		seller.GetCorrectionFacts() != nil {
		t.Fatalf("the seller's line = total %v, facts %v — want Rp 20.400 and no facts", seller.MissingByCorrectionTotal, seller.GetCorrectionFacts())
	}

	sellerRow := f.detail(t, ledgerSellingTeam).GetCountCorrections()[0]
	if sellerRow.PriceUnit == nil || !san_money.Equal(sellerRow.GetPriceUnit(), 10200) || !san_money.Equal(sellerRow.GetTotal(), 20400) {
		t.Fatalf("the seller's history row = %+v — want 10.200 × 2 = 20.400", sellerRow)
	}

	// THE DOOR — missing +2 TODAY; the accept's day still 1 broken, 0 missing.
	if broken, missingNow := doorOn(t, f.db, dayOf(0), ledgerKaosHitam); broken != 0 || missingNow != 2 {
		t.Fatalf("today's door = %d broken, %d missing — want 0, 2", broken, missingNow)
	}

	if broken, missingThen := doorOn(t, f.db, dayOf(2), ledgerKaosHitam); broken != 1 || missingThen != 0 {
		t.Fatalf("the accept day's door = %d broken, %d missing — want 1, 0 (never re-folded)", broken, missingThen)
	}

	// THE RESTOCK METRIC on the correction's day, signed; the accept's day unchanged.
	byDay := mustRead(t, f.svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(dayOf(2), dayOf(0))).GetRestockByDay().GetItems()
	wantRestock(t, "the accept's day", byDay[dayOf(2)], 13, 140_600, 1, 1)
	wantRestock(t, "the correction's day", byDay[dayOf(0)], -2, -20_400, 0, 2)
	wantRestock(t, "the week", mustRead(t, f.svc, restockSeller, ledgerSellingTeam, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil).GetRestockSummary(), 11, 120_200, 1, 3)

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}

	// THE SUPPLIER'S FIGURES — one event, today, signed, at the line's price.
	if len(f.sender.sent) != 1 {
		t.Fatalf("published %d events, want 1", len(f.sender.sent))
	}

	ev := f.sender.sent[0].GetRestockReceivedCountCorrected()
	if ev == nil || ev.GetCorrectedOn() != dayOf(0) || ev.GetSupplierId() != rcSupplier || ev.GetTeamId() != ledgerSellingTeam ||
		len(ev.GetLines()) != 1 || ev.GetLines()[0].GetAcceptedCount() != -2 || ev.GetLines()[0].GetMissingCount() != 2 ||
		ev.GetLines()[0].GetOrderedCount() != 10 || !san_money.Equal(ev.GetLines()[0].GetTotalPrice(), 100000) {
		t.Fatalf("the event = %+v — want today, supplier 61, Kaos Hitam accepted −2 missing +2 of 10 for Rp 100.000", f.sender.sent[0])
	}

	if !strings.HasPrefix(f.sender.sent[0].GetEventId(), "restock-count-corrected:") {
		t.Fatalf("event id %q", f.sender.sent[0].GetEventId())
	}

	// The day's re-fold source rebuilds the very same event from the stored rows.
	events, err := inventory_v1.RestockCountCorrectionEventsOn(f.db, dayOf(0))
	if err != nil || len(events) != 1 || events[0].GetEventId() != f.sender.sent[0].GetEventId() {
		t.Fatalf("the day's correction events = %v (%v) — want the one sent", events, err)
	}
}

// TOO FEW TYPED — Kaos Polos 4 → 5: the real unit goes into the same batch at 12.200, onto Rak C; missing −1 today and
// accepted +1 / +Rp 12.200 today. The selling team bears Rp 12.200 LESS.
func TestRestockReceivedCountCorrect_TooFewPutsUnitsIntoTheSameBatch(t *testing.T) {
	f := rcAccepted(t)

	got := f.mustCorrect(t, asWarehouseOwner(), rcLine(f.polos, 4, 5, f.rakC))

	polos := productBatches(t, f.db, ledgerKaosPolos)
	if len(polos) != 1 || polos[0].StockCount != 5 || !san_money.Equal(polos[0].StockValuation, 5*12200) {
		t.Fatalf("Kaos Polos's batches = %+v — want one batch of 5 at 12.200", polos)
	}

	if a, c := rackUnits(t, f.db, ledgerKaosPolos, f.rakB), rackUnits(t, f.db, ledgerKaosPolos, f.rakC); a != 4 || c != 1 {
		t.Fatalf("Rak B / Rak C hold %d / %d — want 4 / 1", a, c)
	}

	if line := wireItem(got, ledgerKaosPolos); line.GetReceivedCount() != 5 || line.GetMissingByCorrection() != -1 {
		t.Fatalf("the line = %+v — want 5 received, koreksi −1", line)
	}

	if _, missingNow := doorOn(t, f.db, dayOf(0), ledgerKaosPolos); missingNow != -1 {
		t.Fatalf("today's missing = %d, want −1", missingNow)
	}

	byDay := mustRead(t, f.svc, restockSeller, ledgerSellingTeam, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(dayOf(2), dayOf(0))).GetRestockByDay().GetItems()
	wantRestock(t, "the accept's day", byDay[dayOf(2)], 13, 140_600, 1, 1)
	wantRestock(t, "the correction's day", byDay[dayOf(0)], 1, 12_200, 0, -1)

	seller := wireItem(f.detail(t, ledgerSellingTeam), ledgerKaosPolos)
	if !san_money.Equal(seller.GetMissingByCorrectionTotal(), -12200) {
		t.Fatalf("the seller's koreksi = %v, want −12.200", seller.GetMissingByCorrectionTotal())
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}

	ev := f.sender.sent[0].GetRestockReceivedCountCorrected()
	if ev.GetLines()[0].GetAcceptedCount() != 1 || ev.GetLines()[0].GetMissingCount() != -1 {
		t.Fatalf("the event's line = %+v — want accepted +1, missing −1", ev.GetLines()[0])
	}
}

// A LINE WITH NO GOOD UNIT HAS NO BATCH — Kaos Polos 1 in the box, 1 broken: too few typed mints its batch at the line's
// landed price (no freight: 12.000), and the next correction takes out of THAT batch.
func TestRestockReceivedCountCorrect_ALineWithNoBatchMintsOneAtItsPrice(t *testing.T) {
	db := san_testdb.DB(t)
	f := &rcFixture{db: db, sender: &recordingSender{}}
	f.svc = inventory_v1.NewService(db, nil, nil, nil, f.sender.send, rcFacts(), nil, nil)
	f.rakA = newRack(t, f.svc, ledgerWarehouse, "rak-a")
	f.rakB = newRack(t, f.svc, ledgerWarehouse, "rak-b")

	f.restock = ledgerRestock(t, f.svc, 0)
	f.hitam = itemFor(f.restock, ledgerKaosHitam)
	f.polos = itemFor(f.restock, ledgerKaosPolos)

	_, err := f.svc.RestockRequestAccept(on(ctxUser(7), 1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: f.restock.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: f.hitam.GetId(), ReceivedCount: 10, Placements: placedOn(f.rakA, 10)},
			{ItemId: f.polos.GetId(), ReceivedCount: 1, BrokenCount: 1},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// Units OUT of a line with no batch: there is nothing to take.
	_, err = f.correct(asWarehouseOwner(), rcLine(f.polos, 1, 1, f.rakB))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no change: %v — want InvalidArgument", err)
	}

	f.mustCorrect(t, asWarehouseOwner(), rcLine(f.polos, 1, 3, f.rakB))

	polos := productBatches(t, db, ledgerKaosPolos)
	if len(polos) != 1 || polos[0].StockCount != 2 || !san_money.Equal(polos[0].PriceUnit, 12000) {
		t.Fatalf("Kaos Polos's batches = %+v — want one minted batch of 2 at 12.000", polos)
	}

	got := f.mustCorrect(t, asWarehouseOwner(), rcLine(f.polos, 3, 2, f.rakB))

	polos = productBatches(t, db, ledgerKaosPolos)
	if len(polos) != 1 || polos[0].StockCount != 1 {
		t.Fatalf("after 3 → 2, Kaos Polos's batches = %+v — want the minted batch at 1", polos)
	}

	line := wireItem(got, ledgerKaosPolos)
	if line.GetCorrectedFrom() != 1 || line.GetMissingByCorrection() != -1 || line.GetCorrectionFacts().GetBatchId() != polos[0].ID ||
		line.GetCorrectionFacts().GetBatchHolds() != 1 {
		t.Fatalf("the line = %+v — want from 1 (the accept's), koreksi −2 + 1 = −1, the minted batch holding 1", line)
	}

	if len(got.GetCountCorrections()) != 2 {
		t.Fatalf("history = %d rows, want 2", len(got.GetCountCorrections()))
	}

	if ledgerMatchesReport(t, db) == 0 {
		t.Fatal("the ledger-vs-report check compared nothing")
	}
}

// THE REFUSALS — the accepted form's own (rules.ts) and the server's, each refusing with nothing written.
func TestRestockReceivedCountCorrect_Refusals(t *testing.T) {
	f := rcAccepted(t)

	other := newRack(t, f.svc, 6, "rak-lain")

	cases := []struct {
		name   string
		ctx    context.Context
		team   uint64
		reason string
		lines  []*inventoryv1.ReceivedCountLine
		setup  func(t *testing.T)
		want   connect.Code
		words  string
	}{
		{name: "an empty reason", reason: "   ", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 8, f.rakA)},
			want: connect.CodeInvalidArgument, words: "reason"},
		{name: "a line twice", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 8, f.rakA), rcLine(f.hitam, 10, 9, f.rakA)},
			want: connect.CodeInvalidArgument, words: "once"},
		{name: "a line not on the restock", lines: []*inventoryv1.ReceivedCountLine{{ItemId: 999999, ReceivedCount: 1, PlacementId: f.rakA}},
			want: connect.CodeInvalidArgument, words: "not a line"},
		{name: "a stale form", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 9, 8, f.rakA)},
			want: connect.CodeFailedPrecondition, words: "corrected it first"},
		{name: "no change", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 10, f.rakA)},
			want: connect.CodeInvalidArgument, words: "already reads"},
		{name: "below the broken units", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 0, f.rakA)},
			want: connect.CodeInvalidArgument, words: "at least 1"},
		{name: "more than ordered", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.polos, 4, 6, f.rakB)},
			want: connect.CodeInvalidArgument, words: "Found"},
		{name: "more out than the rack holds", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 8, f.rakB)},
			want: connect.CodeFailedPrecondition, words: "holds only 0"},
		{name: "a rack of another warehouse", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 8, other)},
			want: connect.CodeNotFound},
		{name: "another warehouse's restock", team: 6, ctx: ctxAs(rcOwner, 6, role_basev1.Role_ROLE_WAREHOUSE_OWNER),
			lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 8, f.rakA)}, want: connect.CodeNotFound},
		{name: "more out than the batch holds", lines: []*inventoryv1.ReceivedCountLine{rcLine(f.hitam, 10, 7, f.rakA)},
			setup: func(t *testing.T) {
				// Six of the nine already left (sold) — the batch and the rack hold 3, so 3 out is the most.
				err := f.db.Exec(`UPDATE batches SET stock_count = 2, stock_valuation = 20400 WHERE product_id = ?`, ledgerKaosHitam).Error
				if err != nil {
					t.Fatalf("sell: %v", err)
				}
			},
			want: connect.CodeFailedPrecondition, words: "holds only 2"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.setup != nil {
				c.setup(t)
			}

			ctx, team, reason := c.ctx, c.team, c.reason
			if ctx == nil {
				ctx = asWarehouseOwner()
			}

			if team == 0 {
				team = ledgerWarehouse
			}

			if reason == "" {
				reason = rcReason
			}

			_, err := f.svc.RestockReceivedCountCorrect(ctx, connect.NewRequest(&inventoryv1.RestockReceivedCountCorrectRequest{
				TeamId: team, RequestId: f.restock.GetId(), Reason: reason, Lines: c.lines,
			}))
			if connect.CodeOf(err) != c.want || (c.words != "" && !strings.Contains(err.Error(), c.words)) {
				t.Fatalf("%s: %v — want %s naming %q", c.name, err, c.want, c.words)
			}

			if n := countCorrectionRows(t, f.db); n != 0 {
				t.Fatalf("%s wrote %d correction rows", c.name, n)
			}
		})
	}

	if len(f.sender.sent) != 0 {
		t.Fatalf("a refused correction published %d events", len(f.sender.sent))
	}
}

// NOT ACCEPTED — an ongoing restock's count is the accept's to make, not a correction's.
func TestRestockReceivedCountCorrect_RefusesARestockNotAccepted(t *testing.T) {
	f := rcAccepted(t)
	f.restock = ledgerRestock(t, f.svc, 0)

	_, err := f.correct(asWarehouseOwner(), rcLine(itemFor(f.restock, ledgerKaosHitam), 0, 1, f.rakA))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "accepted") {
		t.Fatalf("an ongoing restock: %v — want FailedPrecondition", err)
	}
}

// A PRODUCT A RUNNING COUNT HOLDS on the rack is refused, naming the count (a-lock-stops-sales-and-cancels-too); off a
// rack nobody counts, the same correction goes through.
func TestRestockReceivedCountCorrect_RefusesAProductACountHolds(t *testing.T) {
	f := rcAccepted(t)

	_, err := f.svc.OpnameSessionCreate(ctxAs(43, ledgerWarehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN),
		connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
			TeamId: ledgerWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, FilterPlacementId: f.rakA,
		}))
	if err != nil {
		t.Fatalf("start a count on Rak A: %v", err)
	}

	_, err = f.correct(asWarehouseOwner(), rcLine(f.hitam, 10, 8, f.rakA))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "being counted") {
		t.Fatalf("Rak A under count: %v — want FailedPrecondition naming the count", err)
	}

	if n := countCorrectionRows(t, f.db); n != 0 {
		t.Fatalf("wrote %d rows", n)
	}

	// Kaos Polos in onto Rak C, which no count holds.
	f.mustCorrect(t, asWarehouseOwner(), rcLine(f.polos, 4, 5, f.rakC))
}

// ROOT FROM OUTSIDE is stamped on the transaction, the correction row and its history row
// (an-override-is-stamped-in-every-service).
func TestRestockReceivedCountCorrect_RootIsStampedAnOverride(t *testing.T) {
	f := rcAccepted(t)

	got := f.mustCorrect(t, ctxAs(ovRoot, ledgerWarehouse, role_basev1.Role_ROLE_UNSPECIFIED), rcLine(f.hitam, 10, 9, f.rakA))

	if _, override := lastTransactionOverride(t, f.db, string(models.TxAdjustment)); !override {
		t.Fatal("Root's correction transaction is not stamped")
	}

	row := got.GetCountCorrections()[0]
	if !row.GetIsOverride() || row.GetActorUserId() != ovRoot {
		t.Fatalf("history row = %+v — want Root, stamped", row)
	}

	if ev := f.sender.sent[0].GetRestockReceivedCountCorrected(); !ev.GetActorIsOverride() || ev.GetActorId() != ovRoot {
		t.Fatalf("the event's actor = %d stamped %v", ev.GetActorId(), ev.GetActorIsOverride())
	}
}

// TWO CORRECTIONS IN A ROW: the second must show the first's count — the old form is stale — and the line keeps the
// ACCEPT's count as its "corrected from", netting the koreksi.
func TestRestockReceivedCountCorrect_ASecondCorrectionReadsTheFirst(t *testing.T) {
	f := rcAccepted(t)

	f.mustCorrect(t, asWarehouseOwner(), rcLine(f.hitam, 10, 8, f.rakA))

	_, err := f.correct(asWarehouseOwner(), rcLine(f.hitam, 10, 9, f.rakA))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("the old form: %v — want FailedPrecondition (stale)", err)
	}

	got := f.mustCorrect(t, asWarehouseOwner(), rcLine(f.hitam, 8, 9, f.rakA))

	line := wireItem(got, ledgerKaosHitam)
	if line.GetReceivedCount() != 9 || line.GetCorrectedFrom() != 10 || line.GetMissingByCorrection() != 1 {
		t.Fatalf("the line = %+v — want 9, from 10, koreksi 1", line)
	}

	if n := len(got.GetCountCorrections()); n != 2 {
		t.Fatalf("history = %d rows, want 2", n)
	}

	if b := productBatches(t, f.db, ledgerKaosHitam); b[0].StockCount != 8 {
		t.Fatalf("the batch holds %d, want 8", b[0].StockCount)
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("compared nothing")
	}
}

// THE BATCH'S HISTORY AND PAGE — the correction is an ADJUST row labelled *Jumlah terima dikoreksi · 10 → 8* with its
// reason, for the warehouse (StockHistory by batch, RackHistory) and the owner (OwnerStockHistory); the batch's summary
// counts the 2 as Hilang, never Terpakai.
func TestRestockReceivedCountCorrect_TheBatchHistoryShowsTheCorrection(t *testing.T) {
	f := rcAccepted(t)

	f.mustCorrect(t, asWarehouseOwner(), rcLine(f.hitam, 10, 8, f.rakA))

	batch := productBatches(t, f.db, ledgerKaosHitam)[0]

	res, err := f.svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: ledgerWarehouse,
		Filter:      &inventoryv1.StockHistoryFilter{ProductId: ledgerKaosHitam, BatchId: batch.ID},
		Page:        page1(),
	}))
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	newest := firstMovement(res.Msg)
	label := newest.GetReceivedCountCorrection()
	if newest.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST || newest.GetDelta() != -2 || label == nil ||
		label.GetFromCount() != 10 || label.GetToCount() != 8 || label.GetReason() != rcReason ||
		label.GetRestockId() != f.restock.GetId() || label.GetTransferId() != 0 {
		t.Fatalf("the batch's newest row = %+v — want ADJUST −2 labelled 10 → 8 with the reason and the restock", newest)
	}

	// The ADJUST filter finds it.
	adjusts, err := f.svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: ledgerWarehouse,
		Filter: &inventoryv1.StockHistoryFilter{
			ProductId: ledgerKaosHitam, Kind: inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST,
		},
		Page: page1(),
	}))
	if err != nil || len(adjusts.Msg.GetIds()) != 1 || firstMovement(adjusts.Msg).GetReceivedCountCorrection() == nil {
		t.Fatalf("the rack history's ADJUST filter = %v (%v) — want the correction's rack row, labelled", adjusts, err)
	}

	owned := ownerHistory(t, f.svc, ledgerSellingTeam, ledgerKaosHitam, ledgerWarehouse)
	if len(owned) == 0 || owned[0].GetReceivedCountCorrection().GetToCount() != 8 || owned[0].GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST {
		t.Fatalf("the owner's newest row = %+v — want the labelled ADJUST", owned)
	}

	detail, err := f.svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{
		TeamId: ledgerWarehouse, BatchId: batch.ID,
	}))
	if err != nil {
		t.Fatalf("batch detail: %v", err)
	}

	b := detail.Msg.GetBatch()
	if b.GetArrived() != 10 || b.GetBroken() != 1 || b.GetLost() != 2 || b.GetReady() != 7 || b.GetUsed() != 0 ||
		!san_money.Equal(detail.Msg.GetLostValue(), 20400) || !san_money.Equal(detail.Msg.GetUsedValue(), 0) {
		t.Fatalf("the batch page = %+v lost %v used %v — want 10 arrived, 1 broken, 2 lost, 7 ready, 0 used, Rp 20.400 lost",
			b, detail.Msg.GetLostValue(), detail.Msg.GetUsedValue())
	}
}

// WHO MAY (the-received-count-prototype-is-accepted): the receiving warehouse's Owner and Admin, Root and the
// Administrator — never Staff, never a selling role. A write: no monitor, no agent.
func TestRestockReceivedCountCorrect_PolicyIsTheWarehousesOwnerAndAdmin(t *testing.T) {
	wantCorrectionPolicy(t, "RestockReceivedCountCorrectRequest", "RestockRequestService.RestockReceivedCountCorrect")
}

func wantCorrectionPolicy(t *testing.T, request, method string) {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1." + request))
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("%s has no policy", request)
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
	}

	got := slices.Clone(policy.GetRoles())
	slices.Sort(got)
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Fatalf("%s roles = %v, want exactly %v", request, got, want)
	}

	m, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1." + method))
	if err != nil {
		t.Fatalf("method: %v", err)
	}

	opts, _ := m.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("%s is marked side-effect free — a monitor or an agent could call it", method)
	}
}

// firstMovement is a StockHistory page's newest row.
func firstMovement(res *inventoryv1.StockHistoryResponse) *inventoryv1.StockMovement {
	if len(res.GetIds()) == 0 {
		return nil
	}

	for _, item := range res.GetItems() {
		if mv := item.GetMovement(); mv != nil {
			return mv.GetMapData()[res.GetIds()[0]]
		}
	}

	return nil
}
