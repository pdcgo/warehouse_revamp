package financial_account_v1

import (
	"google.golang.org/protobuf/types/known/timestamppb"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// The database speaks text, the wire speaks enums. ONE table per vocabulary, both directions read from it,
// so the two cannot drift.

var typeText = map[financial_accountv1.FinancialAccountType]string{
	financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_WALLET:       m.TypeWallet,
	financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT: m.TypeBankAccount,
	financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_CASH:         m.TypeCash,
	financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_UNKNOWN:      m.TypeUnknown,
}

var providerText = map[financial_accountv1.FinancialAccountProvider]string{
	financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_CASH:      m.ProviderCash,
	financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA:       m.ProviderBCA,
	financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BNI:       m.ProviderBNI,
	financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_JAGO:      m.ProviderJago,
	financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY: m.ProviderShopeePay,
	financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_UNKNOWN:   m.ProviderUnknown,
}

var statusText = map[financial_accountv1.FinancialAccountStatus]string{
	financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ACTIVE:   m.StatusActive,
	financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ARCHIVED: m.StatusArchived,
}

var changeTypeText = map[financial_accountv1.FinancialAccountChangeType]string{
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_EXPENSE:         m.ChangeExpense,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_ADS_EXPENSE:     m.ChangeAdsExpense,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_ADJUSTMENT:      m.ChangeAdjustment,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_WITHDRAWAL:      m.ChangeWithdrawal,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_RESTOCK:         m.ChangeRestock,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_OPENING_BALANCE: m.ChangeOpeningBalance,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_TRANSFER:        m.ChangeTransfer,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_TEAM_PAYMENT:    m.ChangeTeamPayment,
	financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_CAPITAL:         m.ChangeCapital,
}

// changeTypes is every change type in the vocabulary's order — the daily row's columns, and the
// CHANGE_TYPE grouping's keys.
var changeTypes = []string{
	m.ChangeExpense,
	m.ChangeAdsExpense,
	m.ChangeAdjustment,
	m.ChangeWithdrawal,
	m.ChangeRestock,
	m.ChangeOpeningBalance,
	m.ChangeTransfer,
	m.ChangeTeamPayment,
	m.ChangeCapital,
}

func invert[K comparable, V comparable](in map[K]V) map[V]K {
	out := make(map[V]K, len(in))
	for k, v := range in {
		out[v] = k
	}

	return out
}

var (
	typeEnum       = invert(typeText)
	providerEnum   = invert(providerText)
	statusEnum     = invert(statusText)
	changeTypeEnum = invert(changeTypeText)
)

// accountExtras is what a row of `financial_accounts` does not hold: its operational mark and its shops.
type accountExtras struct {
	operational bool
	shopIDs     []uint64
}

func accountToProto(a m.FinancialAccount, extra accountExtras) *financial_accountv1.FinancialAccount {
	shopIDs := extra.shopIDs
	if shopIDs == nil {
		shopIDs = []uint64{}
	}

	return &financial_accountv1.FinancialAccount{
		Id:            a.ID,
		TeamId:        a.TeamID,
		Type:          typeEnum[a.Type],
		Provider:      providerEnum[a.Provider],
		Status:        statusEnum[a.Status],
		AccountNumber: a.AccountNumber,
		Name:          a.Name,
		HolderName:    a.HolderName,
		Description:   a.Description,
		Operational:   extra.operational,
		ShopIds:       shopIDs,
		CreatedAt:     timestamppb.New(a.CreatedAt),
		UpdatedAt:     timestamppb.New(a.UpdatedAt),
	}
}

func logToProto(l m.FinancialAccountLog) *financial_accountv1.FinancialAccountLog {
	return &financial_accountv1.FinancialAccountLog{
		Id:               l.ID,
		TeamId:           l.TeamID,
		AccountId:        l.AccountID,
		ChangeType:       changeTypeEnum[l.ChangeType],
		Change:           l.Change,
		BalanceAfter:     l.BalanceAfter,
		Description:      l.Description,
		ActorId:          l.ActorID,
		OccurredAt:       timestamppb.New(l.OccurredAt),
		CreatedAt:        timestamppb.New(l.CreatedAt),
		GroupId:          l.GroupID,
		CounterAccountId: l.CounterAccountID,
	}
}

func metricToProto(c m.MetricColumns) *financial_accountv1.FinancialAccountMetric {
	return &financial_accountv1.FinancialAccountMetric{
		Expense:        c.Expense,
		AdsExpense:     c.AdsExpense,
		Adjustment:     c.Adjustment,
		Withdrawal:     c.Withdrawal,
		Restock:        c.Restock,
		OpeningBalance: c.OpeningBalance,
		Transfer:       c.Transfer,
		TeamPayment:    c.TeamPayment,
		Capital:        c.Capital,
		Change:         c.Change,
		OpenBalance:    c.OpenBalance,
		CloseBalance:   c.CloseBalance,
	}
}
