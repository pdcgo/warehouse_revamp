package liability_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

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

func recordFrom(svc *liability_v1.Service, payer, creditor, fromAccount uint64, amount int64) (*liabilityv1.LiabilityPayment, error) {
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
	svc := liability_v1.NewService(db, nil, bothBanks)

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
	svc := liability_v1.NewService(db, nil, bothBanks)

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
	svc := liability_v1.NewService(db, nil, nil)

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
		svc := liability_v1.NewService(db, nil, failingAccounts{err: c.err})

		_, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
		if connect.CodeOf(err) != c.want {
			t.Fatalf("%v: code = %v, want %v", c.err, connect.CodeOf(err), c.want)
		}
	}
}

// A team cannot owe itself, so it cannot pay itself either — named, not left to the database's CHECK.
func TestPaymentRecord_ATeamCannotPayItself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks)

	_, err := recordFrom(svc, selling, selling, sellingBCA, 15000)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}
