package inventory_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// KOREKSI JUMLAH TERIMA ON A TRANSFER (adjustment_decision.md — the same decisions as the restock's; the ceiling is what
// was SENT). On the transfer fixture, Melati sends 6 Kaos Hitam from Gudang 5 to Gudang 6 — the out-leg draws batch 1
// (2 at 10.000) then batch 2 (4 at 12.000), the two LAYERS — and B accepts it TWO DAYS AGO as 5 in the box onto Rak B1:
// the good units fill the oldest layers, so B mints X1 (2 at 10.000) and X2 (3 at 12.000), and 1 is missing off layer 2.

type tcFixture struct {
	*wtFixture
	transfer *inventoryv1.WarehouseTransfer
	hitam    *inventoryv1.WarehouseTransferItem
}

const tcOwnerB uint64 = 71

func asOwnerOfB() context.Context {
	return ctxAs(tcOwnerB, wtB, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
}

func tcAccepted(t *testing.T, arrived, broken int64) *tcFixture {
	t.Helper()

	f := &tcFixture{wtFixture: wtStocked(t)}
	f.transfer = f.create(t, wtLine(wtKaosHitam, 6))
	f.ship(t, f.transfer.GetId())
	f.hitam = itemOf(t, f.transfer, wtKaosHitam)

	_, err := f.svc.WarehouseTransferAccept(on(ctxUser(wtStaffB), 2), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: wtB, TransferId: f.transfer.GetId(), Lines: []*inventoryv1.WarehouseTransferCountedLine{
			counted(f.hitam, arrived, broken, f.rakB1),
		},
	}))
	if err != nil {
		t.Fatalf("accept 2 days ago: %v", err)
	}

	// Only what a correction publishes is asserted on — nothing.
	f.sent.events = nil

	return f
}

