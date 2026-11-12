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

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// KOREKSI HARGA (the-owning-team-revalues-with-a-reason, the-correct-price-prototype-is-accepted,
// a-corrected-price-is-above-zero; batch.md §Change Price Flow Example): the owning team gives one batch a new unit
// price, with a reason. Melati's Kaos Hitam batch in Gudang 5 holds 10 at Rp 10.000 (otStocked).

const revalueReason = "Di nota Rp 12.000 — salah ketik saat diterima"

// hitamBatch is Melati's one Kaos Hitam batch in Gudang 5.
func hitamBatch(t *testing.T, db *gorm.DB) models.Batch {
	t.Helper()

	var b models.Batch

	err := db.Where("team_id = ? AND product_id = ?", otMelati, otKaosHitam).First(&b).Error
	if err != nil {
		t.Fatalf("Kaos Hitam's batch: %v", err)
	}

	return b
}

func revalue(svc *inventory_v1.Service, ctx context.Context, req *inventoryv1.BatchRevalueRequest) (*inventoryv1.BatchRevalueResponse, error) {
	res, err := svc.BatchRevalue(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// revalueRequest is Melati correcting the batch from the price the form showed to `to`.
func revalueRequest(batchID uint64, expected, to float64) *inventoryv1.BatchRevalueRequest {
	return &inventoryv1.BatchRevalueRequest{
		TeamId: otMelati, BatchId: batchID, ExpectedPriceUnit: expected, NewPriceUnit: to, Reason: revalueReason,
	}
}

// writtenRevaluations counts what a correction writes, so a refusal can be proved to have written none of it.
func writtenRevaluations(t *testing.T, db *gorm.DB) (txs, logs, prices int64) {
	t.Helper()

	db.Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxRevaluation).Count(&txs)
	db.Model(&models.BatchLog{}).Where("change_type = ?", string(models.TxRevaluation)).Count(&logs)
	// A mint writes one price log per batch; anything past that is a correction's.
	db.Raw(`SELECT COUNT(*) - (SELECT COUNT(*) FROM batches) FROM batch_price_logs`).Scan(&prices)

	return txs, logs, prices
}

func assertNothingWritten(t *testing.T, db *gorm.DB, before models.Batch) {
	t.Helper()

	txs, logs, prices := writtenRevaluations(t, db)
	if txs != 0 || logs != 0 || prices != 0 {
		t.Fatalf("a refused correction wrote %d transaction(s), %d batch log(s), %d price log(s)", txs, logs, prices)
	}

	var after models.Batch
	db.First(&after, before.ID)

	if !san_money.Equal(after.PriceUnit, before.PriceUnit) || !san_money.Equal(after.StockValuation, before.StockValuation) {
		t.Fatalf("batch after a refusal = %v / %v, want %v / %v untouched",
			after.PriceUnit, after.StockValuation, before.PriceUnit, before.StockValuation)
	}
}

// THE CORRECTION, AS batch.md DRAWS IT: Rp 10.000 → Rp 12.000 on the 10 left. One `revaluation` transaction of Melati's
// in the batch's warehouse carrying the reason; a batch row that moved no unit and +Rp 20.000 of value, its price after
// the new one; a price log with the new price and +2.000; the batch at 12.000 and 120.000 with its 10 units; an item of
// quantity 0 and total 20.000; no rack row; both invariants hold; not an override.
func TestBatchRevalue_RepricesTheUnitsLeftAndWritesBothLogs(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	res, err := revalue(svc, ctxAs(8, otMelati, role_basev1.Role_ROLE_SELLING_OWNER), revalueRequest(b.ID, 10000, 12000))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	if !san_money.Equal(res.GetPriceUnitBefore(), 10000) || !san_money.Equal(res.GetPriceUnitAfter(), 12000) ||
		!san_money.Equal(res.GetValueChange(), 20000) || res.GetUnits() != 10 {
		t.Fatalf("response = %+v, want 10000 → 12000, +20000 over 10 units", res)
	}

	var after models.Batch
	db.First(&after, b.ID)

	if after.StockCount != 10 || !san_money.Equal(after.PriceUnit, 12000) || !san_money.Equal(after.StockValuation, 120000) {
		t.Fatalf("batch = %d units at %v worth %v, want 10 at 12000 worth 120000", after.StockCount, after.PriceUnit, after.StockValuation)
	}

	if after.InitStockCount != 10 || !san_money.Equal(after.InitStockValuation, 100000) {
		t.Fatalf("init = %d / %v, want 10 / 100000 kept for ever", after.InitStockCount, after.InitStockValuation)
	}

	var tx models.InventoryTransaction
	db.First(&tx, res.GetTransactionId())

	if tx.TxType != models.TxRevaluation || tx.TeamID != otMelati || tx.WarehouseID != otWarehouse ||
		tx.Description != revalueReason || tx.CreateByUserID != 8 || tx.IsOverride {
		t.Fatalf("transaction = %+v, want Melati's revaluation in Gudang 5 by 8, with the reason, no override", tx)
	}

	var logs []models.BatchLog
	db.Where("transaction_id = ?", tx.ID).Find(&logs)

	if len(logs) != 1 {
		t.Fatalf("%d batch rows, want 1", len(logs))
	}

	l := logs[0]
	if l.BatchID != b.ID || l.ChangeType != "revaluation" || l.ChangeCount != 0 || !san_money.Equal(l.ChangeValuation, 20000) ||
		l.StockCountAfter != 10 || !san_money.Equal(l.StockValuationAfter, 120000) || !san_money.Equal(l.PriceUnitAfter, 12000) ||
		l.Description != revalueReason || l.ActorID != 8 {
		t.Fatalf("batch row = %+v, want revaluation 0 units +20000, after 10 / 120000 at 12000, the reason, actor 8", l)
	}

	var price models.BatchPriceLog
	db.Where("batch_id = ?", b.ID).Order("id DESC").First(&price)

	if !san_money.Equal(price.NewPriceUnit, 12000) || !san_money.Equal(price.DeltaPriceUnit, 2000) ||
		price.Description != revalueReason || price.ActorID != 8 {
		t.Fatalf("price log = %+v, want 12000 (+2000), the reason, actor 8", price)
	}

	// batch-logs-carry-price-unit-after: the two rows of one change agree.
	if !san_money.Equal(price.NewPriceUnit, l.PriceUnitAfter) {
		t.Fatalf("price log %v ≠ batch row's price after %v", price.NewPriceUnit, l.PriceUnitAfter)
	}

	var items []models.InventoryTransactionItem
	db.Where("transaction_id = ?", tx.ID).Find(&items)

	if len(items) != 1 || items[0].ProductID != otKaosHitam || items[0].Quantity != 0 || !san_money.Equal(items[0].Total, 20000) ||
		items[0].ProductTeamID != otMelati || !items[0].IsOwned {
		t.Fatalf("items = %+v, want one: Kaos Hitam, quantity 0, total 20000, Melati's own", items)
	}

	var rackRows int64
	db.Model(&models.ProductPlacementLog{}).Where("transaction_id = ?", tx.ID).Count(&rackRows)

	if rackRows != 0 {
		t.Fatalf("%d rack rows, want none — a correction moves no unit", rackRows)
	}

	err = inventory_ledgers.Verify(db, tx.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// A MARKDOWN: the value goes DOWN, the item stays positive — the batch row carries the sign. A fraction is kept.
func TestBatchRevalue_AMarkdownKeepsTheItemPositive(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	res, err := revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, 8500.5))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	if !san_money.Equal(res.GetValueChange(), -14995) {
		t.Fatalf("value change = %v, want 10 × −1499.5 = −14995", res.GetValueChange())
	}

	var item models.InventoryTransactionItem
	db.Where("transaction_id = ?", res.GetTransactionId()).First(&item)

	if item.Quantity != 0 || !san_money.Equal(item.Total, 14995) {
		t.Fatalf("item = %+v, want quantity 0, total 14995", item)
	}

	var after models.Batch
	db.First(&after, b.ID)

	if !san_money.Equal(after.PriceUnit, 8500.5) || !san_money.Equal(after.StockValuation, 85005) {
		t.Fatalf("batch = %v worth %v, want 8500.5 worth 85005", after.PriceUnit, after.StockValuation)
	}

	err = inventory_ledgers.Verify(db, res.GetTransactionId())
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// ONLY THE UNITS LEFT ARE REPRICED (a-late-cost-is-an-expense-not-a-revaluation): 4 sold at 10.000 keep that cost;
// the 6 left go to 12.000 (+12.000), and the next take costs at the new price.
func TestBatchRevalue_UnitsGoneKeepTheirPriceAndTheNextTakeCostsTheNew(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	first, err := take(svc, "key-1", line(otKaosHitam, 4))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	res, err := revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, 12000))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	if res.GetUnits() != 6 || !san_money.Equal(res.GetValueChange(), 12000) {
		t.Fatalf("response = %+v, want 6 units, +12000", res)
	}

	var firstTake float64
	db.Raw(`SELECT SUM(change_valuation) FROM batch_logs WHERE transaction_id = ?`, first.GetTransactionId()).Scan(&firstTake)

	if !san_money.Equal(firstTake, -40000) {
		t.Fatalf("the first take's rows = %v, want −40000 — units gone keep their price", firstTake)
	}

	second, err := take(svc, "key-2", line(otKaosHitam, 2))
	if err != nil {
		t.Fatalf("second take: %v", err)
	}

	var secondTake float64
	db.Raw(`SELECT SUM(change_valuation) FROM batch_logs WHERE transaction_id = ?`, second.GetTransactionId()).Scan(&secondTake)

	if !san_money.Equal(secondTake, -24000) {
		t.Fatalf("the next take = %v, want −24000 at the new price", secondTake)
	}

	var after models.Batch
	db.First(&after, b.ID)

	if after.StockCount != 4 || !san_money.Equal(after.StockValuation, 48000) {
		t.Fatalf("batch = %d worth %v, want 4 worth 48000", after.StockCount, after.StockValuation)
	}
}

