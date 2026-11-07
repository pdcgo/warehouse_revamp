package liability_v1_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The financial accounts each team may name on a payment: account id → its team.
const (
	sellingBCA   uint64 = 71
	warehouseBCA uint64 = 81
)

// accountsOf answers the AccountChecker from a fixed map — account id → the team that may name it. An account
// not in it is another team's, archived or unknown: refused alike, as financial_account_service answers.
type accountsOf map[uint64]uint64

func (a accountsOf) PaymentAccount(_ context.Context, teamID, accountID uint64) (bool, error) {
	return a[accountID] == teamID, nil
}

var bothBanks = accountsOf{sellingBCA: selling, warehouseBCA: warehouse}

// failingAccounts is an account service that cannot be asked.
type failingAccounts struct{ err error }

func (f failingAccounts) PaymentAccount(context.Context, uint64, uint64) (bool, error) {
	return false, f.err
}

// recordingSender keeps what was published — after the library's own validation, so an event the broker would
// refuse fails the test rather than being kept.
type recordingSender struct {
	sent []*eventsv1.Event
}

func (r *recordingSender) send(ctx context.Context, identity *role_basev1.Identity, event *eventsv1.Event) error {
	err := event_source.EmptySender(ctx, identity, event)
	if err != nil {
		return err
	}

	r.sent = append(r.sent, event)

	return nil
}

// owes posts a debt of `amount` from debtor to creditor — the courier's ask at a restock, keyed by `sourceID` — so the
// debtor has something to pay: only the team that owes records a payment (the-debtor-claims-the-creditor-decides).
func owes(t *testing.T, svc *liability_v1.Service, db *gorm.DB, debtor, creditor uint64, amount float64, sourceID uint64) {
	t.Helper()

	_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID:   debtor,
		CreditorTeamID: creditor,
		Amount:         amount,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       sourceID,
	})
	if err != nil {
		t.Fatalf("post %v owed by %d to %d: %v", amount, debtor, creditor, err)
	}
}

func recordFrom(svc *liability_v1.Service, payer, creditor, fromAccount uint64, amount float64) (*liabilityv1.LiabilityPayment, error) {
	res, err := svc.LiabilityPaymentRecord(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId:         payer,
			CreditorTeamId: creditor,
			Amount:         amount,
			Note:           "BCA 1234",
			DocumentIds:    []string{"doc-1"},
			FromAccountId:  fromAccount,
		}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetPayment(), nil
}

// a-team-payment-posts-on-accept: the payer names the account the transfer LEFT, and the payment keeps it until
// the creditor accepts and both legs post.
func TestPaymentRecord_KeepsTheAccountItWasPaidFrom(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	oweThem(t, svc, db, 15000, 1)
	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	if payment.GetFromAccountId() != sellingBCA || payment.GetToAccountId() != 0 {
		t.Fatalf("from/to = %d/%d, want %d/0 — `to` is the creditor's to name, on accept",
			payment.GetFromAccountId(), payment.GetToAccountId(), sellingBCA)
	}

	var row liability_service_models.LiabilityPayment
	if err := db.Where("id = ?", payment.GetId()).Take(&row).Error; err != nil {
		t.Fatalf("load: %v", err)
	}

	if row.FromAccountID != sellingBCA {
		t.Fatalf("stored from_account_id = %d, want %d", row.FromAccountID, sellingBCA)
	}
}

// ⚠ THE PAYER CANNOT NAME THE CREDITOR'S ACCOUNT as the one the money left. If it could, accepting would take the
// transfer out of the creditor's own books — the payer moving somebody else's money by typing an id.
func TestPaymentRecord_RefusesAnAccountThatIsNotThePayers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	_, err := recordFrom(svc, selling, warehouse, warehouseBCA, 15000)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}

	var count int64
	db.Model(&liability_service_models.LiabilityPayment{}).Where("from_account_id = ?", warehouseBCA).Count(&count)

	if count != 0 {
		t.Fatalf("%d payments written for a refused account", count)
	}
}

// With no account service to ask, a named account is REFUSED rather than trusted.
func TestPaymentRecord_WithNothingToAskAnAccountIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	_, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// A question that could not be asked is not a refusal: the account service's own code reaches the caller, and a
// broken connection reads as Unavailable — never as "you picked the wrong account".
func TestPaymentRecord_AFailedQuestionIsNotARefusal(t *testing.T) {
	db := san_testdb.DB(t)

	cases := []struct {
		err  error
		want connect.Code
	}{
		{connect.NewError(connect.CodePermissionDenied, errors.New("not a member")), connect.CodePermissionDenied},
		{errors.New("connection refused"), connect.CodeUnavailable},
	}

	for _, c := range cases {
		svc := liability_v1.NewService(db, nil, failingAccounts{err: c.err}, nil)

		_, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
		if connect.CodeOf(err) != c.want {
			t.Fatalf("%v: code = %v, want %v", c.err, connect.CodeOf(err), c.want)
		}
	}
}

