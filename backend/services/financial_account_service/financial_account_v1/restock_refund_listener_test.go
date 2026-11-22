package financial_account_v1_test

import (
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func restockRefunded(eventID string, account uint64, amount float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "restock:4201",
		Message: &eventsv1.Event_RestockRefunded{RestockRefunded: &eventsv1.RestockRefunded{
			RestockId: restockID, ResolutionId: 7, TeamId: teamA, FinanceAccountId: account,
			Amount: amount, ActorId: ani, RefundedAtUnix: time.Now().Unix(),
		}},
	}
}

// a-restock-problem-is-settled-by-resolution-rows (🔄 A, the refund names its account): a REFUND resolution's amount comes
// back INTO the account it names as a `restock` row naming the restock — the cancel's path (the
// ACancelRefundsOnlyWhenTheMoneyCameBack test's), its own row per refund; a redelivery posts once, a second refund posts
// its own; a refund of 0 posts nothing and is claimed; one with no account is refused.
func TestRestockPayment_ARefundResolutionComesBackIntoItsAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayRestock(t, svc, restockRefunded("restock-refunded:7", bcaA.GetId(), 25_000))
	mustPayRestock(t, svc, restockRefunded("restock-refunded:7", bcaA.GetId(), 25_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_025_000 {
		t.Fatalf("balance = %v, want 1025000 — refunded once", got)
	}

	rows := restockRows(t, db, bcaA.GetId())
	if len(rows) != 1 || rows[0].Change != 25_000 || rows[0].Description != "Restock #4201 refund" || rows[0].ActorID != ani ||
		rows[0].CounterAccountID != 0 {
		t.Fatalf("rows = %+v", rows)
	}

	mustPayRestock(t, svc, restockRefunded("restock-refunded:8", bcaA.GetId(), 5_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_030_000 {
		t.Fatalf("balance = %v after a second refund, want 1030000", got)
	}

	mustPayRestock(t, svc, restockRefunded("restock-refunded:9", bcaA.GetId(), 0))

	if !claimed(t, db, "restock-refunded:9") || len(restockRows(t, db, bcaA.GetId())) != 2 {
		t.Fatal("a refund of 0 posted, or was not claimed")
	}

	err := payRestock(svc, restockRefunded("restock-refunded:10", 0, 1_000))
	if err == nil {
		t.Fatal("a refund with no account was acked")
	}

	if claimed(t, db, "restock-refunded:10") {
		t.Fatal("a refused refund was claimed")
	}
}
