package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// acceptedAt is when the creditor accepted — two days back, so the day the rows count on is not today by accident.
var acceptedAt = time.Now().In(jakarta).Add(-48 * time.Hour)

func acceptedEvent(eventID string, payment, from, to uint64, amount int64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.New(acceptedAt),
		AggregateId: "liability-payment:1",
		Message: &eventsv1.Event_LiabilityPaymentAccepted{LiabilityPaymentAccepted: &eventsv1.LiabilityPaymentAccepted{
			PaymentId:      payment,
			PayerTeamId:    teamA,
			CreditorTeamId: teamB,
			Amount:         amount,
			FromAccountId:  from,
			ToAccountId:    to,
			ActorId:        ani,
		}},
	}
}

func accept(svc *financial_account_v1.Service, event *eventsv1.Event) error {
	return svc.TeamPaymentHandler()(context.Background(), event)
}

// a-team-payment-posts-on-accept: one `team_payment` row OUT of the payer's account and one INTO the creditor's,
// one group, on the day the creditor accepted — two teams' books, one act.
func TestTeamPayment_PostsOutOfThePayerAndIntoTheCreditor(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	payer := mustCreate(t, svc, bca(teamA, "BCA Seller", "9500000011", 1_000_000))
	creditor := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9500000022", 0))

	err := accept(svc, acceptedEvent("evt-tp-1", 7, payer.GetId(), creditor.GetId(), 250_000))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if got := balance(t, db, payer.GetId()); got != 750_000 {
		t.Fatalf("payer balance = %v, want 750000", got)
	}

	if got := balance(t, db, creditor.GetId()); got != 250_000 {
		t.Fatalf("creditor balance = %v, want 250000", got)
	}

	out := logs(t, db, payer.GetId())
	in := logs(t, db, creditor.GetId())
	outRow, inRow := out[len(out)-1], in[len(in)-1]

	if outRow.ChangeType != m.ChangeTeamPayment || outRow.Change != -250_000 || outRow.TeamID != teamA ||
		outRow.Description != fmt.Sprintf("Team payment #7 to team #%d", teamB) || outRow.CounterAccountID != creditor.GetId() {
		t.Fatalf("out row = %+v", outRow)
	}

	if inRow.ChangeType != m.ChangeTeamPayment || inRow.Change != 250_000 || inRow.TeamID != teamB ||
		inRow.Description != fmt.Sprintf("Team payment #7 from team #%d", teamA) || inRow.CounterAccountID != payer.GetId() {
		t.Fatalf("in row = %+v", inRow)
	}

	if outRow.GroupID == 0 || outRow.GroupID != inRow.GroupID {
		t.Fatalf("groups = %d/%d — the two legs of one payment share one", outRow.GroupID, inRow.GroupID)
	}

	for _, row := range []m.FinancialAccountLog{outRow, inRow} {
		if row.ActorID != ani {
			t.Fatalf("actor = %d, want the person who accepted", row.ActorID)
		}

		if row.OccurredAt.In(jakarta).Format("2006-01-02") != acceptedAt.Format("2006-01-02") {
			t.Fatalf("occurred = %v, want the accept day %s", row.OccurredAt, acceptedAt.Format("2006-01-02"))
		}
	}
}

// one-contract-for-both-handler-types: a redelivered acceptance posts ONCE — the transfer is not paid twice.
func TestTeamPayment_ARedeliveryPostsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	payer := mustCreate(t, svc, bca(teamA, "BCA Seller", "9500000011", 1_000_000))
	creditor := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9500000022", 0))

	event := acceptedEvent("evt-tp-dup", 8, payer.GetId(), creditor.GetId(), 100_000)

	for range 2 {
		if err := accept(svc, event); err != nil {
			t.Fatalf("accept: %v", err)
		}
	}

	if got := balance(t, db, creditor.GetId()); got != 100_000 {
		t.Fatalf("creditor balance = %v after a redelivery, want 100000", got)
	}
}

// A payment recorded before *Paid from* existed names no account it left: only the creditor's leg posts (my spec).
func TestTeamPayment_WithNoPayerAccountOnlyTheCreditorLegPosts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	creditor := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9500000022", 0))

	err := accept(svc, acceptedEvent("evt-tp-old", 9, 0, creditor.GetId(), 40_000))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	rows := logs(t, db, creditor.GetId())
	last := rows[len(rows)-1]

	if last.ChangeType != m.ChangeTeamPayment || last.Change != 40_000 || last.CounterAccountID != 0 {
		t.Fatalf("in row = %+v", last)
	}

	var count int64
	db.Model(&m.FinancialAccountLog{}).Where("group_id = ?", last.GroupID).Count(&count)

	if count != 1 {
		t.Fatalf("%d rows in the payment's group, want only the creditor's", count)
	}
}

// ⚠ AN ACCOUNT THE EVENT PUTS IN THE WRONG TEAM IS NOT FILED SOMEWHERE — it is refused and dead-lettered, and
// nothing posts. Liability asked before recording and accepting, so this is a bug worth a person looking at.
func TestTeamPayment_AnAccountOfTheWrongTeamPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	payer := mustCreate(t, svc, bca(teamA, "BCA Seller", "9500000011", 1_000_000))
	other := mustCreate(t, svc, bca(teamA, "BCA Seller 2", "9500000033", 0))

	// `to` is the payer team's own second account, where the creditor's was expected.
	err := accept(svc, acceptedEvent("evt-tp-wrong", 10, payer.GetId(), other.GetId(), 50_000))
	if err == nil {
		t.Fatal("an acceptance landing in another team's account was posted")
	}

	if got := balance(t, db, payer.GetId()); got != 1_000_000 {
		t.Fatalf("payer balance = %v, want untouched 1000000", got)
	}

	if got := balance(t, db, other.GetId()); got != 0 {
		t.Fatalf("other balance = %v, want untouched 0", got)
	}
}

// Liability is not trusted to send a sane payment: no account to land in is an error, never a silent ACK.
func TestTeamPayment_NoAccountToLandInIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	if err := accept(svc, acceptedEvent("evt-tp-nowhere", 11, 0, 0, 50_000)); err == nil {
		t.Fatal("an acceptance with nowhere to land was acked")
	}
}
