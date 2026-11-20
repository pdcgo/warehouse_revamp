package financial_account_v1_test

import (
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// The custom shipment — the SAME NUMBER as transferID on purpose: parcels and transfers are numbered separately.
const parcelID uint64 = transferID

const (
	teamPays      = inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM
	warehousePays = inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE
)

func parcelCreated(eventID string, payer inventoryv1.CustomShipmentPayer, account uint64, amount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.New(sentAt),
		AggregateId: "custom-shipment:603",
		Message: &eventsv1.Event_CustomShipmentCreated{CustomShipmentCreated: &eventsv1.CustomShipmentCreated{
			CustomShipmentId: parcelID, TeamId: teamA, WarehouseId: teamB,
			Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE, Payer: payer,
			FinanceAccountId: account, Amount: amount, ActorId: ani, CreatedAtUnix: sentAt.Unix(),
		}},
	}
}

func parcelCostUpdated(eventID string, oldAccount, newAccount uint64, oldAmount, newAmount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "custom-shipment:603",
		Message: &eventsv1.Event_CustomShipmentCostUpdated{CustomShipmentCostUpdated: &eventsv1.CustomShipmentCostUpdated{
			CustomShipmentId: parcelID, TeamId: teamA,
			OldFinanceAccountId: oldAccount, NewFinanceAccountId: newAccount,
			OldAmount: oldAmount, NewAmount: newAmount,
			ActorId: ani, UpdatedAtUnix: time.Now().Unix(),
		}},
	}
}

func parcelCancelled(eventID string, payer inventoryv1.CustomShipmentPayer, account uint64, amount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "custom-shipment:603",
		Message: &eventsv1.Event_CustomShipmentCancelled{CustomShipmentCancelled: &eventsv1.CustomShipmentCancelled{
			CustomShipmentId: parcelID, TeamId: teamA, WarehouseId: teamB,
			Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE, Payer: payer,
			FinanceAccountId: account, Amount: amount, ActorId: ani, CancelledAtUnix: time.Now().Unix(),
		}},
	}
}

func payParcel(svc *financial_account_v1.Service, event *eventsv1.Event) error {
	return svc.CustomShipmentShippingHandler()(context.Background(), event)
}

func mustPayParcel(t *testing.T, svc *financial_account_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := payParcel(svc, event)
	if err != nil {
		t.Fatalf("deliver %s: %v", event.GetEventId(), err)
	}
}

// the-courier-is-paid-by-the-team-or-by-the-warehouse, *Kami bayar* — *as a warehouse transfer's shipping*
// (a-transfers-shipping-posts-as-an-expense): the courier cost leaves the team's paying account as ONE `expense` row
// naming the parcel, on the day the parcel was created, and the day's report carries it in its Expense column.
func TestCustomShipmentShipping_CreatedPostsTheCostAsAnExpense(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 982_000 {
		t.Fatalf("balance = %v, want 982000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 1 {
		t.Fatalf("%d expense rows, want 1", len(rows))
	}

	row := rows[0]
	if row.Change != -18_000 || row.BalanceAfter != 982_000 || row.Description != "Custom shipment #603 shipping" ||
		row.ActorID != ani || row.GroupID != 0 || row.CounterAccountID != 0 {
		t.Fatalf("row = %+v", row)
	}

	if row.OccurredAt.In(jakarta).Format("2006-01-02") != sentAt.Format("2006-01-02") {
		t.Fatalf("occurred = %v, want the day it was created, %s", row.OccurredAt, sentAt.Format("2006-01-02"))
	}

	var sentDay *m.FinancialAccountDailyReport

	for _, d := range daily(t, db, bcaA.GetId()) {
		if d.Day.Format("2006-01-02") == sentAt.Format("2006-01-02") {
			sentDay = &d
		}
	}

	if sentDay == nil || sentDay.Expense != -18_000 || sentDay.Restock != 0 {
		t.Fatalf("the day's report row = %+v, want expense −18000 and no restock", sentDay)
	}
}

// one-contract-for-both-handler-types: the same event twice (three times) is ONE row.
func TestCustomShipmentShipping_ARedeliveryPostsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	event := parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 18_000)
	for range 3 {
		mustPayParcel(t, svc, event)
	}

	if got := balance(t, db, bcaA.GetId()); got != 982_000 {
		t.Fatalf("balance = %v after redeliveries, want 982000", got)
	}

	if rows := expenseRows(t, db, bcaA.GetId()); len(rows) != 1 {
		t.Fatalf("%d expense rows, want 1", len(rows))
	}
}

