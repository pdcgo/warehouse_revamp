package liability_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

const productOwner uint64 = 3

// canceller is the person who cancelled — a DIFFERENT act from the placement it undoes, so the
// reversal entries name them rather than reusing the placer (every-entry-names-who-posted-it).
const canceller uint64 = 77

// setTerms writes a creditor's terms toward one debtor. `counterparty = 0` is the DEFAULT row.
//
// A handling fee and nothing else: the terms carry no markup (the-ledger-charges-the-frozen-line-total), and since step
// 4 of the-flat-rate-is-dropped-last nothing charges from the handling fee either — it is written here only to prove so.
func setTerms(t *testing.T, db *gorm.DB, creditor, debtor uint64, handling int64) {
	t.Helper()

	row := liability_service_models.LiabilityTerms{
		TeamID:         creditor,
		CounterpartyID: debtor,
		HandlingFee:    handling,
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("set terms: %v", err)
	}
}

func fee(v float64) *float64 { return &v }

// anOrder is one order of team `selling`, fulfilled by `warehouse`, selling `productOwner`'s goods: two units that
// cost 30.000, frozen by the take at the product's 20% markup — a line total of 72.000. The warehouse priced it at
// 12.000, frozen on the order (the-event-carries-the-warehouse-fee).
func anOrder(orderID uint64) liability_v1.PlacedOrder {
	return liability_v1.PlacedOrder{
		TeamID:       selling,
		WarehouseID:  warehouse,
		OrderID:      orderID,
		WarehouseFee: fee(12000),
		Lines: []liability_v1.OrderLine{
			{OwningTeamID: productOwner, Quantity: 2, Total: 72000},
		},
	}
}

// THE TWO ORDER-DRIVEN FEES. The warehouse fulfilled it, so it is owed the fee the order froze; the order sold
// somebody else's goods, so that team is owed the line's frozen total.
func TestChargeOrder_PostsTheWarehouseFeeAndTheProductFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 12000 {
		t.Fatalf("the warehouse is owed %d, want the order's frozen 12000", got)
	}

	// The line's frozen 72.000 — 60.000 of goods at the product's 20%, priced by the take — posted as it came.
	if got := balanceOf(t, db, productOwner, selling); got != 72000 {
		t.Fatalf("the product owner is owed %d, want the line's frozen 72000", got)
	}
}

// THE LEDGER CHARGES THE FROZEN LINE TOTALS AND READS NO MARKUP (the-ledger-charges-the-frozen-line-total).
//
// Two owning teams, their products at DIFFERENT markups — and the markups appear nowhere here, because the take already
// applied each product's own rate and froze the line. One fee per owning team, each the sum of its lines' totals, and
// the selling team's own line posts nothing.
//
//	productOwner   2 × 30.000 at 20%                                        = 72.000
//	secondOwner    1 × 10.000 at 10% = 11.000  +  3 × 5.000 at 0% = 15.000  = 26.000
//	selling        its own goods, 50.000                                    — owes nobody
func TestChargeOrder_TheProductFeeIsEachOwnersFrozenLineTotals(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const secondOwner uint64 = 4

	order := anOrder(412)
	order.Lines = []liability_v1.OrderLine{
		{OwningTeamID: productOwner, Quantity: 2, Total: 72000},
		{OwningTeamID: secondOwner, Quantity: 1, Total: 11000},
		{OwningTeamID: selling, Quantity: 1, Total: 50000},
		{OwningTeamID: secondOwner, Quantity: 3, Total: 15000},
	}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, productOwner, selling); got != 72000 {
		t.Fatalf("productOwner is owed %d, want its line's 72000", got)
	}

	if got := balanceOf(t, db, secondOwner, selling); got != 26000 {
		t.Fatalf("secondOwner is owed %d, want 26000 — its two lines at two rates, as frozen", got)
	}

	var fees []liability_service_models.LiabilityLog

	err = db.
		Where("team_id = ? AND source_type = ?", selling, "product_fee").
		Order("counterparty_id").
		Find(&fees).
		Error
	if err != nil {
		t.Fatalf("read the fees: %v", err)
	}

	// ONE fee per owning team, and none toward the selling team itself for its own goods.
	if len(fees) != 2 || fees[0].CounterpartyID != productOwner || fees[1].CounterpartyID != secondOwner {
		t.Fatalf("product fees %+v, want exactly one to %d and one to %d", fees, productOwner, secondOwner)
	}
}

// ROUNDED ONCE, ON THE SUM. The totals arrive as doubles (rupiah-is-floating-point) and an entry is whole rupiah:
// 33.000,4 + 11.000,4 is 44.000,8, posted as 44.001. Rounding each line first would post 44.000 — a rupiah lost per
// line, which is how a ledger and an invoice drift apart.
func TestChargeOrder_AFractionalTotalIsRoundedOnceOnTheSum(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.Lines = []liability_v1.OrderLine{
		{OwningTeamID: productOwner, Quantity: 1, Total: 33000.4},
		{OwningTeamID: productOwner, Quantity: 1, Total: 11000.4},
	}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, productOwner, selling); got != 44001 {
		t.Fatalf("the owner is owed %d, want 44001 — the sum 44000.8, rounded once", got)
	}
}

