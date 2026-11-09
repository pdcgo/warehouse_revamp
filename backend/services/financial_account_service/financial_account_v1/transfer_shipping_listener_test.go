package financial_account_v1_test

import (
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// sentAt is when the transfer was opened — two days back, so the day a row counts on is not today by accident.
var sentAt = time.Now().In(jakarta).Add(-48 * time.Hour)

const transferID uint64 = 603

func transferCreated(eventID string, account uint64, amount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.New(sentAt),
		AggregateId: "warehouse-transfer:603",
		Message: &eventsv1.Event_WarehouseTransferCreated{WarehouseTransferCreated: &eventsv1.WarehouseTransferCreated{
			TransferId: transferID, TeamId: teamA, FromWarehouseId: teamB, ToWarehouseId: teamB + 1,
			FinanceAccountId: account, Amount: amount, ActorId: ani, CreatedAtUnix: sentAt.Unix(),
		}},
	}
}

func transferUpdated(eventID string, oldAccount, newAccount uint64, oldAmount, newAmount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "warehouse-transfer:603",
		Message: &eventsv1.Event_WarehouseTransferUpdated{WarehouseTransferUpdated: &eventsv1.WarehouseTransferUpdated{
			TransferId: transferID, TeamId: teamA,
			OldFinanceAccountId: oldAccount, NewFinanceAccountId: newAccount,
			OldAmount: oldAmount, NewAmount: newAmount,
			ActorId: ani, UpdatedAtUnix: time.Now().Unix(),
		}},
	}
}

func transferCancelled(eventID string, account uint64, amount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "warehouse-transfer:603",
		Message: &eventsv1.Event_WarehouseTransferCancelled{WarehouseTransferCancelled: &eventsv1.WarehouseTransferCancelled{
			TransferId: transferID, TeamId: teamA, FinanceAccountId: account,
			Amount: amount, ActorId: ani, CancelledAtUnix: time.Now().Unix(),
		}},
	}
}

func payShipping(svc *financial_account_v1.Service, event *eventsv1.Event) error {
	return svc.TransferShippingHandler()(context.Background(), event)
}

func mustPayShipping(t *testing.T, svc *financial_account_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := payShipping(svc, event)
	if err != nil {
		t.Fatalf("deliver %s: %v", event.GetEventId(), err)
	}
}

// expenseRows is every `expense` row on an account, in entry order.
func expenseRows(t *testing.T, db *gorm.DB, account uint64) []m.FinancialAccountLog {
	t.Helper()

	out := []m.FinancialAccountLog{}
	for _, row := range logs(t, db, account) {
		if row.ChangeType == m.ChangeExpense {
			out = append(out, row)
		}
	}

	return out
}