// *Ubah Ongkir* on the same account posts only new − old — 18.000 corrected to 20.000 takes 2.000 more, a correction
// down gives back. Each edit is its own cost revision; a redelivered edit posts nothing new.
func TestCustomShipmentShipping_AnEditPostsOnlyTheDifference(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 18_000))
	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:1", bcaA.GetId(), bcaA.GetId(), 18_000, 20_000))

	if got := balance(t, db, bcaA.GetId()); got != 980_000 {
		t.Fatalf("balance = %v after 18.000 → 20.000, want 980000", got)
	}

	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:2", bcaA.GetId(), bcaA.GetId(), 20_000, 15_000))

	if got := balance(t, db, bcaA.GetId()); got != 985_000 {
		t.Fatalf("balance = %v after 20.000 → 15.000, want 985000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 3 || rows[1].Change != -2_000 || rows[2].Change != 5_000 ||
		rows[2].Description != "Custom shipment #603 shipping edited" {
		t.Fatalf("rows = %+v, want −18000, −2000, +5000", rows)
	}

	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:2", bcaA.GetId(), bcaA.GetId(), 20_000, 15_000))

	if got := balance(t, db, bcaA.GetId()); got != 985_000 {
		t.Fatalf("balance = %v after a redelivered edit, want 985000", got)
	}
}

// The cost is optional at create (the-custom-shipments-prototype-is-accepted): created with 0, then *Ubah Ongkir* names
// the cost — the whole cost leaves the account. Then set back to 0 with the account emptied: it all comes back.
func TestCustomShipmentShipping_ACostTypedLaterAndClearedAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 0))
	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:1", 0, bcaA.GetId(), 0, 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 982_000 {
		t.Fatalf("balance = %v after the cost was typed, want 982000", got)
	}

	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:2", bcaA.GetId(), 0, 18_000, 0))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v after the cost was cleared, want 1000000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 2 || rows[1].Change != 18_000 || rows[1].GroupID != 0 {
		t.Fatalf("rows = %+v, want −18000 then +18000 alone", rows)
	}
}

// An edit that moves the cost to another account of the team: the whole old cost back INTO the old account and the new
// cost OUT of the new one — two rows, one group, each naming the other account.
func TestCustomShipmentShipping_AnEditMovesTheCostToAnotherAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 500_000))

	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 18_000))
	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:1", bcaA.GetId(), box.GetId(), 18_000, 20_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("BCA = %v, want 1000000 — its payment came back whole", got)
	}

	if got := balance(t, db, box.GetId()); got != 480_000 {
		t.Fatalf("Cash = %v, want 480000 — it pays the new cost", got)
	}

	back := expenseRows(t, db, bcaA.GetId())
	out := expenseRows(t, db, box.GetId())

	if len(back) != 2 || len(out) != 1 {
		t.Fatalf("rows: BCA %d, Cash %d — want 2 and 1", len(back), len(out))
	}

	in, paid := back[1], out[0]
	if in.Change != 18_000 || in.CounterAccountID != box.GetId() || paid.Change != -20_000 || paid.CounterAccountID != bcaA.GetId() ||
		in.Description != "Custom shipment #603 shipping moved to another account" ||
		paid.Description != "Custom shipment #603 shipping moved from another account" {
		t.Fatalf("move rows = %+v / %+v", in, paid)
	}

	if in.GroupID == 0 || in.GroupID != paid.GroupID {
		t.Fatalf("groups %d/%d — the move is one act", in.GroupID, paid.GroupID)
	}
}