func (f *tcFixture) correct(ctx context.Context, expected, real int64, rack uint64) (*inventoryv1.WarehouseTransfer, error) {
	res, err := f.svc.WarehouseTransferReceivedCountCorrect(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferReceivedCountCorrectRequest{
		TeamId: wtB, TransferId: f.transfer.GetId(), Reason: rcReason,
		Lines: []*inventoryv1.ReceivedCountLine{{
			ItemId: f.hitam.GetId(), ExpectedReceivedCount: expected, ReceivedCount: real, PlacementId: rack,
		}},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTransfer(), nil
}

func (f *tcFixture) mustCorrect(t *testing.T, expected, real int64, rack uint64) *inventoryv1.WarehouseTransfer {
	t.Helper()

	got, err := f.correct(asOwnerOfB(), expected, real, rack)
	if err != nil {
		t.Fatalf("correct %d → %d: %v", expected, real, err)
	}

	return got
}

func (f *tcFixture) detailAs(t *testing.T, team uint64) *inventoryv1.WarehouseTransfer {
	t.Helper()

	res, err := f.svc.WarehouseTransferDetail(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferDetailRequest{
		TeamId: team, TransferId: f.transfer.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail as %d: %v", team, err)
	}

	return res.Msg.GetTransfer()
}

// bBatches is Kaos Hitam's batches at B, oldest first: id → units.
func bBatches(t *testing.T, f *tcFixture) []models.Batch {
	t.Helper()

	var out []models.Batch

	err := f.db.Where("warehouse_id = ? AND product_id = ?", wtB, wtKaosHitam).Order("id").Find(&out).Error
	if err != nil {
		t.Fatalf("B's batches: %v", err)
	}

	return out
}

// TOO MANY TYPED, then more: 5 → 3 takes 2 out of the NEWEST good layer's batch (X2, 12.000); 3 → 1 then takes X2's
// last and one of X1's — two batches, one history row. The Transfer metric's received moves on the correction's day,
// signed; the accept's day stays.
func TestWarehouseTransferReceivedCountCorrect_TooManyLeavesTheNewestLayersFirst(t *testing.T) {
	f := tcAccepted(t, 5, 0)

	got := f.mustCorrect(t, 5, 3, f.rakB1)

	b := bBatches(t, f)
	if len(b) != 2 || b[0].StockCount != 2 || b[1].StockCount != 1 || !san_money.Equal(b[1].PriceUnit, 12000) {
		t.Fatalf("B's batches = %+v — want X1 2 (10.000), X2 1 (12.000)", b)
	}

	line := itemOf(t, got, wtKaosHitam)
	if line.GetArrivedCount() != 3 || line.GetCorrectedFrom() != 5 || line.GetMissingByCorrection() != 2 ||
		line.MissingByCorrectionTotal != nil {
		t.Fatalf("B's line = %+v — want 3 arrived, from 5, koreksi 2, no money", line)
	}

	facts := line.GetCorrectionFacts()
	if facts.GetBatchId() != b[1].ID || facts.GetBatchHolds() != 3 || len(facts.GetShelves()) != 1 || facts.GetShelves()[0].GetUnits() != 3 {
		t.Fatalf("B's form facts = %+v — want X2 first, 3 out at most (X2's 1, X1's 2), Rak B1 with 3", facts)
	}

	byDay := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(dayOf(2), dayOf(0))).GetTransferByDay().GetItems()
	if d := byDay[dayOf(2)]; d.GetReceivedCount() != 5 || !san_money.Equal(d.GetReceivedValue(), 56_000) {
		t.Fatalf("the accept's day = received %d (Rp %v), want 5 (Rp 56.000) — never re-folded", d.GetReceivedCount(), d.GetReceivedValue())
	}

	if d := byDay[dayOf(0)]; d.GetReceivedCount() != -2 || !san_money.Equal(d.GetReceivedValue(), -24_000) {
		t.Fatalf("the correction's day = received %d (Rp %v), want −2 (−Rp 24.000)", d.GetReceivedCount(), d.GetReceivedValue())
	}

	got = f.mustCorrect(t, 3, 1, f.rakB1)

	b = bBatches(t, f)
	if b[0].StockCount != 1 || b[1].StockCount != 0 {
		t.Fatalf("after 3 → 1, B's batches = %+v — want X1 1, X2 0", b)
	}

	if n := len(got.GetCountCorrections()); n != 2 {
		t.Fatalf("history = %d rows, want 2 (one per correction, the second over two batches)", n)
	}

	second := got.GetCountCorrections()[1]
	if second.GetUnitsOut() != 2 || second.GetBatchId() != b[1].ID || second.GetFromCount() != 3 || second.GetToCount() != 1 {
		t.Fatalf("the second row = %+v — want 3 → 1, 2 out, X2 named first", second)
	}

	// The owning team reads the money: 2 × 12.000, then 12.000 + 10.000.
	owner := f.detailAs(t, otMelati)
	if v := itemOf(t, owner, wtKaosHitam).GetMissingByCorrectionTotal(); !san_money.Equal(v, 46_000) {
		t.Fatalf("the owner's koreksi = %v, want Rp 46.000", v)
	}

	if !san_money.Equal(owner.GetCountCorrections()[1].GetTotal(), 22_000) || itemOf(t, owner, wtKaosHitam).GetCorrectionFacts() != nil {
		t.Fatalf("the owner's second row = %+v — want Rp 22.000 and no form facts", owner.GetCountCorrections()[1])
	}

	// A, the sender, reads neither money nor the form.
	sender := itemOf(t, f.detailAs(t, wtA), wtKaosHitam)
	if sender.MissingByCorrectionTotal != nil || sender.GetCorrectionFacts() != nil || sender.GetMissingByCorrection() != 4 {
		t.Fatalf("A's line = %+v — want koreksi 4, no money, no facts", sender)
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("compared nothing")
	}

	// No event: no supplier figure and no Team Balance reads a transfer door.
	if len(f.sent.events) != 0 {
		t.Fatalf("the corrections published %v", f.sent.events)
	}
}

// TOO FEW TYPED — 5 → 6 puts the unit into layer 2's batch at B (X2, 12.000) onto Rak B2; received +1 today.
func TestWarehouseTransferReceivedCountCorrect_TooFewFillsTheNextLayer(t *testing.T) {
	f := tcAccepted(t, 5, 0)

	f.mustCorrect(t, 5, 6, f.rakB2)

	b := bBatches(t, f)
	if len(b) != 2 || b[0].StockCount != 2 || b[1].StockCount != 4 {
		t.Fatalf("B's batches = %+v — want X1 2, X2 4", b)
	}

	if n := rackUnits(t, f.db, wtKaosHitam, f.rakB2); n != 1 {
		t.Fatalf("Rak B2 holds %d, want 1", n)
	}

	d := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(dayOf(0))).GetTransferByDay().GetItems()[dayOf(0)]
	if d.GetReceivedCount() != 1 || !san_money.Equal(d.GetReceivedValue(), 12_000) {
		t.Fatalf("today = received %d (Rp %v), want +1 (Rp 12.000)", d.GetReceivedCount(), d.GetReceivedValue())
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("compared nothing")
	}
}

// A LAYER WITH NO BATCH AT B — accepted as 2 (layer 2 wholly missing): 2 → 4 mints layer 2's batch at B at ITS price,
// supplier and owner; 4 → 3 then takes out of that minted batch.
func TestWarehouseTransferReceivedCountCorrect_AMissingLayerIsMintedAtItsPrice(t *testing.T) {
	f := tcAccepted(t, 2, 0)

	f.mustCorrect(t, 2, 4, f.rakB2)

	b := bBatches(t, f)
	if len(b) != 2 || b[0].StockCount != 2 || !san_money.Equal(b[0].PriceUnit, 10000) || b[1].StockCount != 2 ||
		!san_money.Equal(b[1].PriceUnit, 12000) || b[1].TeamID != otMelati {
		t.Fatalf("B's batches = %+v — want X1 2 at 10.000 and a minted 2 at 12.000, Melati's", b)
	}

	got := f.mustCorrect(t, 4, 3, f.rakB2)

	b = bBatches(t, f)
	if len(b) != 2 || b[1].StockCount != 1 {
		t.Fatalf("after 4 → 3, B's batches = %+v — want the minted batch at 1", b)
	}

	line := itemOf(t, got, wtKaosHitam)
	if line.GetCorrectedFrom() != 2 || line.GetMissingByCorrection() != -1 || line.GetCorrectionFacts().GetBatchId() != b[1].ID {
		t.Fatalf("the line = %+v — want from 2, koreksi −1, the minted batch first", line)
	}

	if ledgerMatchesReport(t, f.db) == 0 {
		t.Fatal("compared nothing")
	}
}

// THE REFUSALS — the form's and the server's, nothing written.
func TestWarehouseTransferReceivedCountCorrect_Refusals(t *testing.T) {
	f := tcAccepted(t, 5, 1)

	cases := []struct {
		name     string
		ctx      context.Context
		team     uint64
		expected int64
		real     int64
		rack     uint64
		setup    func(t *testing.T)
		want     connect.Code
		words    string
	}{
		{name: "a stale form", expected: 4, real: 3, rack: f.rakB1, want: connect.CodeFailedPrecondition, words: "corrected it first"},
		{name: "no change", expected: 5, real: 5, rack: f.rakB1, want: connect.CodeInvalidArgument, words: "already reads"},
		{name: "below the broken units", expected: 5, real: 0, rack: f.rakB1, want: connect.CodeInvalidArgument, words: "at least 1"},
		{name: "more than sent", expected: 5, real: 7, rack: f.rakB1, want: connect.CodeInvalidArgument, words: "6 sent"},
		{name: "a rack of A", expected: 5, real: 4, rack: f.rakA, want: connect.CodeNotFound},
		{name: "more out than the rack holds", expected: 5, real: 4, rack: f.rakB2, want: connect.CodeFailedPrecondition, words: "holds only 0"},
		{name: "the sender", ctx: ctxAs(tcOwnerB, wtA, role_basev1.Role_ROLE_WAREHOUSE_OWNER), team: wtA, expected: 5, real: 4, rack: f.rakB1,
			want: connect.CodeNotFound},
		{name: "more out than the batch holds", expected: 5, real: 3, rack: f.rakB1,
			setup: func(t *testing.T) {
				// X2 (the newest good layer, 2 good units) has sold one — 1 left, so 2 out cannot leave it.
				err := f.db.Exec(`UPDATE batches SET stock_count = 1, stock_valuation = 12000
					WHERE warehouse_id = ? AND product_id = ? AND price_unit = 12000`, wtB, wtKaosHitam).Error
				if err != nil {
					t.Fatalf("sell: %v", err)
				}
			},
			want: connect.CodeFailedPrecondition, words: "holds only 1"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.setup != nil {
				c.setup(t)
			}

			ctx, team := c.ctx, c.team
			if ctx == nil {
				ctx = asOwnerOfB()
			}

			if team == 0 {
				team = wtB
			}

			_, err := f.svc.WarehouseTransferReceivedCountCorrect(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferReceivedCountCorrectRequest{
				TeamId: team, TransferId: f.transfer.GetId(), Reason: rcReason,
				Lines: []*inventoryv1.ReceivedCountLine{{
					ItemId: f.hitam.GetId(), ExpectedReceivedCount: c.expected, ReceivedCount: c.real, PlacementId: c.rack,
				}},
			}))
			if connect.CodeOf(err) != c.want || (c.words != "" && !strings.Contains(err.Error(), c.words)) {
				t.Fatalf("%s: %v — want %s naming %q", c.name, err, c.want, c.words)
			}

			if n := countCorrectionRows(t, f.db); n != 0 {
				t.Fatalf("%s wrote %d rows", c.name, n)
			}
		})
	}

	// Not accepted: a shipped transfer is still the accept's to count.
	shipped := f.create(t, wtLine(wtKaosPolos, 1))
	f.ship(t, shipped.GetId())

	_, err := f.svc.WarehouseTransferReceivedCountCorrect(asOwnerOfB(), connect.NewRequest(&inventoryv1.WarehouseTransferReceivedCountCorrectRequest{
		TeamId: wtB, TransferId: shipped.GetId(), Reason: rcReason,
		Lines: []*inventoryv1.ReceivedCountLine{{
			ItemId: itemOf(t, shipped, wtKaosPolos).GetId(), ReceivedCount: 1, PlacementId: f.rakB1,
		}},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "accepted") {
		t.Fatalf("a shipped transfer: %v — want FailedPrecondition", err)
	}

	// An empty reason, before anything is locked.
	_, err = f.svc.WarehouseTransferReceivedCountCorrect(asOwnerOfB(), connect.NewRequest(&inventoryv1.WarehouseTransferReceivedCountCorrectRequest{
		TeamId: wtB, TransferId: f.transfer.GetId(), Reason: " ",
		Lines: []*inventoryv1.ReceivedCountLine{{ItemId: f.hitam.GetId(), ExpectedReceivedCount: 5, ReceivedCount: 4, PlacementId: f.rakB1}},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an empty reason: %v — want InvalidArgument", err)
	}
}

// ROOT FROM OUTSIDE is stamped (an-override-is-stamped-in-every-service).
func TestWarehouseTransferReceivedCountCorrect_RootIsStampedAnOverride(t *testing.T) {
	f := tcAccepted(t, 5, 0)

	got, err := f.correct(ctxAs(ovRoot, wtB, role_basev1.Role_ROLE_UNSPECIFIED), 5, 4, f.rakB1)
	if err != nil {
		t.Fatalf("root: %v", err)
	}

	if row := got.GetCountCorrections()[0]; !row.GetIsOverride() || row.GetActorUserId() != ovRoot {
		t.Fatalf("history row = %+v — want Root, stamped", row)
	}

	if _, override := lastTransactionOverride(t, f.db, string(models.TxAdjustment)); !override {
		t.Fatal("the transaction is not stamped")
	}
}

// THE BATCH HISTORY at B labels the correction with the transfer.
func TestWarehouseTransferReceivedCountCorrect_TheBatchHistoryShowsTheCorrection(t *testing.T) {
	f := tcAccepted(t, 5, 0)

	f.mustCorrect(t, 5, 4, f.rakB1)

	x2 := bBatches(t, f)[1]

	res, err := f.svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: wtB,
		Filter:      &inventoryv1.StockHistoryFilter{ProductId: wtKaosHitam, BatchId: x2.ID},
		Page:        page1(),
	}))
	if err != nil {
		t.Fatalf("history: %v", err)
	}

	newest := firstMovement(res.Msg)
	if newest.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST || newest.GetDelta() != -1 ||
		newest.GetReceivedCountCorrection().GetTransferId() != f.transfer.GetId() || newest.GetReceivedCountCorrection().GetFromCount() != 5 {
		t.Fatalf("X2's newest row = %+v — want ADJUST −1 labelled 5 → 4 with the transfer", newest)
	}
}

func TestWarehouseTransferReceivedCountCorrect_PolicyIsTheWarehousesOwnerAndAdmin(t *testing.T) {
	wantCorrectionPolicy(t, "WarehouseTransferReceivedCountCorrectRequest",
		"WarehouseTransferService.WarehouseTransferReceivedCountCorrect")
}
