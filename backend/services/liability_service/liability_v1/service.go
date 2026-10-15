// Package liability_v1 implements the ledger of what teams owe each other (#180).
//
// It serves TWO of the contract's three proto services today: LiabilityService — the read surface
// behind the Liability screens (#185) — and LiabilityTermsService, a creditor's rates and credit
// limits (#189). LiabilityPaymentService (#188) is declared in the same proto and is deliberately
// NOT served yet: a service is mounted whole, so registering it with half its RPCs missing would
// advertise a contract this build cannot honour.
//
// ⚠ THE LEDGER'S WRITE PATH HAS NO WIRE SURFACE, and never will. `PostEntry` is a domain function
// called in-process, because nothing outside this system may assert that one team owes another —
// every posting originates from a real event inside it (a restock accepted, an order placed).
//
// ⚠ TERMS ARE READ BY THE FEES BUT NEVER BY THE LEDGER. Changing a rate changes what FUTURE postings
// charge; entries already written are immutable facts about money that moved.
package liability_v1

import (
	"context"
	"errors"
	"math"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// AccountChecker answers whether a team may name an account on a payment — *Paid from* when recording,
// *Received into* when accepting (a-team-payment-posts-on-accept). Asked of financial_account_service under
// the caller's token, because the account ids come from the request: without the check a payer could name the
// CREDITOR's account as the one the money left, and accepting would take it out of their books.
type AccountChecker interface {
	// PaymentAccount is true for one of teamID's ACTIVE accounts, never an `unknown` one — what the account
	// picker offers. false with a nil error is a refusal; an error is a question that could not be asked.
	PaymentAccount(ctx context.Context, teamID, accountID uint64) (bool, error)
}

// noAccounts refuses every account — with nothing to ask, a payment naming one is not trusted.
type noAccounts struct{}

func (noAccounts) PaymentAccount(context.Context, uint64, uint64) (bool, error) {
	return false, nil
}

type Service struct {
	db       *gorm.DB
	events   event_source.EventSender
	accounts AccountChecker
}

// compile-time proof Service serves the READ surface and the TERMS surface (#189).
//
// One impl behind several proto services, as selling_v1 already does. The split is about WHEN each
// can be mounted, not about which struct serves it: a service is mounted whole, so LiabilityTerms
// could not be served until all three of its RPCs existed. LiabilityPaymentService is still absent
// and still deliberately unmounted until #188.
var (
	_ liabilityv1connect.LiabilityServiceHandler        = (*Service)(nil)
	_ liabilityv1connect.LiabilityTermsServiceHandler   = (*Service)(nil)
	_ liabilityv1connect.LiabilityPaymentServiceHandler = (*Service)(nil)
)

func NewService(db *gorm.DB, events event_source.EventSender, accounts AccountChecker) *Service {
	// A nil sender would panic on the first accept. EmptySender still VALIDATES the event, so a malformed
	// one is caught with no broker in sight — the right default for tests and a local run.
	if events == nil {
		events = event_source.EmptySender
	}

	// A nil checker refuses every account rather than trusting one. A direct call that names NO account (a
	// test, the contract's `gt = 0` skipped) never asks — on the wire the contract refuses it first.
	if accounts == nil {
		accounts = noAccounts{}
	}

	return &Service{db: db, events: events, accounts: accounts}
}

var errAccountNotUsable = errors.New("pick one of your team's active accounts — an archived account, " +
	"an unknown one or another team's cannot be named on a payment")

// checkAccount asks whether teamID may name accountID, BEFORE any transaction: a call to another service
// inside one would hold a pooled connection — and the payment's row lock — for a network round-trip. An
// account archived between this answer and the commit still posts: the accounts take a broker row on an
// archived account rather than lose money that moved.
//
// 0 is not asked: on the wire the contract refuses it, so only a direct call reaches here with one.
func (s *Service) checkAccount(ctx context.Context, teamID, accountID uint64) error {
	if accountID == 0 {
		return nil
	}

	ok, err := s.accounts.PaymentAccount(ctx, teamID, accountID)
	if err != nil {
		// The account service's own refusal (its scope, its policy) reaches the caller with its own code.
		var connectErr *connect.Error
		if errors.As(err, &connectErr) {
			return connectErr
		}

		return connect.NewError(connect.CodeUnavailable, err)
	}

	if !ok {
		return connect.NewError(connect.CodeInvalidArgument, errAccountNotUsable)
	}

	return nil
}

// dbError keeps the mapping in one place, as every other service here does.
func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

var errSameTeam = errors.New("a team cannot owe itself")

// The terms change log has no table yet — see terms_history_list.go for what it is waiting on.

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