// ROOT FROM OUTSIDE is stamped an override (an-override-is-stamped-in-every-service); the owning team's own Admin is not.
func TestBatchRevalue_RootFromOutsideIsStampedAnOverride(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	_, err := revalue(svc, ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_UNSPECIFIED), revalueRequest(b.ID, 10000, 11000))
	if err != nil {
		t.Fatalf("root revalue: %v", err)
	}

	actor, override := lastTransactionOverride(t, db, string(models.TxRevaluation))
	if actor != ovRoot || !override {
		t.Fatalf("Root's correction = actor %d override %v, want %d stamped", actor, override, ovRoot)
	}

	_, err = revalue(svc, ctxAs(9, otMelati, role_basev1.Role_ROLE_SELLING_ADMIN), revalueRequest(b.ID, 11000, 12000))
	if err != nil {
		t.Fatalf("admin revalue: %v", err)
	}

	actor, override = lastTransactionOverride(t, db, string(models.TxRevaluation))
	if actor != 9 || override {
		t.Fatalf("the Admin's correction = actor %d override %v, want 9 not stamped", actor, override)
	}
}

// WHO MAY (the-owning-team-revalues-with-a-reason): the selling Owner and Admin, Root and the Administrator — never a
// warehouse role, CS or a monitor. A write, so no agent's credential either.
func TestBatchRevalue_PolicyIsTheOwnersOwnerAndAdmin(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.BatchRevalueRequest"))
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("BatchRevalueRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
	}

	got := slices.Clone(policy.GetRoles())
	slices.Sort(got)
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Fatalf("policy roles = %v, want exactly %v", got, want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.InventoryService.BatchRevalue"))
	if err != nil {
		t.Fatalf("method: %v", err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("BatchRevalue is marked side-effect free — a monitor or an agent could call it")
	}
}

// ANOTHER TEAM'S BATCH, OR NONE, IS NOT FOUND — Sinar, scoped to itself, cannot correct Melati's batch, and an id
// cannot tell it whether the batch exists. Nothing is written.
func TestBatchRevalue_RefusesAnotherTeamsBatchAndAnUnknownOne(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	req := revalueRequest(b.ID, 10000, 12000)
	req.TeamId = otSinar

	_, err := revalue(svc, ctxAs(8, otSinar, role_basev1.Role_ROLE_SELLING_OWNER), req)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another team's batch: err = %v, want NotFound", err)
	}

	_, err = revalue(svc, ctxUser(8), revalueRequest(999999, 10000, 12000))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown batch: err = %v, want NotFound", err)
	}

	assertNothingWritten(t, db, b)
}

