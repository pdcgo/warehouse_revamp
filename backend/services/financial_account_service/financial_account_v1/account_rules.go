package financial_account_v1

import (
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// The rules an account's identity obeys — shared by Create and by Identify's fill-in, which makes the same
// account out of an unknown one.

// identity is an account's type, provider and number, checked and in the database's words.
type identity struct {
	accountType string
	provider    string
	number      string
}

// checkIdentity — a pickable type and provider, picked APART (type-and-provider-are-picked-apart: a
// mismatched pair saves), and a number unless it is a cash box. Never `unknown`: only a withdrawal makes one.
func checkIdentity(
	t financial_accountv1.FinancialAccountType,
	p financial_accountv1.FinancialAccountProvider,
	number string,
) (identity, error) {
	accountType, okType := typeText[t]
	provider, okProvider := providerText[p]

	if !okType || !okProvider {
		return identity{}, connect.NewError(connect.CodeInvalidArgument, errors.New("pick a type and a provider"))
	}

	if accountType == m.TypeUnknown || provider == m.ProviderUnknown {
		return identity{}, errUnknownByHand
	}

	number = strings.TrimSpace(number)

	if accountType == m.TypeCash {
		// A cash box has no number to record (a-real-account-is-recorded-once exempts it).
		number = ""
	} else if number == "" {
		return identity{}, errNeedsNumber
	}

	return identity{accountType: accountType, provider: provider, number: number}, nil
}

var errNumberRecorded = connect.NewError(
	connect.CodeAlreadyExists,
	errors.New("this account is already recorded — one real account, one row, in one team"),
)

// numberFree — one real account, one row (a-real-account-is-recorded-once): a provider and its number across
// ALL teams, archived included. The unique index is the guarantee; this check is the readable refusal.
func numberFree(tx *gorm.DB, id identity, except uint64) error {
	if id.number == "" {
		return nil
	}

	var count int64

	err := tx.Model(&m.FinancialAccount{}).
		Where("provider = ? AND account_number = ? AND id <> ?", id.provider, id.number, except).
		Count(&count).
		Error
	if err != nil {
		return dbError(err)
	}

	if count > 0 {
		return errNumberRecorded
	}

	return nil
}

// nameFree — a name is unique in the team, case-blind, so a picker never shows two of the same (my spec,
// accepted with the prototype).
func nameFree(tx *gorm.DB, teamID uint64, name string, except uint64) error {
	var count int64

	err := tx.Model(&m.FinancialAccount{}).
		Where("team_id = ? AND lower(name) = lower(?) AND id <> ?", teamID, name, except).
		Count(&count).
		Error
	if err != nil {
		return dbError(err)
	}

	if count > 0 {
		return connect.NewError(connect.CodeAlreadyExists, errors.New("the team already has an account named "+name))
	}

	return nil
}

// cleanName is a required name, trimmed.
func cleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errNoName
	}

	return name, nil
}

// uniqueOrInternal maps a write's error: a unique index that caught a race the pre-checks missed is still
// AlreadyExists, never Internal.
func uniqueOrInternal(err error) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return err
	}

	if isUniqueViolation(err) {
		return connect.NewError(connect.CodeAlreadyExists, errors.New("that name or number was just recorded by someone else"))
	}

	return dbError(err)
}
