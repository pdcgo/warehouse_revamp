package inventory_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

const (
	codSellingTeam uint64 = 2
	codWarehouse   uint64 = 5
)

// acceptWithCOD creates a restock request and has the warehouse accept it, paying `codFee` at the
// door. Returns the request id.
func acceptWithCOD(
	t *testing.T,
	svc *inventory_v1.Service,
	codFee int64,
) (uint64, error) {
	t.Helper()

	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: codSellingTeam, WarehouseId: codWarehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId:         codWarehouse,
		RequestId:      reqID,
		CodShippingFee: codFee,
		Lines:          allArrived(created.Msg.GetRequest()),
	}))

	return reqID, err
}

// THE OBLIGATION THAT EXISTS TODAY AND WAS NEVER RECORDED (#184). The warehouse paid the courier at
// the door for goods it does not own, so the requesting team owes it that money.
func TestRestockFulfil_PostsTheCODObligation(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithSettlement(t, db, poster)

	reqID, err := acceptWithCOD(t, svc, 25000)
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	if len(poster.posted) != 1 {
		t.Fatalf("%d obligations posted, want 1", len(poster.posted))
	}

	got := poster.posted[0]
	if got.sellingTeamID != codSellingTeam || got.warehouseID != codWarehouse {
		t.Fatalf("posted %d owes %d, want %d owes %d — the direction is the whole point",
			got.sellingTeamID, got.warehouseID, codSellingTeam, codWarehouse)
	}

	if got.amount != 25000 {
		t.Fatalf("amount = %d, want the 25000 paid at the door", got.amount)
	}

	// Keyed on the RESTOCK REQUEST, which is what makes a retried acceptance idempotent downstream.
	if got.restockRequestID != reqID {
		t.Fatalf("source id = %d, want the request %d", got.restockRequestID, reqID)
	}
}

// ⚠ RECORDING THE OBLIGATION MUST NOT REMOVE THE FEE FROM COSTING. The same rupiah answers two
// different questions — what the goods cost (#155) and who is owed for them (#184) — and the first
// version of a change like this is exactly where one of them quietly disappears.
func TestRestockFulfil_TheCODFeeStillReachesCosting(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSettlement(t, db, &recordingPoster{})

	reqID, err := acceptWithCOD(t, svc, 25000)
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	var stored inventory_service_models.RestockRequest

	err = db.Where("id = ?", reqID).Take(&stored).Error
	if err != nil {
		t.Fatalf("read request: %v", err)
	}

	if stored.CODShippingFee != 25000 {
		t.Fatalf("cod_shipping_fee = %d on the request, want 25000 — HPP reads this column",
			stored.CODShippingFee)
	}
}

// MOST DELIVERIES ARE NOT COD. An entry of zero would be a ledger row saying nothing happened —
// worse than no row, because it reads as a debt of nothing rather than the absence of one.
func TestRestockFulfil_NoCODFeeMeansNoObligation(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithSettlement(t, db, poster)

	_, err := acceptWithCOD(t, svc, 0)
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	if len(poster.posted) != 0 {
		t.Fatalf("%d obligations posted for a non-COD delivery, want 0", len(poster.posted))
	}
}

// ONE TRANSACTION, and this is the failure it prevents: if the stock movement commits and the
// obligation does not, the warehouse is out of pocket with no record — which is EXACTLY the
// situation settlement_service exists to fix, reproduced by the code meant to fix it.
func TestRestockFulfil_AFailedPostingRollsBackTheAcceptance(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{fail: errors.New("the ledger is down")}
	svc := newServiceWithSettlement(t, db, poster)

	reqID, err := acceptWithCOD(t, svc, 25000)
	if err == nil {
		t.Fatal("the acceptance succeeded while its obligation failed")
	}

	// The request is still PENDING…
	var stored inventory_service_models.RestockRequest

	readErr := db.Where("id = ?", reqID).Take(&stored).Error
	if readErr != nil {
		t.Fatalf("read request: %v", readErr)
	}

	if stored.Status == "fulfilled" {
		t.Fatal("the request was fulfilled without its obligation being recorded")
	}

	// …and no stock landed on a shelf.
	var levels int64

	readErr = db.
		Model(&inventory_service_models.StockLevel{}).
		Where("warehouse_id = ?", codWarehouse).
		Count(&levels).
		Error
	if readErr != nil {
		t.Fatalf("count stock: %v", readErr)
	}

	if levels != 0 {
		t.Fatalf("%d stock levels survived a rolled-back acceptance", levels)
	}
}

