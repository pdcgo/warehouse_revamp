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

// raisedAt is when the restock was raised — three days back, so the day a row counts on is not today by accident.
var raisedAt = time.Now().In(jakarta).Add(-72 * time.Hour)

const restockID uint64 = 4_201

func restockCreated(eventID string, account uint64, amount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.New(raisedAt),
		AggregateId: "restock:4201",
		Message: &eventsv1.Event_RestockCreated{RestockCreated: &eventsv1.RestockCreated{
			RestockId: restockID, TeamId: teamA, WarehouseId: teamB, FinanceAccountId: account,
			Amount: amount, ActorId: ani, CreatedAtUnix: raisedAt.Unix(),
		}},
	}
}

func restockUpdated(eventID string, oldAccount, newAccount uint64, oldAmount, newAmount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "restock:4201",
		Message: &eventsv1.Event_RestockUpdated{RestockUpdated: &eventsv1.RestockUpdated{
			RestockId: restockID, TeamId: teamA,
			OldFinanceAccountId: oldAccount, NewFinanceAccountId: newAccount,
			OldAmount: oldAmount, NewAmount: newAmount,
			ActorId: ani, UpdatedAtUnix: time.Now().Unix(),
		}},
	}
}

func restockCancelled(eventID string, account uint64, amount float64, returned bool) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "restock:4201",
		Message: &eventsv1.Event_RestockCancelled{RestockCancelled: &eventsv1.RestockCancelled{
			RestockId: restockID, TeamId: teamA, FinanceAccountId: account,
			Amount: amount, MoneyReturned: returned, ActorId: ani, CancelledAtUnix: time.Now().Unix(),
		}},
	}
}

func payRestock(svc *financial_account_v1.Service, event *eventsv1.Event) error {
	return svc.RestockPaymentHandler()(context.Background(), event)
}

func mustPayRestock(t *testing.T, svc *financial_account_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := payRestock(svc, event)
	if err != nil {
		t.Fatalf("deliver %s: %v", event.GetEventId(), err)
	}
}

// restockRows is every `restock` row on an account, in entry order.
func restockRows(t *testing.T, db *gorm.DB, account uint64) []m.FinancialAccountLog {
	t.Helper()

	out := []m.FinancialAccountLog{}
	for _, row := range logs(t, db, account) {
		if row.ChangeType == m.ChangeRestock {
			out = append(out, row)
		}
	}

	return out
}

// claimed says whether the listener recorded an event as handled.
func claimed(t *testing.T, db *gorm.DB, eventID string) bool {
	t.Helper()

	var n int64

	err := db.Table(m.EventLogTable).Where("event_id = ?", eventID).Count(&n).Error
	if err != nil {
		t.Fatalf("read claim: %v", err)
	}

	return n == 1
}

// a-created-restock-tells-the-financial-account: the whole amount — goods plus shipping — leaves the paying account as
// ONE `restock` row, on the day the restock was raised, naming the restock and the person who raised it.
func TestRestockPayment_CreatedPostsTheAmountOutOfThePayingAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayRestock(t, svc, restockCreated("restock-created:4201", bcaA.GetId(), 120_000))

	if got := balance(t, db, bcaA.GetId()); got != 880_000 {
		t.Fatalf("balance = %v, want 880000", got)
	}

	rows := restockRows(t, db, bcaA.GetId())
	if len(rows) != 1 {
		t.Fatalf("%d restock rows, want 1", len(rows))
	}

	row := rows[0]
	if row.Change != -120_000 || row.BalanceAfter != 880_000 || row.Description != "Restock #4201" || row.ActorID != ani ||
		row.GroupID != 0 || row.CounterAccountID != 0 {
		t.Fatalf("row = %+v", row)
	}

	if row.OccurredAt.In(jakarta).Format("2006-01-02") != raisedAt.Format("2006-01-02") {
		t.Fatalf("occurred = %v, want the day it was raised, %s", row.OccurredAt, raisedAt.Format("2006-01-02"))
	}

	// The day's report row carries it in its own column (the-daily-row-is-written-with-the-log-row).
	var restockDay *m.FinancialAccountDailyReport

	for _, d := range daily(t, db, bcaA.GetId()) {
		if d.Day.Format("2006-01-02") == raisedAt.Format("2006-01-02") {
			restockDay = &d
		}
	}

	if restockDay == nil || restockDay.Restock != -120_000 {
		t.Fatalf("the day's report row = %+v, want restock −120000", restockDay)
	}
}

