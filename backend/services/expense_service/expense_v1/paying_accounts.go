package expense_v1

import (
	"context"
	"fmt"
)

// PayingAccount is what expense_service needs to know about the account an expense names: whether the team may pay an
// expense from it today, and what to call it when it may not.
type PayingAccount struct {
	Name        string
	Active      bool
	Operational bool
}

// PayingAccounts answers, for an expense being recorded, the account it names
// (an-expense-must-name-the-account-that-paid). financial_account_service owns accounts and their operational marks;
// expense_service never reads its tables. The composition root adapts this to that service in-process.
//
// `found` is false for an account that does not exist AND for another team's — the two must read the same, or the
// answer confirms an id.
type PayingAccounts interface {
	Account(ctx context.Context, teamID, accountID uint64) (account PayingAccount, found bool, err error)
}

// noPayingAccounts answers "not found" to everything: with no account service wired, no account is trusted.
type noPayingAccounts struct{}

func (noPayingAccounts) Account(context.Context, uint64, uint64) (PayingAccount, bool, error) {
	return PayingAccount{}, false, nil
}

// checkPayingAccount refuses an account that is not one of the team's ACTIVE OPERATIONAL accounts — FailedPrecondition,
// naming it, so the person knows which pick to change. Asked BEFORE any transaction: a call to another service never
// holds a pooled connection or a lock across its round-trip.
func (s *Service) checkPayingAccount(ctx context.Context, teamID, accountID uint64) error {
	account, found, err := s.accounts.Account(ctx, teamID, accountID)
	if err != nil {
		return fmt.Errorf("ask the account that paid: %w", err)
	}

	switch {
	case !found:
		// Another team's id reads as one that never existed.
		return fmt.Errorf("account #%d is %w", accountID, errNotOperational)
	case !account.Active:
		return fmt.Errorf("%s is archived — it is %w", accountName(account, accountID), errNotOperational)
	case !account.Operational:
		return fmt.Errorf("%s is %w — pick another, or ask an admin to mark it operational", accountName(account, accountID), errNotOperational)
	}

	return nil
}

func accountName(account PayingAccount, id uint64) string {
	if account.Name == "" {
		return fmt.Sprintf("account #%d", id)
	}

	return account.Name
}
