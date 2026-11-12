package liability_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
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
	svc := liability_v1.NewService(db, nil, nil, nil)

	// Selling owed and paid; later the pair turned and the warehouse owed and paid — only the team that owes records
	// a payment (the-debtor-claims-the-creditor-decides), so each claim is made while its payer owes.
	owes(t, svc, db, selling, warehouse, 5000, 1)

	paid := recordPayment(t, svc, selling, warehouse, 5000)

	_, err := confirmPayment(t, svc, warehouse, paid.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	owes(t, svc, db, warehouse, selling, 3000, 2)
	recordPayment(t, svc, warehouse, selling, 3000)

	if n := len(paymentList(t, svc, selling, nil).GetIds()); n != 2 {
		t.Fatalf("%d payments, want 2 — the list shows only one direction", n)
	}
}

// ANOTHER PAIR'S PAYMENTS ARE INVISIBLE. The scope is "payments I am a party to", not "all payments".
func TestPaymentList_HidesOtherPairs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	oweThem(t, svc, db, 5000, 1)
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
	svc := liability_v1.NewService(db, nil, nil, nil)

	// One the warehouse recorded itself while it owed 3.000, then — the pair turned to selling owing 5.000 net — one it
	// must act on. Each claim is made while its payer owes (the-debtor-claims-the-creditor-decides).
	owes(t, svc, db, warehouse, selling, 3000, 1)
	recordPayment(t, svc, warehouse, selling, 3000)

	owes(t, svc, db, selling, warehouse, 8000, 2)
	incoming := recordPayment(t, svc, selling, warehouse, 5000)

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
	svc := liability_v1.NewService(db, nil, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil, nil)

	owes(t, svc, db, selling, warehouse, 5000, 1)
	owes(t, svc, db, selling, productOwner, 7000, 2)
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
	svc := liability_v1.NewService(db, nil, nil, nil)

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

// ── the period and the side run BEFORE THE PAGE (backlog #34) ───────────────────────────────────────────────────

// seedPayment writes a payment row as it stands, recorded at `at` — the list reads rows, and the record's own rules
// (only the debtor, proof, an account) are its tests' business, not this one's.
func seedPayment(t *testing.T, db *gorm.DB, payer, creditor uint64, at time.Time) uint64 {
	t.Helper()

	row := liability_service_models.LiabilityPayment{
		PayerTeamID: payer, CreditorTeamID: creditor, Amount: 1000, Status: "recorded", CreatedAt: at,
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("seed payment: %v", err)
	}

	return row.ID
}

func paymentsPage(
	t *testing.T,
	svc *liability_v1.Service,
	filter *liabilityv1.LiabilityPaymentListFilter,
) *liabilityv1.LiabilityPaymentListResponse {
	t.Helper()

	filter.CounterpartyId = warehouse

	return paymentList(t, svc, selling, filter)
}

// ⛔ THE BUG #34 RETIRES, on the payment tabs. My payments and Their payments were one 50-row read cut in the browser:
// the one payment the warehouse made sits under 60 newer ones `selling` made, so Their payments drew EMPTY. Each side is
// its own page now — and its own count.
func TestPaymentList_EachSideIsItsOwnPage(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	at := time.Now()
	received := seedPayment(t, db, warehouse, selling, at)

	for i := 0; i < 60; i++ {
		seedPayment(t, db, selling, warehouse, at)
	}

	theirs := paymentsPage(t, svc, &liabilityv1.LiabilityPaymentListFilter{
		Side: liabilityv1.LiabilityPaymentSide_LIABILITY_PAYMENT_SIDE_RECEIVED,
	})
	if ids := theirs.GetIds(); len(ids) != 1 || ids[0] != received || theirs.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("their payments = %v (total %d), want [%d]", ids, theirs.GetPageInfo().GetTotalItems(), received)
	}

	mine := paymentsPage(t, svc, &liabilityv1.LiabilityPaymentListFilter{
		Side: liabilityv1.LiabilityPaymentSide_LIABILITY_PAYMENT_SIDE_PAID,
	})
	if len(mine.GetIds()) != 50 || mine.GetPageInfo().GetTotalItems() != 60 {
		t.Fatalf("my payments: %d rows of %d, want 50 of 60", len(mine.GetIds()), mine.GetPageInfo().GetTotalItems())
	}

	for _, id := range mine.GetIds() {
		if id == received {
			t.Fatal("a payment the warehouse made is under My payments")
		}
	}

	// ⚠ A SIDE NEVER WIDENS THE SCOPE: with no counterparty named, Paid is still only this team's own payments.
	_ = seedPayment(t, db, productOwner, warehouse, at)

	every := paymentList(t, svc, selling, &liabilityv1.LiabilityPaymentListFilter{
		Side: liabilityv1.LiabilityPaymentSide_LIABILITY_PAYMENT_SIDE_PAID,
	})
	if every.GetPageInfo().GetTotalItems() != 60 {
		t.Fatalf("paid, every counterparty: total %d, want 60 — another team's payment leaked in", every.GetPageInfo().GetTotalItems())
	}
}