// one-contract-for-both-handler-types: a redelivered create posts ONCE — the restock is not paid twice.
func TestRestockPayment_ARedeliveryPostsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	event := restockCreated("restock-created:4201", bcaA.GetId(), 120_000)
	for range 3 {
		mustPayRestock(t, svc, event)
	}

	if got := balance(t, db, bcaA.GetId()); got != 880_000 {
		t.Fatalf("balance = %v after redeliveries, want 880000", got)
	}

	if rows := restockRows(t, db, bcaA.GetId()); len(rows) != 1 {
		t.Fatalf("%d restock rows, want 1", len(rows))
	}
}

// an-edit-sends-the-difference: an edit on the same account posts only new − old — up costs more, down gives back.
func TestRestockPayment_AnEditPostsOnlyTheDifference(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayRestock(t, svc, restockCreated("restock-created:4201", bcaA.GetId(), 100_000))
	mustPayRestock(t, svc, restockUpdated("restock-updated:4201:1", bcaA.GetId(), bcaA.GetId(), 100_000, 120_000))

	if got := balance(t, db, bcaA.GetId()); got != 880_000 {
		t.Fatalf("balance = %v after 100.000 → 120.000, want 880000", got)
	}

	mustPayRestock(t, svc, restockUpdated("restock-updated:4201:2", bcaA.GetId(), bcaA.GetId(), 120_000, 90_000))

	if got := balance(t, db, bcaA.GetId()); got != 910_000 {
		t.Fatalf("balance = %v after 120.000 → 90.000, want 910000", got)
	}

	rows := restockRows(t, db, bcaA.GetId())
	if len(rows) != 3 || rows[1].Change != -20_000 || rows[2].Change != 30_000 || rows[2].Description != "Restock #4201 edited" {
		t.Fatalf("rows = %+v, want −100000, −20000, +30000", rows)
	}

	// The second edit redelivered: nothing new.
	mustPayRestock(t, svc, restockUpdated("restock-updated:4201:2", bcaA.GetId(), bcaA.GetId(), 120_000, 90_000))

	if got := balance(t, db, bcaA.GetId()); got != 910_000 {
		t.Fatalf("balance = %v after a redelivered edit, want 910000", got)
	}
}

// an-edit-may-move-the-payment-to-another-account: the whole old amount back INTO the old account and the new amount
// OUT of the new one — two rows, one group, each naming the other account.
func TestRestockPayment_AnEditMovesThePaymentToAnotherAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 500_000))

	mustPayRestock(t, svc, restockCreated("restock-created:4201", bcaA.GetId(), 120_000))
	// BCA → Cash, and the amount changed too: BCA gets back what it paid, Cash pays the new amount.
	mustPayRestock(t, svc, restockUpdated("restock-updated:4201:1", bcaA.GetId(), box.GetId(), 120_000, 130_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("BCA = %v, want 1000000 — its payment came back whole", got)
	}

	if got := balance(t, db, box.GetId()); got != 370_000 {
		t.Fatalf("Cash = %v, want 370000 — it pays the new amount", got)
	}

	back := restockRows(t, db, bcaA.GetId())
	out := restockRows(t, db, box.GetId())

	if len(back) != 2 || len(out) != 1 {
		t.Fatalf("rows: BCA %d, Cash %d — want 2 and 1", len(back), len(out))
	}

	in, paid := back[1], out[0]
	if in.Change != 120_000 || in.CounterAccountID != box.GetId() || paid.Change != -130_000 || paid.CounterAccountID != bcaA.GetId() {
		t.Fatalf("move rows = %+v / %+v", in, paid)
	}

	if in.GroupID == 0 || in.GroupID != paid.GroupID {
		t.Fatalf("groups %d/%d — the move is one act", in.GroupID, paid.GroupID)
	}
}

// a-restock-names-its-paying-account: a cancel with the money returned refunds the amount INTO the account that paid; a
// cancel without posts nothing.
func TestRestockPayment_ACancelRefundsOnlyWhenTheMoneyCameBack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	bcaB := mustCreate(t, svc, bca(teamA, "BCA Ops 2", "9600000012", 1_000_000))

	mustPayRestock(t, svc, restockCreated("restock-created:4201", bcaA.GetId(), 120_000))
	mustPayRestock(t, svc, restockCancelled("restock-cancelled:4201", bcaA.GetId(), 120_000, true))
	mustPayRestock(t, svc, restockCancelled("restock-cancelled:4201", bcaA.GetId(), 120_000, true))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want 1000000 — paid, then refunded once", got)
	}

	rows := restockRows(t, db, bcaA.GetId())
	if len(rows) != 2 || rows[1].Change != 120_000 || rows[1].Description != "Restock #4201 cancelled — money returned" {
		t.Fatalf("rows = %+v", rows)
	}

	// Not returned: nothing posts, and the event is claimed so its redelivery is answered too.
	mustPayRestock(t, svc, restockCancelled("restock-cancelled:4202", bcaB.GetId(), 80_000, false))

	if got := balance(t, db, bcaB.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want 1000000 — the money did not come back", got)
	}

	if !claimed(t, db, "restock-cancelled:4202") {
		t.Fatal("a cancel that posts nothing is still claimed")
	}
}

