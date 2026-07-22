package settlement_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

const productOwner uint64 = 3

// setTerms writes a creditor's terms toward one debtor. `counterparty = 0` is the DEFAULT row.
func setTerms(t *testing.T, db *gorm.DB, creditor, debtor uint64, handling, markupBP int64) {
	t.Helper()

	row := settlement_service_models.SettlementTerms{
		TeamID:          creditor,
		CounterpartyID:  debtor,
		HandlingFee:     handling,
		ProductMarkupBP: markupBP,
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("set terms: %v", err)
	}
}

// anOrder is one order of team `selling`, fulfilled by `warehouse`, selling `productOwner`'s goods.
func anOrder(orderID uint64) settlement_v1.PlacedOrder {
	return settlement_v1.PlacedOrder{
		TeamID:      selling,
		WarehouseID: warehouse,
		OrderID:     orderID,
		Lines: []settlement_v1.OrderLine{
			{OwningTeamID: productOwner, Quantity: 2, UnitCost: 30000},
		},
	}
}

// THE TWO ORDER-DRIVEN FEES. The warehouse fulfilled it, so it is owed a flat fee; the order sold
// somebody else's goods, so that team is owed cost + markup.
func TestChargeOrder_PostsTheHandlingFeeAndTheProductFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	setTerms(t, db, warehouse, 0, 12000, 0)
	setTerms(t, db, productOwner, 0, 0, 2000) // 20% markup

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 12000 {
		t.Fatalf("the warehouse is owed %d, want the flat 12000", got)
	}

	// 2 × 30.000 = 60.000 of cost, plus 20% = 72.000. THE ANCHOR IS COST, not the buyer-paid price:
	// a markup on what the buyer paid is a commission model wearing a sale's clothes, and it would
	// leave the owner out of pocket on their own goods.
	if got := balanceOf(t, db, productOwner, selling); got != 72000 {
		t.Fatalf("the product owner is owed %d, want 72000 (cost 60000 + 20%%)", got)
	}
}

// A REDELIVERY IS NORMAL. Pub/Sub is at-least-once, so the same order arriving twice must change
// nothing — a consumer that could not survive this would have to NACK, and a NACK on a message that
// can never succeed is a poison loop.
func TestChargeOrder_ARedeliveryChargesNothingExtra(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	setTerms(t, db, warehouse, 0, 12000, 0)

	for i := 0; i < 3; i++ {
		err := svc.ChargeOrder(context.Background(), anOrder(412))
		if err != nil {
			t.Fatalf("delivery %d: %v", i, err)
		}
	}

	if got := balanceOf(t, db, warehouse, selling); got != 12000 {
		t.Fatalf("the warehouse is owed %d after three deliveries, want 12000", got)
	}
}

// ⚠ THE TWO FEES DEFAULT DIFFERENTLY WITH NO CONFIGURATION, and the asymmetry is deliberate.
//
//   - The HANDLING FEE is a PRICE the warehouse sets. No price set means the service is free, and a
//     warehouse that has configured nothing must not be silently billing anybody.
//   - The PRODUCT FEE is a COST TRANSFER. The goods left the owner's stock and do not come back
//     (§2.2: "money from the first moment"), so the owner is owed what they cost whether or not
//     anybody configured anything. The MARKUP is the optional part, and it defaults to zero.
//
// Defaulting the product fee to zero as well would mean one team's goods walk out of another team's
// warehouse free, which is the one outcome §2.2 explicitly rejects.
func TestChargeOrder_TheTwoFeesDefaultDifferently(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	// No handling rate configured: the warehouse charges nothing.
	var handling int64

	err = db.
		Model(&settlement_service_models.SettlementEntry{}).
		Where("team_id = ? AND counterparty_id = ?", warehouse, selling).
		Count(&handling).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if handling != 0 {
		t.Fatalf("%d handling-fee entries with no rate configured, want 0", handling)
	}

	// The goods still left their owner's stock: cost, and a markup of zero.
	if got := balanceOf(t, db, productOwner, selling); got != 60000 {
		t.Fatalf("the product owner is owed %d, want the goods' cost of 60000", got)
	}
}

// A per-debtor row OVERRIDES the creditor's default — that is the whole point of having both.
func TestChargeOrder_APerTeamRateOverridesTheDefault(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	setTerms(t, db, warehouse, 0, 12000, 0)
	setTerms(t, db, warehouse, selling, 5000, 0)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 5000 {
		t.Fatalf("the warehouse is owed %d, want the 5000 override rather than the 12000 default", got)
	}
}