// The poster is handed the SAME transaction the acceptance runs in — the whole reason the two can be
// atomic at all. A poster given the bare connection would commit independently and the guarantee
// above would be an illusion.
func TestRestockFulfil_ThePosterRunsInTheAcceptancesTransaction(t *testing.T) {
	db := san_testdb.DB(t)

	var seen *gorm.DB

	poster := &txCapturingPoster{onPost: func(tx *gorm.DB) { seen = tx }}
	svc := newServiceWithSettlement(t, db, poster)

	_, err := acceptWithCOD(t, svc, 25000)
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	if seen == nil {
		t.Fatal("the poster was never given a transaction")
	}

	// A transaction handle is not the root connection it came from. Comparing the pointers is the
	// cheapest honest check that the acceptance did not hand over `s.db`.
	if seen == db {
		t.Fatal("the poster was handed the bare connection, so its write would commit on its own")
	}
}

type txCapturingPoster struct {
	onPost func(tx *gorm.DB)
}

func (p *txCapturingPoster) PostCODFee(
	_ context.Context,
	tx *gorm.DB,
	_, _, _ uint64,
	_ int64,
) error {
	p.onPost(tx)

	return nil
}

// ── The whole chain, against the real ledger ────────────────────────────────────────────────────
//
// The tests above use a fake poster, which proves inventory's half. This one wires the REAL
// settlement service through the same adapter shape the composition root uses, so the assertion is
// about rows in `settlement_entries` rather than about a call being made.
//
// It is the only place in the test suite that knows about both services at once, and deliberately so:
// in production that knowledge lives in exactly one file (cmd/app_development/settlement_poster.go),
// and an integration test is the other legitimate holder of it.
type realPoster struct {
	settlement *settlement_v1.Service
}

func (p *realPoster) PostCODFee(
	ctx context.Context,
	tx *gorm.DB,
	sellingTeamID, warehouseID, restockRequestID uint64,
	amount int64,
) error {
	_, err := p.settlement.PostEntry(ctx, tx, settlement_v1.Posting{
		DebtorTeamID:   sellingTeamID,
		CreditorTeamID: warehouseID,
		Amount:         amount,
		SourceType:     settlement_v1.SourceTypeCODFee,
		SourceID:       restockRequestID,
	})

	// A movement already recorded is a normal answer — the acceptance must not fail over a debt that
	// is already correctly on the books.
	if errors.Is(err, settlement_v1.ErrAlreadyPosted) {
		return nil
	}

	return err
}

func TestRestockFulfil_TheLedgerActuallyRecordsTheDebt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSettlement(t, db, &realPoster{settlement: settlement_v1.NewService(db)})

	reqID, err := acceptWithCOD(t, svc, 25000)
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// The warehouse is OWED: positive on its side.
	var warehouseBalance settlement_service_models.SettlementBalance

	err = db.
		Where("team_id = ? AND counterparty_id = ?", codWarehouse, codSellingTeam).
		Take(&warehouseBalance).
		Error
	if err != nil {
		t.Fatalf("read the warehouse's balance: %v", err)
	}

	if warehouseBalance.Balance != 25000 {
		t.Fatalf("the warehouse is owed %d, want 25000", warehouseBalance.Balance)
	}

	if warehouseBalance.OldestUnsettledAt == nil {
		t.Fatal("no ageing clock — the position screen would show a debt with no age")
	}

	// And the entry says WHY, by id, so the history can read "COD fee, restock #N" rather than a note.
	var entry settlement_service_models.SettlementEntry

	err = db.
		Where("team_id = ? AND counterparty_id = ?", codWarehouse, codSellingTeam).
		Take(&entry).
		Error
	if err != nil {
		t.Fatalf("read the entry: %v", err)
	}

	if entry.SourceType != "cod_fee" || entry.SourceID != reqID {
		t.Fatalf("entry source = %q/%d, want cod_fee/%d", entry.SourceType, entry.SourceID, reqID)
	}
}