// The period is the day a payment was RECORDED, a Jakarta day: 23:30 UTC on 4 Nov is 06:30 WIB on the 5th. The oldest
// payment sits under 55 newer ones — page 2 unfiltered — and the range finds it on page 1.
func TestPaymentList_ADateRangeNarrowsBeforeThePage(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	wib := time.FixedZone("WIB", 7*60*60)

	early := seedPayment(t, db, selling, warehouse, time.Date(2026, 11, 4, 23, 30, 0, 0, time.UTC))
	lastMinute := seedPayment(t, db, selling, warehouse, time.Date(2026, 11, 5, 23, 59, 59, 0, wib))

	for i := 0; i < 55; i++ {
		seedPayment(t, db, selling, warehouse, time.Date(2026, 11, 6, 0, 0, 0, 0, wib))
	}

	day := paymentsPage(t, svc, &liabilityv1.LiabilityPaymentListFilter{From: "2026-11-05", To: "2026-11-05"})
	if ids := day.GetIds(); len(ids) != 2 || ids[0] != lastMinute || ids[1] != early {
		t.Fatalf("5 Nov = %v, want [%d %d] — 06:30 and 23:59:59 WIB", ids, lastMinute, early)
	}

	if n := paymentsPage(t, svc, &liabilityv1.LiabilityPaymentListFilter{To: "2026-11-04"}).GetPageInfo().GetTotalItems(); n != 0 {
		t.Fatalf("to 4 Nov: %d payments, want 0 — 23:30 UTC on the 4th is the 5th in Jakarta", n)
	}

	if n := paymentsPage(t, svc, &liabilityv1.LiabilityPaymentListFilter{From: "2026-11-06"}).GetPageInfo().GetTotalItems(); n != 55 {
		t.Fatalf("from 6 Nov: %d payments, want 55", n)
	}

	_, err := svc.LiabilityPaymentList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentListRequest{
			TeamId: selling,
			Filter: &liabilityv1.LiabilityPaymentListFilter{From: "2026-11-06", To: "2026-11-05"},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("an inverted period: err = %v, want InvalidArgument", err)
	}
}

// ── who recorded each payment (the-team-balance-recorded-by-is-accepted) ────────────────────────────────────────────

// EACH PAYMENT NAMES WHO RECORDED IT, and says when that was Root or the Administrator from outside the payer — the
// payments table's Recorded by column and its "by Root team" badge. The creditor's list reads the same.
func TestPaymentList_EachPaymentNamesWhoRecordedIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	owes(t, svc, db, selling, warehouse, 50_000, 811)

	record := func(ctx context.Context) uint64 {
		res, err := svc.LiabilityPaymentRecord(ctx, connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId: selling, CreditorTeamId: warehouse, Amount: 10_000, Note: "BCA 1234",
		}))
		if err != nil {
			t.Fatalf("record: %v", err)
		}

		return res.Msg.GetPayment().GetId()
	}

	byMember := record(asCaller(42, selling, role_basev1.Role_ROLE_SELLING_OWNER))
	byRoot := record(asCaller(rootUser, selling, role_basev1.Role_ROLE_UNSPECIFIED))

	for _, team := range []uint64{selling, warehouse} {
		got := map[uint64]*liabilityv1.LiabilityPayment{}
		for _, p := range paymentRows(paymentList(t, svc, team, nil)) {
			got[p.GetId()] = p
		}

		if p := got[byMember]; p.GetRecordedBy() != 42 || p.GetRecordedIsOverride() {
			t.Errorf("team %d: the owner's payment reads recorded by %d, override %v — want 42, false",
				team, p.GetRecordedBy(), p.GetRecordedIsOverride())
		}

		if p := got[byRoot]; p.GetRecordedBy() != rootUser || !p.GetRecordedIsOverride() {
			t.Errorf("team %d: Root's payment reads recorded by %d, override %v — want %d, true",
				team, p.GetRecordedBy(), p.GetRecordedIsOverride(), rootUser)
		}
	}
}
