import {
  FinancialAccountChangeType as T,
  FinancialAccountProvider as P,
  FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";

// The accounts' vocabulary, once — every screen of the domain names a provider, a type and a change type
// the same way and in the same colour (docs/business/financial_account).
//
// Each value maps to an i18n KEY, never a label, so the two languages stay in the locale files.

export const PROVIDER_KEY: Record<number, string> = {
  [P.UNSPECIFIED]: "financialAccounts.provider.unknown",
  [P.CASH]: "financialAccounts.provider.cash",
  [P.BCA]: "financialAccounts.provider.bca",
  [P.BNI]: "financialAccounts.provider.bni",
  [P.JAGO]: "financialAccounts.provider.jago",
  [P.SHOPEEPAY]: "financialAccounts.provider.shopeepay",
  [P.UNKNOWN]: "financialAccounts.provider.unknown",
};

// The providers a person may PICK — never `unknown`, which only a withdrawal makes
// (a-shop-with-no-account-gets-an-unknown-one).
export const PICKABLE_PROVIDERS: P[] = [P.BCA, P.BNI, P.JAGO, P.SHOPEEPAY, P.CASH];

export const TYPE_KEY: Record<number, string> = {
  [FinancialAccountType.UNSPECIFIED]: "financialAccounts.type.unknown",
  [FinancialAccountType.WALLET]: "financialAccounts.type.wallet",
  [FinancialAccountType.BANK_ACCOUNT]: "financialAccounts.type.bankAccount",
  [FinancialAccountType.CASH]: "financialAccounts.type.cash",
  [FinancialAccountType.UNKNOWN]: "financialAccounts.type.unknown",
};

// Picked APART from the provider — a mismatched pair saves (type-and-provider-are-picked-apart).
export const PICKABLE_TYPES: FinancialAccountType[] = [
  FinancialAccountType.BANK_ACCOUNT,
  FinancialAccountType.WALLET,
  FinancialAccountType.CASH,
];

// The totals strip's plural headings, in the order the strip shows them.
export const TYPE_TOTAL_KEY: Record<number, string> = {
  [FinancialAccountType.BANK_ACCOUNT]: "financialAccounts.totals.bank",
  [FinancialAccountType.WALLET]: "financialAccounts.totals.wallet",
  [FinancialAccountType.CASH]: "financialAccounts.totals.cash",
  [FinancialAccountType.UNKNOWN]: "financialAccounts.totals.unknown",
};

export const CHANGE_TYPE_KEY: Record<number, string> = {
  [T.UNSPECIFIED]: "financialAccounts.changeType.unspecified",
  [T.EXPENSE]: "financialAccounts.changeType.expense",
  [T.ADS_EXPENSE]: "financialAccounts.changeType.adsExpense",
  [T.ADJUSTMENT]: "financialAccounts.changeType.adjustment",
  [T.WITHDRAWAL]: "financialAccounts.changeType.withdrawal",
  [T.RESTOCK]: "financialAccounts.changeType.restock",
  [T.OPENING_BALANCE]: "financialAccounts.changeType.openingBalance",
  [T.TRANSFER]: "financialAccounts.changeType.transfer",
  [T.TEAM_PAYMENT]: "financialAccounts.changeType.teamPayment",
  [T.CAPITAL]: "financialAccounts.changeType.capital",
};

// The order the log filter and the report's columns list the types: money in first, then out, then the
// moves that only rearrange it, then the books' own.
export const CHANGE_TYPES: T[] = [
  T.WITHDRAWAL,
  T.CAPITAL,
  T.RESTOCK,
  T.EXPENSE,
  T.ADS_EXPENSE,
  T.TEAM_PAYMENT,
  T.TRANSFER,
  T.ADJUSTMENT,
  T.OPENING_BALANCE,
];

// One colour per change type — what came from where, readable down a statement at a glance.
export const CHANGE_TYPE_PALETTE: Record<number, string> = {
  [T.WITHDRAWAL]: "green",
  [T.CAPITAL]: "teal",
  [T.RESTOCK]: "orange",
  [T.EXPENSE]: "red",
  [T.ADS_EXPENSE]: "pink",
  [T.TEAM_PAYMENT]: "purple",
  [T.TRANSFER]: "blue",
  [T.ADJUSTMENT]: "yellow",
  [T.OPENING_BALANCE]: "gray",
};

// Which way a row came in (one-way-in-per-type) — the log says so, because a row nobody typed is a row
// nobody on this screen can correct by hand.
export const BY_HAND: ReadonlySet<T> = new Set([T.OPENING_BALANCE, T.TRANSFER, T.CAPITAL, T.ADJUSTMENT]);

export const isUnknown = (account: { type: FinancialAccountType }) => account.type === FinancialAccountType.UNKNOWN;