// A team cannot owe itself, so it cannot pay itself either — named, not left to the database's CHECK.
func TestPaymentRecord_ATeamCannotPayItself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	_, err := recordFrom(svc, selling, selling, sellingBCA, 15000)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// A CLAIM IS STORED EXACT (the-backend-never-rounds-money): the payment's figure is written as claimed, so the accept
// posts exactly that — Rp 316,675 included. Only a claim that is not above 0 (float dust included) is refused as
// InvalidArgument.
func TestPaymentRecord_StoresAFractionalClaimExact(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	oweThem(t, svc, db, 15_000.5, 1)
	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15_000.5)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	if payment.GetAmount() != 15_000.5 {
		t.Fatalf("amount = %v, want exactly 15.000,5", payment.GetAmount())
	}

	var row liability_service_models.LiabilityPayment
	if err := db.Where("id = ?", payment.GetId()).Take(&row).Error; err != nil {
		t.Fatalf("load: %v", err)
	}

	if row.Amount != 15_000.5 {
		t.Fatalf("stored amount = %v, want 15000.5", row.Amount)
	}

	_, err = recordFrom(svc, selling, warehouse, sellingBCA, 0.00001)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a claim of float dust: code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// ⛔ THE CREDITOR CANNOT RECORD A PAYMENT (the-debtor-claims-the-creditor-decides): only the team that owes starts one.
// Melati owes the warehouse, so the warehouse — the creditor — naming its own live account and a slip is still
// refused, as FailedPrecondition (the pair is in the wrong state for it, as a request to a pair owing nothing is),
// and nothing is written.
func TestPaymentRecord_TheCreditorCannotRecordAPayment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	oweThem(t, svc, db, 15000, 1)

	_, err := recordFrom(svc, warehouse, selling, warehouseBCA, 15000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("the creditor recording: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if !strings.Contains(err.Error(), "only the team that owes records a payment") {
		t.Fatalf("message = %q, want it to say only the team that owes records a payment", err.Error())
	}

	var count int64
	db.Model(&liability_service_models.LiabilityPayment{}).Where("payer_team_id = ?", warehouse).Count(&count)

	if count != 0 {
		t.Fatalf("%d payments written by the creditor, want 0", count)
	}

	// The debtor still records its own — the refusal is about who, not the pair.
	_, err = recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("the debtor recording: %v", err)
	}
}

// A PAIR THAT OWES NOTHING HAS NOTHING TO PAY — a pair nothing ever moved on (no balance row), one paid off to 0, and
// one left at float dust (square within the server's 4-place tolerance) are all refused alike.
func TestPaymentRecord_ASquarePairHasNothingToPay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	// Never moved.
	_, err := recordFrom(svc, selling, warehouse, sellingBCA, 5000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("no balance row: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// Owed, then paid off to 0.
	oweThem(t, svc, db, 5000, 1)

	paid, err := recordFrom(svc, selling, warehouse, sellingBCA, 5000)
	if err != nil {
		t.Fatalf("record while owing: %v", err)
	}

	_, err = svc.LiabilityPaymentConfirm(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
			TeamId:      warehouse,
			PaymentId:   paid.GetId(),
			ToAccountId: warehouseBCA,
		}))
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = recordFrom(svc, selling, warehouse, sellingBCA, 5000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("paid off to 0: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// Float dust is square too.
	err = db.Exec(`UPDATE liability_balances SET balance = -0.00001 WHERE team_id = ? AND counterparty_id = ?`,
		selling, warehouse).Error
	if err != nil {
		t.Fatalf("set dust: %v", err)
	}

	_, err = recordFrom(svc, selling, warehouse, sellingBCA, 5000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("float dust: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// THE DEBTOR OF ONE PAIR MAY BE THE CREDITOR OF ANOTHER: the check reads THIS pair's row, never the team's total.
// Selling owes the warehouse and is owed by the product owner; it may pay the warehouse and not the product owner.
func TestPaymentRecord_TheCheckIsThisPairs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, nil)

	owes(t, svc, db, selling, warehouse, 15000, 1)
	owes(t, svc, db, productOwner, selling, 40000, 2)

	_, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("paying the warehouse it owes: %v", err)
	}

	_, err = recordFrom(svc, selling, productOwner, sellingBCA, 15000)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("paying the team that owes IT: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}