// THE PRICE IS ABOVE RP 0 (a-corrected-price-is-above-zero): Rp 0 and below are refused, nothing written.
func TestBatchRevalue_RefusesAPriceAtOrBelowZero(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	for _, price := range []float64{0, -5000, 0.00001} {
		_, err := revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, price))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("price %v: err = %v, want InvalidArgument", price, err)
		}
	}

	assertNothingWritten(t, db, b)
}

// A REASON IS REQUIRED (the-owning-team-revalues-with-a-reason): empty or only spaces, or past 200, is refused.
func TestBatchRevalue_RefusesAMissingOrTooLongReason(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	for _, reason := range []string{"", "   \t ", strings.Repeat("x", 201)} {
		req := revalueRequest(b.ID, 10000, 12000)
		req.Reason = reason

		_, err := revalue(svc, ctxUser(8), req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("reason %q: err = %v, want InvalidArgument", reason, err)
		}
	}

	assertNothingWritten(t, db, b)

	// Trimmed: the reason is stored without its spaces, and 200 is allowed.
	req := revalueRequest(b.ID, 10000, 12000)
	req.Reason = "  " + strings.Repeat("y", 200) + "  "

	res, err := revalue(svc, ctxUser(8), req)
	if err != nil {
		t.Fatalf("a 200-character reason: %v", err)
	}

	var tx models.InventoryTransaction
	db.First(&tx, res.GetTransactionId())

	if tx.Description != strings.Repeat("y", 200) {
		t.Fatalf("description = %q, want the reason trimmed", tx.Description)
	}
}