// a-custom-shipment-is-cancelled-only-while-requested: the cancel gives a *Kami bayar* parcel's posted cost back INTO the
// account that paid, once — the same cancel twice is one refund. A cancel of a parcel that cost nothing posts nothing and
// is still claimed.
func TestCustomShipmentShipping_ACancelRefundsOnlyWhatWasPosted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	bcaB := mustCreate(t, svc, bca(teamA, "BCA Ops 2", "9600000012", 1_000_000))

	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 18_000))
	mustPayParcel(t, svc, parcelCancelled("custom-shipment-cancelled:603", teamPays, bcaA.GetId(), 18_000))
	mustPayParcel(t, svc, parcelCancelled("custom-shipment-cancelled:603", teamPays, bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want 1000000 — paid, then refunded once", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 2 || rows[1].Change != 18_000 || rows[1].Description != "Custom shipment #603 shipping cancelled — money returned" {
		t.Fatalf("rows = %+v", rows)
	}

	mustPayParcel(t, svc, parcelCancelled("custom-shipment-cancelled:604", teamPays, 0, 0))

	if got := balance(t, db, bcaB.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want 1000000 — nothing was posted, nothing comes back", got)
	}

	if !claimed(t, db, "custom-shipment-cancelled:604") {
		t.Fatal("a cancel that posts nothing is still claimed")
	}
}

// ⚠ *GUDANG BAYAR* NEVER TOUCHES THE TEAM'S ACCOUNT. The warehouse pays the courier and is owed it back through Team
// Balance — so a warehouse-paid parcel's create and cancel post nothing, even when (against inventory's contract) the
// event carries the team's account and a cost. Each is ACKED and claimed.
func TestCustomShipmentShipping_AWarehousePaidParcelPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	for _, event := range []*eventsv1.Event{
		parcelCreated("custom-shipment-created:603", warehousePays, 0, 0),
		parcelCreated("custom-shipment-created:604", warehousePays, bcaA.GetId(), 18_000),
		parcelCancelled("custom-shipment-cancelled:604", warehousePays, bcaA.GetId(), 18_000),
	} {
		mustPayParcel(t, svc, event)

		if !claimed(t, db, event.GetEventId()) {
			t.Fatalf("%s posted nothing but was not claimed", event.GetEventId())
		}
	}

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want untouched — the warehouse pays a Gudang bayar courier", got)
	}

	if rows := expenseRows(t, db, bcaA.GetId()); len(rows) != 0 {
		t.Fatalf("%d expense rows for a warehouse-paid parcel, want 0", len(rows))
	}
}

// Nothing to move, nothing posted: a 0 cost, an edit that changed nothing paid, a move of a 0 cost, a cancel of 0 —
// each ACKED and claimed.
func TestCustomShipmentShipping_ZeroCostsPostNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 0))

	for _, event := range []*eventsv1.Event{
		parcelCreated("zero-created", teamPays, 0, 0),
		parcelCreated("zero-created-with-account", teamPays, bcaA.GetId(), 0),
		parcelCostUpdated("zero-same", bcaA.GetId(), bcaA.GetId(), 18_000, 18_000),
		parcelCostUpdated("zero-move", bcaA.GetId(), box.GetId(), 0, 0),
		parcelCancelled("zero-cancel", teamPays, bcaA.GetId(), 0),
	} {
		mustPayParcel(t, svc, event)

		if !claimed(t, db, event.GetEventId()) {
			t.Fatalf("%s posted nothing but was not claimed", event.GetEventId())
		}
	}

	if rows := expenseRows(t, db, bcaA.GetId()); len(rows) != 0 {
		t.Fatalf("%d expense rows for zero costs, want 0", len(rows))
	}

	if rows := expenseRows(t, db, box.GetId()); len(rows) != 0 {
		t.Fatalf("%d expense rows on the cash box, want 0", len(rows))
	}
}