// a-transfers-shipping-posts-as-an-expense: the shipping cost leaves the paying account as ONE `expense` row naming the
// transfer, on the day the transfer was opened, and the day's report carries it in its Expense column.
func TestTransferShipping_CreatedPostsTheCostAsAnExpense(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 982_000 {
		t.Fatalf("balance = %v, want 982000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 1 {
		t.Fatalf("%d expense rows, want 1", len(rows))
	}

	row := rows[0]
	if row.Change != -18_000 || row.BalanceAfter != 982_000 || row.Description != "Warehouse transfer #603 shipping" ||
		row.ActorID != ani || row.GroupID != 0 || row.CounterAccountID != 0 {
		t.Fatalf("row = %+v", row)
	}

	if row.OccurredAt.In(jakarta).Format("2006-01-02") != sentAt.Format("2006-01-02") {
		t.Fatalf("occurred = %v, want the day it was opened, %s", row.OccurredAt, sentAt.Format("2006-01-02"))
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

// one-contract-for-both-handler-types: a redelivered create posts ONCE.
func TestTransferShipping_ARedeliveryPostsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	event := transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000)
	for range 3 {
		mustPayShipping(t, svc, event)
	}

	if got := balance(t, db, bcaA.GetId()); got != 982_000 {
		t.Fatalf("balance = %v after redeliveries, want 982000", got)
	}

	if rows := expenseRows(t, db, bcaA.GetId()); len(rows) != 1 {
		t.Fatalf("%d expense rows, want 1", len(rows))
	}
}

// the-shipping-expense-reaches-the-account-by-event: an edit on the same account posts only new − old — the decision's
// own example, Rp 18.000 corrected to Rp 20.000, takes Rp 2.000 more; a correction down gives back. Each edit is its
// own cost revision, so two edits never share a claim.
func TestTransferShipping_AnEditPostsOnlyTheDifference(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000))
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:1", bcaA.GetId(), bcaA.GetId(), 18_000, 20_000))

	if got := balance(t, db, bcaA.GetId()); got != 980_000 {
		t.Fatalf("balance = %v after 18.000 → 20.000, want 980000", got)
	}

	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:2", bcaA.GetId(), bcaA.GetId(), 20_000, 15_000))

	if got := balance(t, db, bcaA.GetId()); got != 985_000 {
		t.Fatalf("balance = %v after 20.000 → 15.000, want 985000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 3 || rows[1].Change != -2_000 || rows[2].Change != 5_000 ||
		rows[2].Description != "Warehouse transfer #603 shipping edited" {
		t.Fatalf("rows = %+v, want −18000, −2000, +5000", rows)
	}

	// The second edit redelivered: nothing new.
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:2", bcaA.GetId(), bcaA.GetId(), 20_000, 15_000))

	if got := balance(t, db, bcaA.GetId()); got != 985_000 {
		t.Fatalf("balance = %v after a redelivered edit, want 985000", got)
	}
}

// The cost typed after A packed (the decision's diagram): created with no cost and no account, then an edit names the
// account and the cost — the whole cost leaves it. Then set back to 0: the account gets it all back.
func TestTransferShipping_ACostTypedLaterAndClearedAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", 0, 0))
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:1", 0, bcaA.GetId(), 0, 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 982_000 {
		t.Fatalf("balance = %v after the cost was typed, want 982000", got)
	}

	// Cleared: inventory empties the account with the cost.
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:2", bcaA.GetId(), 0, 18_000, 0))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v after the cost was cleared, want 1000000", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 2 || rows[1].Change != 18_000 || rows[1].GroupID != 0 {
		t.Fatalf("rows = %+v, want −18000 then +18000 alone", rows)
	}
}

// an-edit-may-move-the-payment-to-another-account: the whole old cost back INTO the old account and the new cost OUT of
// the new one — two rows, one group, each naming the other account.
func TestTransferShipping_AnEditMovesTheCostToAnotherAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 500_000))

	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000))
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:1", bcaA.GetId(), box.GetId(), 18_000, 20_000))

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
		in.Description != "Warehouse transfer #603 shipping moved to another account" ||
		paid.Description != "Warehouse transfer #603 shipping moved from another account" {
		t.Fatalf("move rows = %+v / %+v", in, paid)
	}

	if in.GroupID == 0 || in.GroupID != paid.GroupID {
		t.Fatalf("groups %d/%d — the move is one act", in.GroupID, paid.GroupID)
	}
}

// the-shipping-expense-reaches-the-account-by-event, *a cancel*: its event returns whatever was posted — the cost back
// INTO the account that paid, once. A cancel of a transfer that cost nothing (the event carries 0, no account) posts
// nothing and is still claimed.
func TestTransferShipping_ACancelRefundsOnlyWhatWasPosted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	bcaB := mustCreate(t, svc, bca(teamA, "BCA Ops 2", "9600000012", 1_000_000))

	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000))
	mustPayShipping(t, svc, transferCancelled("warehouse-transfer-cancelled:603", bcaA.GetId(), 18_000))
	mustPayShipping(t, svc, transferCancelled("warehouse-transfer-cancelled:603", bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want 1000000 — paid, then refunded once", got)
	}

	rows := expenseRows(t, db, bcaA.GetId())
	if len(rows) != 2 || rows[1].Change != 18_000 || rows[1].Description != "Warehouse transfer #603 shipping cancelled — money returned" {
		t.Fatalf("rows = %+v", rows)
	}

	// Nothing was posted for transfer 604's trip: nothing comes back, and the event is claimed.
	mustPayShipping(t, svc, transferCancelled("warehouse-transfer-cancelled:604", 0, 0))

	if got := balance(t, db, bcaB.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want 1000000 — nothing was posted, nothing comes back", got)
	}

	if !claimed(t, db, "warehouse-transfer-cancelled:604") {
		t.Fatal("a cancel that posts nothing is still claimed")
	}
}