// ⛔ THE TERMS HAVE NO MARKUP TO READ (the-ledger-charges-the-frozen-line-total). Dropped from the table and from its
// change log, so no rate here can ever disagree with the one the take froze. Read from the catalog rather than the
// model, because the model losing its field proves only that this package stopped naming it.
func TestLiabilityTerms_CarryNoMarkup(t *testing.T) {
	db := san_testdb.DB(t)

	var columns []string

	err := db.
		Raw(`SELECT table_name || '.' || column_name FROM information_schema.columns
			WHERE table_schema = current_schema()
			  AND table_name IN ('liability_terms', 'liability_terms_logs')
			  AND column_name LIKE '%markup%'`).
		Scan(&columns).
		Error
	if err != nil {
		t.Fatalf("read the columns: %v", err)
	}

	if len(columns) != 0 {
		t.Fatalf("the terms still carry %v — the ledger must read no markup of its own", columns)
	}
}

// A REDELIVERY IS NORMAL. Pub/Sub is at-least-once, so the same order arriving twice must change
// nothing — a consumer that could not survive this would have to NACK, and a NACK on a message that
// can never succeed is a poison loop.
func TestChargeOrder_ARedeliveryChargesNothingExtra(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	for i := 0; i < 3; i++ {
		err := svc.ChargeOrder(context.Background(), anOrder(412))
		if err != nil {
			t.Fatalf("delivery %d: %v", i, err)
		}
	}

	if got := balanceOf(t, db, warehouse, selling); got != 12000 {
		t.Fatalf("the warehouse is owed %d after three deliveries, want 12000", got)
	}

	if got := balanceOf(t, db, productOwner, selling); got != 72000 {
		t.Fatalf("the product owner is owed %d after three deliveries, want 72000", got)
	}
}

// ⚠ AN ORDER WITH NO FROZEN FEE CHARGES THE WAREHOUSE NOTHING, and the product fee is owed anyway.
//
//   - The WAREHOUSE FEE is a PRICE the order froze when it was placed. An order placed before fees were frozen carries
//     none, and liability does not guess one — it computes no fee of its own (the-event-carries-the-warehouse-fee).
//   - The PRODUCT FEE is a COST TRANSFER. The goods left the owner's stock and do not come back
//     (§2.2: "money from the first moment"), so the owner is owed the line's frozen total whether or
//     not anybody configured anything — there is no term for it to read.
//
// Defaulting the product fee to zero as well would mean one team's goods walk out of another team's
// warehouse free, which is the one outcome §2.2 explicitly rejects.
func TestChargeOrder_NoFrozenFeeChargesTheWarehouseNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.WarehouseFee = nil

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := entriesBetween(t, db, warehouse, selling); got != 0 {
		t.Fatalf("%d warehouse-fee entries for an order with no frozen fee, want 0", got)
	}

	// The goods still left their owner's stock: the line's frozen total, with no terms anywhere.
	if got := balanceOf(t, db, productOwner, selling); got != 72000 {
		t.Fatalf("the product owner is owed %d, want the line's frozen 72000", got)
	}
}

// A fee of 0 is a warehouse that charges nothing: no entry, so the pair's idempotency key for the order stays free.
func TestChargeOrder_AZeroFeePostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.WarehouseFee = fee(0)

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := entriesBetween(t, db, warehouse, selling); got != 0 {
		t.Fatalf("%d warehouse-fee entries for a fee of 0, want 0", got)
	}
}

// THE SWITCH-OVER DAY (the-flat-rate-is-dropped-last, step 4): the flat handling fee on Credit Terms — a default AND a
// per-team row — is not read any more. The warehouse is owed what the order froze, rounded once to whole rupiah.
func TestChargeOrder_TheFlatRateIsNoLongerRead(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	setTerms(t, db, warehouse, 0, 12000)
	setTerms(t, db, warehouse, selling, 5000)

	order := anOrder(412)
	order.WarehouseFee = fee(4300.4)

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 4300 {
		t.Fatalf("the warehouse is owed %d, want the order's 4300.4 rounded — not the 5000 or 12000 flat rate", got)
	}

	half := anOrder(413)
	half.WarehouseFee = fee(1500.5)

	err = svc.ChargeOrder(context.Background(), half)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 4300+1501 {
		t.Fatalf("the warehouse is owed %d, want 4300 + 1500.5 rounded up", got)
	}
}

// entriesBetween counts the ledger rows on the creditor's side toward one debtor.
func entriesBetween(t *testing.T, db *gorm.DB, creditor, debtor uint64) int64 {
	t.Helper()

	var n int64

	err := db.
		Model(&liability_service_models.LiabilityLog{}).
		Where("team_id = ? AND counterparty_id = ?", creditor, debtor).
		Count(&n).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	return n
}