// ⚠ AN ACCOUNT THAT IS NOT THE SELLING TEAM'S — the WAREHOUSE's own account included — OR DOES NOT EXIST, IS NOT FILED
// SOMEWHERE: it is refused (NACKed into the dead-letter queue), nothing posts, and the claim rolls back with it so a
// fixed redelivery still posts. The warehouse's books never carry the team's courier money.
func TestCustomShipmentShipping_AWrongOrMissingAccountIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	theirs := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9600000022", 1_000_000))
	mine := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	for _, event := range []*eventsv1.Event{
		parcelCreated("wrong-team", teamPays, theirs.GetId(), 18_000),
		parcelCreated("missing", teamPays, 99_999_999, 18_000),
		parcelCreated("no-account", teamPays, 0, 18_000),
		parcelCostUpdated("move-to-wrong-team", mine.GetId(), theirs.GetId(), 18_000, 18_000),
		parcelCostUpdated("edit-with-no-account", mine.GetId(), 0, 18_000, 20_000),
		parcelCancelled("cancel-to-wrong-team", teamPays, theirs.GetId(), 18_000),
	} {
		err := payParcel(svc, event)
		if err == nil {
			t.Fatalf("%s: delivered, want refused", event.GetEventId())
		}

		if claimed(t, db, event.GetEventId()) {
			t.Fatalf("%s: refused but claimed — its redelivery would post nothing", event.GetEventId())
		}
	}

	if got := balance(t, db, theirs.GetId()); got != 1_000_000 {
		t.Fatalf("the warehouse's account = %v, want untouched", got)
	}

	if got := balance(t, db, mine.GetId()); got != 1_000_000 {
		t.Fatalf("the team's own account = %v — a refused move must post neither leg", got)
	}

	mustPayParcel(t, svc, parcelCreated("no-account", teamPays, mine.GetId(), 18_000))

	if got := balance(t, db, mine.GetId()); got != 982_000 {
		t.Fatalf("balance = %v after the fixed redelivery, want 982000", got)
	}
}

// An archived account still takes its parcel's money (as the transfer's): refusing would dead-letter money that moved.
func TestCustomShipmentShipping_AnArchivedAccountStillPosts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 0))

	err := db.Model(&m.FinancialAccount{}).
		Where("id = ?", bcaA.GetId()).
		Update("status", m.StatusArchived).
		Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	mustPayParcel(t, svc, parcelCancelled("custom-shipment-cancelled:603", teamPays, bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 18_000 {
		t.Fatalf("archived account = %v, want 18000", got)
	}
}

// Every event carries its own delta, so ORDER DOES NOT MATTER: a cancel, then an edit that moved the cost, then the
// create, leave both accounts exactly where in-order delivery does.
func TestCustomShipmentShipping_OutOfOrderDeliveryEndsTheSame(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 1_000_000))

	mustPayParcel(t, svc, parcelCancelled("custom-shipment-cancelled:603", teamPays, box.GetId(), 20_000))
	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:2", box.GetId(), box.GetId(), 25_000, 20_000))
	mustPayParcel(t, svc, parcelCostUpdated("custom-shipment-cost-updated:603:1", bcaA.GetId(), box.GetId(), 18_000, 25_000))
	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("BCA = %v, want 1000000", got)
	}

	if got := balance(t, db, box.GetId()); got != 1_000_000 {
		t.Fatalf("Cash = %v, want 1000000 — paid after the move, edited down, refunded on cancel", got)
	}
}

// Custom shipment 603 and warehouse transfer 603 are two trips: their event ids differ, so neither claim swallows the
// other, and each row names its own source.
func TestCustomShipmentShipping_DoesNotCollideWithATransferOfTheSameNumber(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000))
	mustPayParcel(t, svc, parcelCreated("custom-shipment-created:603", teamPays, bcaA.GetId(), 7_000))

	if got := balance(t, db, bcaA.GetId()); got != 975_000 {
		t.Fatalf("balance = %v, want 975000 — the transfer's 18.000 and the parcel's 7.000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 2 || rows[0].Description != "Warehouse transfer #603 shipping" || rows[1].Description != "Custom shipment #603 shipping" {
		t.Fatalf("rows = %+v, want the transfer's row and the parcel's", rows)
	}
}

// A variant this listener does not post — Custom Shipment Handed Over, balance's — is acked and touches nothing.
func TestCustomShipmentShipping_AHandoverIsNotItsBusiness(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayParcel(t, svc, &eventsv1.Event{
		EventId:    "custom-shipment-handed-over:603",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_CustomShipmentHandedOver{CustomShipmentHandedOver: &eventsv1.CustomShipmentHandedOver{
			CustomShipmentId: parcelID, TeamId: teamA, WarehouseId: teamB, Payer: warehousePays, WarehouseCost: 5_000,
		}},
	})

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want untouched", got)
	}
}
