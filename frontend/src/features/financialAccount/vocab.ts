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

// THE TYPE DECIDES THE PROVIDER (owner, `the-type-decides-the-provider`) — a bank account picks among the banks, a
// digital wallet among the wallets (ShopeePay, for now), and a cash box and type Lainnya have theirs set for them.
// It replaces type-and-provider-are-picked-apart on the screens; the server still takes any pair.
export const PROVIDERS_BY_TYPE: Record<number, P[]> = {
  [FinancialAccountType.BANK_ACCOUNT]: [P.BCA, P.BNI, P.JAGO],
  [FinancialAccountType.WALLET]: [P.SHOPEEPAY],
  [FinancialAccountType.CASH]: [P.CASH],
  [FinancialAccountType.UNKNOWN]: [P.UNKNOWN],
};

/** The provider a type sets by itself — Kas for a cash box, Lainnya for type Lainnya. None where a person picks. */
export function fixedProvider(type: FinancialAccountType): P | undefined {
  if (type === FinancialAccountType.CASH) return P.CASH;
  if (type === FinancialAccountType.UNKNOWN) return P.UNKNOWN;
  return undefined;
}

/**
 * The provider to hold once the type changes: the one it sets, the only one it offers, the current one if the
 * new type still offers it — else none, and the person picks.
 */
export function providerFor(type: FinancialAccountType, current: P): P {
  const offered = PROVIDERS_BY_TYPE[type] ?? [];
  return fixedProvider(type) ?? (offered.length === 1 ? offered[0]! : offered.includes(current) ? current : P.UNSPECIFIED);
}

export const TYPE_KEY: Record<number, string> = {
  [FinancialAccountType.UNSPECIFIED]: "financialAccounts.type.unknown",
  [FinancialAccountType.WALLET]: "financialAccounts.type.wallet",
  [FinancialAccountType.BANK_ACCOUNT]: "financialAccounts.type.bankAccount",
  [FinancialAccountType.CASH]: "financialAccounts.type.cash",
  [FinancialAccountType.UNKNOWN]: "financialAccounts.type.unknown",
};

// The types New Account offers — Lainnya last, for an account outside the three (owner,
// `the-type-decides-the-provider`). The server does not accept it yet (`FINANCIAL_ACCOUNT_PENDING`, otherType).
export const PICKABLE_TYPES: FinancialAccountType[] = [
  FinancialAccountType.BANK_ACCOUNT,
  FinancialAccountType.WALLET,
  FinancialAccountType.CASH,
  FinancialAccountType.UNKNOWN,
];

/** The types Tentukan Rekening can make an unknown account into — the real ones, never Lainnya again. */
export const IDENTIFIABLE_TYPES: FinancialAccountType[] = [
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

// A SHOP's NAME where the server could only write its id.
//
// The withdrawal listener names what it makes after the shop — an unknown account is "Unknown — shop #25",
// a withdrawal's row "Withdrawal from shop #21" — but it hears an EVENT, not a person, so it has no caller to
// ask the shop's service with. The screens already hold the team's shops, so they put the name in. An id the
// team's shops do not resolve is left as written.
export function withShopNames(text: string, nameOf: (shopId: bigint) => string | undefined): string {
  return text.replace(/shop #(\d+)/g, (written, id: string) => nameOf(BigInt(id)) ?? written);
}

/**
 * THE NAME AN ACCOUNT IS SHOWN BY (owner, `the-unknown-account-reads-lainnya`).
 *
 * An unknown account is shown by the SHOP whose withdrawals it holds — "Melati TikTok", not "Unknown — shop #25":
 * its provider badge already says *Lainnya*, so a prefix and a badge said it twice more. Every other account is
 * its own name, with any shop id the server wrote put back as the shop's name (`withShopNames`). An unknown
 * account whose shop the screen does not hold falls back to its stored name, prefix dropped.
 */
export function accountName(
  account: { name: string; type: FinancialAccountType; shopIds: bigint[] },
  nameOf: (shopId: bigint) => string | undefined,
): string {
  if (isUnknown(account)) {
    const shops = account.shopIds.map(nameOf).filter((name): name is string => !!name);
    if (shops.length > 0) return shops.join(", ");

    return withShopNames(account.name, nameOf).replace(/^Unknown — /, "");
  }

  return withShopNames(account.name, nameOf);
}