// ONE FEE PER OWNING TEAM, not per line: two lines of the same team's goods are ONE debt, and the
// idempotency key is (source_type, source_id, counterparty) — so per-line postings would collide and
// the second line would silently vanish.
func TestChargeOrder_TwoLinesOfOneOwnerAreOneFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	setTerms(t, db, productOwner, 0, 0, 0)

	order := anOrder(412)
	order.Lines = append(order.Lines,
		settlement_v1.OrderLine{OwningTeamID: productOwner, Quantity: 1, UnitCost: 10000})

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	if got := balanceOf(t, db, productOwner, selling); got != 70000 {
		t.Fatalf("the owner is owed %d, want 70000 — both lines in one fee", got)
	}

	var entries int64

	err = db.
		Model(&settlement_service_models.SettlementEntry{}).
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
	svc := settlement_v1.NewService(db)

	setTerms(t, db, selling, 0, 12000, 5000)

	order := anOrder(412)
	order.WarehouseID = selling
	order.Lines = []settlement_v1.OrderLine{{OwningTeamID: selling, Quantity: 2, UnitCost: 30000}}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	var entries int64

	err = db.Model(&settlement_service_models.SettlementEntry{}).Count(&entries).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d entries for a team selling its own goods from its own warehouse, want 0", entries)
	}
}

// ⚠ Q10 — AN UNKNOWN COST POSTS NOTHING AND IS NOT REFUSED. A product received straight into stock
// has no recorded cost, so cost+markup computes zero. The sale is not blocked over a bookkeeping gap;
// the reconciliation report (#187) is what names it. Nothing is written, because a zero-amount entry
// would consume this pair's idempotency key for this order and block the real fee forever.
func TestChargeOrder_AnUnknownCostChargesNothingRatherThanFailing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	setTerms(t, db, productOwner, 0, 0, 2000)

	order := anOrder(412)
	order.Lines = []settlement_v1.OrderLine{{OwningTeamID: productOwner, Quantity: 2, UnitCost: 0}}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("an unknown cost failed the delivery: %v", err)
	}

	var entries int64

	err = db.
		Model(&settlement_service_models.SettlementEntry{}).
		Where("team_id = ?", productOwner).
		Count(&entries).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d entries for an unknown cost, want 0", entries)
	}
}

// A LINE WHOSE OWNER COULD NOT BE RESOLVED has nobody to pay. Guessing would be a debt against a
// team picked by accident.
func TestChargeOrder_AnUnresolvedOwnerIsSkipped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	order := anOrder(412)
	order.Lines = []settlement_v1.OrderLine{{OwningTeamID: 0, Quantity: 2, UnitCost: 30000}}

	err := svc.ChargeOrder(context.Background(), order)
	if err != nil {
		t.Fatalf("ChargeOrder: %v", err)
	}

	var entries int64

	err = db.Model(&settlement_service_models.SettlementEntry{}).Count(&entries).Error
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
	svc := settlement_v1.NewService(db)

	setTerms(t, db, warehouse, 0, 12000, 0)
	setTerms(t, db, productOwner, 0, 0, 2000)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("charge: %v", err)
	}

	err = svc.ReverseOrder(context.Background(), selling, 412)
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
		Model(&settlement_service_models.SettlementEntry{}).
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
	svc := settlement_v1.NewService(db)

	setTerms(t, db, warehouse, 0, 12000, 0)

	err := svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("charge: %v", err)
	}

	for i := 0; i < 3; i++ {
		err = svc.ReverseOrder(context.Background(), selling, 412)
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
	svc := settlement_v1.NewService(db)

	setTerms(t, db, warehouse, 0, 12000, 0)

	_, err := svc.PostEntry(context.Background(), db, codFee(25000, 77))
	if err != nil {
		t.Fatalf("cod: %v", err)
	}

	err = svc.ChargeOrder(context.Background(), anOrder(412))
	if err != nil {
		t.Fatalf("charge: %v", err)
	}

	err = svc.ReverseOrder(context.Background(), selling, 412)
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	if got := balanceOf(t, db, warehouse, selling); got != 25000 {
		t.Fatalf("the warehouse is owed %d, want the 25000 COD fee still standing", got)
	}
}