// ONE FEE PER OWNING TEAM, not per line: two lines of the same team's goods are ONE debt, and the
// idempotency key is (source_type, source_id, counterparty) — so per-line postings would collide and
// the second line would silently vanish.
func TestChargeOrder_TwoLinesOfOneOwnerAreOneFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.Lines = append(order.Lines,
		liability_v1.OrderLine{OwningTeamID: productOwner, Quantity: 1, Total: 10000})

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, productOwner, selling); got != 82000 {
		t.Fatalf("the owner is owed %d, want 82000 — both lines in one fee", got)
	}

	var entries int64

	err = db.
		Model(&liability_service_models.LiabilityLog{}).
		Where("team_id = ? AND counterparty_id = ?", productOwner, selling).
		Count(&entries).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 1 {
		t.Fatalf("%d entries for the owner, want 1", entries)
	}
}

// SELLING YOUR OWN GOODS OWES NOBODY, and neither does fulfilling your own order.
func TestChargeOrder_SellingYourOwnProductOwesNobody(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.WarehouseID = selling
	order.Lines = []liability_v1.OrderLine{{OwningTeamID: selling, Quantity: 2, Total: 60000}}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	var entries int64

	err = db.Model(&liability_service_models.LiabilityLog{}).Count(&entries).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d entries for a team selling its own goods from its own warehouse, want 0", entries)
	}
}

// ⚠ Q10 — AN UNKNOWN TOTAL POSTS NOTHING AND IS NOT REFUSED. Goods received straight into stock have no
// recorded cost, so the take prices their line at zero — and an order placed before lines froze a total
// carries none at all. The sale is not blocked over a bookkeeping gap; the reconciliation report (#187)
// is what names it. Nothing is written, because a zero-amount entry would consume this pair's
// idempotency key for this order and block the real fee forever.
func TestChargeOrder_AnUnknownTotalChargesNothingRatherThanFailing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.Lines = []liability_v1.OrderLine{{OwningTeamID: productOwner, Quantity: 2, Total: 0}}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("an unknown total failed the delivery: %v", err)
	}

	var entries int64

	err = db.
		Model(&liability_service_models.LiabilityLog{}).
		Where("team_id = ?", productOwner).
		Count(&entries).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d entries for an unknown total, want 0", entries)
	}
}

// A LINE WHOSE OWNER COULD NOT BE RESOLVED has nobody to pay. Guessing would be a debt against a
// team picked by accident.
func TestChargeOrder_AnUnresolvedOwnerIsSkipped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	order := anOrder(412)
	order.Lines = []liability_v1.OrderLine{{OwningTeamID: 0, Quantity: 2, Total: 72000}}
	// The product fee alone: the warehouse's fee is another test's.
	order.WarehouseFee = nil

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	var entries int64

	err = db.Model(&liability_service_models.LiabilityLog{}).Count(&entries).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d entries for an unresolved owner, want 0", entries)
	}
}

// A CANCEL REVERSES BOTH FEES, and the balance nets to zero while both stories stay visible.
func TestReverseOrder_UndoesEveryFeeTheOrderCharged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("charge: %v", err)
	}

	err = svc.ReverseOrder(context.Background(), selling, 412, canceller)
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 0 {
		t.Fatalf("the warehouse is still owed %d after the cancel", got)
	}

	if got := balanceOf(t, db, productOwner, selling); got != 0 {
		t.Fatalf("the product owner is still owed %d after the cancel", got)
	}

	// Four entries on the selling team's side: two fees, two reversals. A reversal is a compensating
	// entry, never a delete — "the fee briefly existed" is what an audit needs to see.
	var entries int64

	err = db.
		Model(&liability_service_models.LiabilityLog{}).
		Where("team_id = ?", selling).
		Count(&entries).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 4 {
		t.Fatalf("%d entries on the selling side, want 4 (two fees, two reversals)", entries)
	}
}

// A DOUBLE CANCEL MUST NOT REVERSE TWICE — the same at-least-once problem, one step further on.
func TestReverseOrder_ARedeliveredCancelReversesOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("charge: %v", err)
	}

	for i := 0; i < 3; i++ {
		err = svc.ReverseOrder(context.Background(), selling, 412, canceller)
		if err != nil {
			t.Fatalf("cancel %d: %v", i, err)
		}
	}

	if got := balanceOf(t, db, warehouse, selling); got != 0 {
		t.Fatalf("balance = %d after three cancels, want 0 — a reversal ran more than once", got)
	}
}

// ⚠ A CANCEL DOES NOT TOUCH THE COD FEE. That debt is for goods the warehouse paid for at the door;
// an order falling through does not give the warehouse its money back.
func TestReverseOrder_LeavesTheCODObligationAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	_, err := svc.PostEntry(context.Background(), db, codFee(25000, 77))
	if err != nil {
		t.Fatalf("cod: %v", err)
	}

	err = svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("charge: %v", err)
	}

	err = svc.ReverseOrder(context.Background(), selling, 412, canceller)
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 25000 {
		t.Fatalf("the warehouse is owed %d, want the 25000 COD fee still standing", got)
	}
}
