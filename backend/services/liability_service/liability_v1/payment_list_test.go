package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func paymentList(
	t *testing.T,
	svc *liability_v1.Service,
	teamID uint64,
	filter *liabilityv1.LiabilityPaymentListFilter,
) *liabilityv1.LiabilityPaymentListResponse {
	t.Helper()

	res, err := svc.LiabilityPaymentList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentListRequest{
			TeamId: teamID,
			Filter: filter,
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("LiabilityPaymentList(%d): %v", teamID, err)
	}

	return res.Msg
}

// BOTH DIRECTIONS IN ONE LIST. A payment is one relationship seen from two sides — making a manager
// visit two screens to answer "are we square" is how the question stops getting asked.
func TestPaymentList_ShowsPaymentsMadeAndReceived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	recordPayment(t, svc, selling, warehouse, 5000)
	recordPayment(t, svc, warehouse, selling, 3000)

	if n := len(paymentList(t, svc, selling, nil).GetIds()); n != 2 {
		t.Fatalf("%d payments, want 2 — the list shows only one direction", n)
	}
}

// ANOTHER PAIR'S PAYMENTS ARE INVISIBLE. The scope is "payments I am a party to", not "all payments".
func TestPaymentList_HidesOtherPairs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	recordPayment(t, svc, selling, warehouse, 5000)

	if n := len(paymentList(t, svc, productOwner, nil).GetIds()); n != 0 {
		t.Fatalf("an uninvolved team read %d payments, want 0", n)
	}
}

// ⚠ THE BADGE QUERY (Q10): only what THIS team must act on. A payment nobody notices is a debt that
// stays open for no reason — and a payment this team recorded is waiting on somebody ELSE, so it must
// never appear in its own inbox or the badge stops meaning anything.
func TestPaymentList_AwaitingMyConfirmationIsOnlyWhatIOwe(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	// One the warehouse must act on, one it recorded itself.
	incoming := recordPayment(t, svc, selling, warehouse, 5000)
	recordPayment(t, svc, warehouse, selling, 3000)

	msg := paymentList(t, svc, warehouse,
		&liabilityv1.LiabilityPaymentListFilter{AwaitingMyConfirmation: true})

	if len(msg.GetIds()) != 1 {
		t.Fatalf("%d payments awaiting confirmation, want 1 — the team's own claims are in its inbox",
			len(msg.GetIds()))
	}

	if msg.GetIds()[0] != incoming.GetId() {
		t.Fatalf("awaiting id = %d, want %d", msg.GetIds()[0], incoming.GetId())
	}
}

// A CONFIRMED PAYMENT LEAVES THE INBOX. It is done — leaving it there is how a badge becomes noise.
func TestPaymentList_ConfirmedLeavesTheInbox(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 5000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 5000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	msg := paymentList(t, svc, warehouse,
		&liabilityv1.LiabilityPaymentListFilter{AwaitingMyConfirmation: true})

	if len(msg.GetIds()) != 0 {
		t.Fatalf("%d still awaiting after confirming, want 0", len(msg.GetIds()))
	}
}

// ⚠ THE COUNTERPARTY FILTER MUST NARROW, NEVER WIDEN. The base scope is an OR over both sides, so an
// ungrouped counterparty clause would leak another pair's payments into this list.
func TestPaymentList_CounterpartyFilterNarrows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	recordPayment(t, svc, selling, warehouse, 5000)
	recordPayment(t, svc, selling, productOwner, 7000)

	msg := paymentList(t, svc, selling,
		&liabilityv1.LiabilityPaymentListFilter{CounterpartyId: warehouse})

	if len(msg.GetIds()) != 1 {
		t.Fatalf("%d payments for one counterparty, want 1 — the filter widened the scope",
			len(msg.GetIds()))
	}
}

// THE POSITION SCREEN'S BADGE COUNTS THE SAME THING THE INBOX LISTS. Answered inside the query the
// screen already makes, so the badge and the rows cannot disagree.
func TestPositionList_BadgeCountsWaitingPayments(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	recordPayment(t, svc, selling, warehouse, 5000)

	res, err := svc.LiabilityPositionList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId: warehouse,
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("LiabilityPositionList: %v", err)
	}

	if got := res.Msg.GetAwaitingConfirmation(); got != 1 {
		t.Fatalf("awaiting_confirmation = %d, want 1 — the creditor cannot see the waiting payment",
			got)
	}
}