// THE SAME PRICE CORRECTS NOTHING — refused, naming the price.
func TestBatchRevalue_RefusesTheSamePrice(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	_, err := revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, 10000.00001))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "already at Rp 10.000") {
		t.Fatalf("err = %v, want FailedPrecondition: already at Rp 10.000", err)
	}

	assertNothingWritten(t, db, b)
}

// A STALE FORM — the price moved since the form showed it (someone corrected it first): refused, naming the price now;
// a retry of a correction that already landed reads the same.
func TestBatchRevalue_RefusesAStaleForm(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	_, err := revalue(svc, ctxUser(8), revalueRequest(b.ID, 11000, 12000))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "changed to Rp 10.000") {
		t.Fatalf("err = %v, want FailedPrecondition: the price changed to Rp 10.000", err)
	}

	assertNothingWritten(t, db, b)

	_, err = revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, 12000))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	_, err = revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, 12000))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("the retry: err = %v, want FailedPrecondition", err)
	}

	txs, _, _ := writtenRevaluations(t, db)
	if txs != 1 {
		t.Fatalf("%d corrections, want 1 — the retry wrote nothing", txs)
	}
}

// NO UNITS LEFT, NOTHING TO CORRECT — a correction changes only the units left.
func TestBatchRevalue_RefusesABatchWithNoUnitsLeft(t *testing.T) {
	svc, db, _, _ := otStocked(t)
	b := hitamBatch(t, db)

	_, err := take(svc, "key-all", line(otKaosHitam, 10))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	db.First(&b, b.ID)

	_, err = revalue(svc, ctxUser(8), revalueRequest(b.ID, 10000, 12000))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "no units left") {
		t.Fatalf("err = %v, want FailedPrecondition: no units left", err)
	}

	assertNothingWritten(t, db, b)
}
