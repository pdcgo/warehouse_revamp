package inventory_v1

import (
	"context"
	"errors"
	"fmt"
)

// errAccountNotOperational is FailedPrecondition: the account exists in the person's eyes but may not pay a restock or
// a transfer's shipping today — archived, not marked operational, or another team's (which reads as one that never
// existed). restockErr and transferErr both map it.
var errAccountNotOperational = errors.New("not one of the team's active operational accounts")

// errAccountNotActive is FailedPrecondition: a transfer's shipping names an account that is archived or another
// team's (which reads as one that never existed). A transfer may be paid from ANY active account of the team —
// a-transfers-shipping-is-paid-from-any-active-account — so, unlike a restock, the operational mark is not asked.
var errAccountNotActive = errors.New("not one of the team's active accounts")

// PayingAccount is what inventory needs to know about the account a restock or a transfer's shipping names as having
// paid: whether the team may pay from it today, and what to call it when it may not.
type PayingAccount struct {
	Name        string
	Active      bool
	Operational bool
}

// PayingAccounts answers, for a restock or a warehouse transfer being raised or edited, the account it names
// (a-restock-names-its-paying-account, a-transfer-names-its-paying-account, operational-accounts-pay-for-operations).
// financial_account_service owns accounts and their operational marks; inventory never reads its tables. An INTERFACE THIS SERVICE OWNS, like ExpensePoster — the composition root adapts it
// to that service in-process (restock_accounts.go there).
//
// `found` is false for an account that does not exist AND for another team's — the two must read the same, or the
// answer confirms an id.
type PayingAccounts interface {
	Account(ctx context.Context, teamID, accountID uint64) (account PayingAccount, found bool, err error)
}

// accountsUnchecked counts every account as one of the team's active operational ones. It is what a Service built
// without the seam uses — a unit test raising its own restock has no financial_account_service, exactly as
// factsUnchecked counts every product as the team's own. The composition root always wires the real one.
type accountsUnchecked struct{}

func (accountsUnchecked) Account(context.Context, uint64, uint64) (PayingAccount, bool, error) {
	return PayingAccount{Active: true, Operational: true}, true, nil
}

// accountAnswer is financial_account_service's answer about one account, taken before any lock.
type accountAnswer struct {
	id      uint64
	account PayingAccount
	found   bool
	err     error
}

// askPayingAccount asks about the account a restock or a transfer names. 0 asks nothing (a restock's contract refuses 0
// on create; an arrived restock raised before paying accounts keeps its 0; a transfer with no shipping cost names none). Asked BEFORE any transaction: a call to another service
// never holds a pooled connection or a lock across its round-trip.
func (s *Service) askPayingAccount(ctx context.Context, teamID, accountID uint64) accountAnswer {
	if accountID == 0 {
		return accountAnswer{}
	}

	account, found, err := s.accounts.Account(ctx, teamID, accountID)

	return accountAnswer{id: accountID, account: account, found: found, err: err}
}

// check refuses an account that is not one of the team's ACTIVE OPERATIONAL accounts — FailedPrecondition, naming it,
// so the person knows which pick to change (the same words as expense's Paid from).
func (a accountAnswer) check() error {
	if a.id == 0 {
		return nil
	}

	if a.err != nil {
		return fmt.Errorf("ask the account that paid: %w", a.err)
	}

	name := a.account.Name
	if name == "" {
		name = fmt.Sprintf("account #%d", a.id)
	}

	switch {
	case !a.found:
		// Another team's id reads as one that never existed.
		return fmt.Errorf("account #%d is %w", a.id, errAccountNotOperational)
	case !a.account.Active:
		return fmt.Errorf("%s is archived — it is %w", name, errAccountNotOperational)
	case !a.account.Operational:
		return fmt.Errorf("%s is %w — pick another, or ask an admin to mark it operational", name, errAccountNotOperational)
	}

	return nil
}

// checkActive refuses an account that is not one of the team's ACTIVE accounts — a transfer's shipping
// (a-transfers-shipping-is-paid-from-any-active-account): archived or another team's is FailedPrecondition, naming it;
// the operational mark is not asked.
func (a accountAnswer) checkActive() error {
	if a.id == 0 {
		return nil
	}

	if a.err != nil {
		return fmt.Errorf("ask the account that paid: %w", a.err)
	}

	name := a.account.Name
	if name == "" {
		name = fmt.Sprintf("account #%d", a.id)
	}

	switch {
	case !a.found:
		// Another team's id reads as one that never existed.
		return fmt.Errorf("account #%d is %w", a.id, errAccountNotActive)
	case !a.account.Active:
		return fmt.Errorf("%s is archived — it is %w", name, errAccountNotActive)
	}

	return nil
}