// Nothing to move, nothing posted: a 0 restock, an edit that changed no amount, a cancel of 0 — each ACKED and claimed.
func TestRestockPayment_ZeroAmountsPostNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 0))

	for _, event := range []*eventsv1.Event{
		restockCreated("zero-created", bcaA.GetId(), 0),
		restockUpdated("zero-same", bcaA.GetId(), bcaA.GetId(), 50_000, 50_000),
		// A move of a restock that cost nothing.
		restockUpdated("zero-move", bcaA.GetId(), box.GetId(), 0, 0),
		restockCancelled("zero-cancel", bcaA.GetId(), 0, true),
	} {
		mustPayRestock(t, svc, event)

		if !claimed(t, db, event.GetEventId()) {
			t.Fatalf("%s posted nothing but was not claimed", event.GetEventId())
		}
	}

	if rows := restockRows(t, db, bcaA.GetId()); len(rows) != 0 {
		t.Fatalf("%d restock rows for zero amounts, want 0", len(rows))
	}

	if rows := restockRows(t, db, box.GetId()); len(rows) != 0 {
		t.Fatalf("%d restock rows on the cash box, want 0", len(rows))
	}
}

// ⚠ AN ACCOUNT THAT IS NOT THE RESTOCK TEAM'S, OR DOES NOT EXIST, IS NOT FILED SOMEWHERE — it is refused (NACKed into the
// dead-letter queue), nothing posts, and the claim rolls back with it so a fixed redelivery still posts.
func TestRestockPayment_AWrongOrMissingAccountIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	theirs := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9600000022", 1_000_000))
	mine := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	for _, event := range []*eventsv1.Event{
		restockCreated("wrong-team", theirs.GetId(), 50_000),
		restockCreated("missing", 99_999_999, 50_000),
		restockCreated("no-account", 0, 50_000),
		restockUpdated("move-to-wrong-team", mine.GetId(), theirs.GetId(), 50_000, 50_000),
	} {
		err := payRestock(svc, event)
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
}

// An archived account still takes its restock's money (my spec, as for a withdrawal): refusing would dead-letter money
// that moved. And an `unknown` account is an account like any other here.
func TestRestockPayment_AnArchivedAccountStillPosts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 0))

	err := db.Model(&m.FinancialAccount{}).Where("id = ?", bcaA.GetId()).Update("status", m.StatusArchived).Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	mustPayRestock(t, svc, restockCancelled("restock-cancelled:4201", bcaA.GetId(), 40_000, true))

	if got := balance(t, db, bcaA.GetId()); got != 40_000 {
		t.Fatalf("archived account = %v, want 40000", got)
	}
}

// Every event carries its own delta, so ORDER DOES NOT MATTER: an edit and a cancel delivered before the create leave
// the account exactly where in-order delivery does.
func TestRestockPayment_OutOfOrderDeliveryEndsTheSame(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))
	box := mustCreate(t, svc, cash(teamA, "Kas Toko", 1_000_000))

	mustPayRestock(t, svc, restockCancelled("restock-cancelled:4201", box.GetId(), 130_000, true))
	mustPayRestock(t, svc, restockUpdated("restock-updated:4201:1", bcaA.GetId(), box.GetId(), 120_000, 130_000))
	mustPayRestock(t, svc, restockCreated("restock-created:4201", bcaA.GetId(), 120_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("BCA = %v, want 1000000", got)
	}

	if got := balance(t, db, box.GetId()); got != 1_000_000 {
		t.Fatalf("Cash = %v, want 1000000 — paid after the move, refunded on cancel", got)
	}
}

// ⚠ my spec — a restock raised before *Paid from* existed (old account 0): its payment predates the ledger, so naming an
// account on its first edit posts only the DIFFERENCE there, and a refunded cancel with no account posts nothing.
func TestRestockPayment_ARestockFromBeforeTheAccountPostsOnlyWhatChanged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayRestock(t, svc, restockUpdated("restock-updated:4201:1", 0, bcaA.GetId(), 100_000, 120_000))

	if got := balance(t, db, bcaA.GetId()); got != 980_000 {
		t.Fatalf("balance = %v, want 980000 — only the 20.000 the edit added", got)
	}

	mustPayRestock(t, svc, restockCancelled("restock-cancelled:4209", 0, 50_000, true))

	if !claimed(t, db, "restock-cancelled:4209") {
		t.Fatal("a refund with no account to land in is acked and claimed, not dead-lettered")
	}
}