// Nothing to move, nothing posted: a 0 trip, an edit that changed only the note's neighbour, a move of a 0 cost, a
// cancel of 0 — each ACKED and claimed.
func TestTransferShipping_ZeroCostsPostNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 0))

	for _, event := range []*eventsv1.Event{
		transferCreated("zero-created", 0, 0),
		transferCreated("zero-created-with-account", bcaA.GetId(), 0),
		transferUpdated("zero-same", bcaA.GetId(), bcaA.GetId(), 18_000, 18_000),
		transferUpdated("zero-move", bcaA.GetId(), box.GetId(), 0, 0),
		transferCancelled("zero-cancel", bcaA.GetId(), 0),
	} {
		mustPayShipping(t, svc, event)

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

// ⚠ AN ACCOUNT THAT IS NOT THE SELLING TEAM'S, OR DOES NOT EXIST, IS NOT FILED SOMEWHERE — it is refused (NACKed into
// the dead-letter queue), nothing posts, and the claim rolls back with it so a fixed redelivery still posts.
func TestTransferShipping_AWrongOrMissingAccountIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	theirs := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9600000022", 1_000_000))
	mine := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	for _, event := range []*eventsv1.Event{
		transferCreated("wrong-team", theirs.GetId(), 18_000),
		transferCreated("missing", 99_999_999, 18_000),
		transferCreated("no-account", 0, 18_000),
		transferUpdated("move-to-wrong-team", mine.GetId(), theirs.GetId(), 18_000, 18_000),
		transferUpdated("edit-with-no-account", mine.GetId(), 0, 18_000, 20_000),
		transferCancelled("cancel-to-wrong-team", theirs.GetId(), 18_000),
	} {
		err := payShipping(svc, event)
		if err == nil {
			t.Fatalf("%s: delivered, want refused", event.GetEventId())
		}

		if claimed(t, db, event.GetEventId()) {
			t.Fatalf("%s: refused but claimed — its redelivery would post nothing", event.GetEventId())
		}
	}

	if got := balance(t, db, theirs.GetId()); got != 1_000_000 {
		t.Fatalf("the other team's account = %v, want untouched", got)
	}

	if got := balance(t, db, mine.GetId()); got != 1_000_000 {
		t.Fatalf("the team's own account = %v — a refused move must post neither leg", got)
	}

	// The fixed redelivery of a refused event still posts: the claim rolled back with the refusal.
	mustPayShipping(t, svc, transferCreated("no-account", mine.GetId(), 18_000))

	if got := balance(t, db, mine.GetId()); got != 982_000 {
		t.Fatalf("balance = %v after the fixed redelivery, want 982000", got)
	}
}

// An archived account still takes its transfer's money (my spec, as the restock's): refusing would dead-letter money
// that moved.
func TestTransferShipping_AnArchivedAccountStillPosts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 0))

	err := db.Model(&m.FinancialAccount{}).Where("id = ?", bcaA.GetId()).Update("status", m.StatusArchived).Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	mustPayShipping(t, svc, transferCancelled("warehouse-transfer-cancelled:603", bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 18_000 {
		t.Fatalf("archived account = %v, want 18000", got)
	}
}

// Every event carries its own delta, so ORDER DOES NOT MATTER: a cancel, then an edit that moved the cost, then the
// create, leave both accounts exactly where in-order delivery does.
func TestTransferShipping_OutOfOrderDeliveryEndsTheSame(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 1_000_000))

	mustPayShipping(t, svc, transferCancelled("warehouse-transfer-cancelled:603", box.GetId(), 20_000))
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:2", box.GetId(), box.GetId(), 25_000, 20_000))
	mustPayShipping(t, svc, transferUpdated("warehouse-transfer-updated:603:1", bcaA.GetId(), box.GetId(), 18_000, 25_000))
	mustPayShipping(t, svc, transferCreated("warehouse-transfer-created:603", bcaA.GetId(), 18_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("BCA = %v, want 1000000", got)
	}

	if got := balance(t, db, box.GetId()); got != 1_000_000 {
		t.Fatalf("Cash = %v, want 1000000 — paid after the move, edited down, refunded on cancel", got)
	}
}

// A variant this listener does not post — Warehouse Transfer Accepted, balance's — is acked and touches nothing.
func TestTransferShipping_AnAcceptIsNotItsBusiness(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayShipping(t, svc, &eventsv1.Event{
		EventId:    "warehouse-transfer-accepted:603",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_WarehouseTransferAccepted{WarehouseTransferAccepted: &eventsv1.WarehouseTransferAccepted{
			TransferId: transferID, TeamId: teamA, WarehouseAdditionalCost: 5_000,
		}},
	})

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want untouched", got)
	}
}
