// The financial accounts every financial-account story reads — docs/business/financial_account.
//
// ⚠ ONE CONSISTENT BOOK. Every account's balance is the sum of its rows below, and the stub derives
// `balance_after` and the balance from them rather than storing either — so a story can assert a balance
// against this file's arithmetic, and a transfer made in a story moves exactly the numbers it should.
//
// Its own module, beside fixtures.ts rather than inside it: the stub's writable state imports these, and
// a story imports them to assert against — neither needs the rest of the warehouse.
//
// Ids: accounts 13xx, log rows 14xx — distinct from every other fixture kind, so a leaked id is obvious.

import {
  FinancialAccountChangeType as T,
  FinancialAccountProvider as P,
  FinancialAccountStatus,
  FinancialAccountType,
} from "../src/gen/warehouse/financial_account/v1/financial_account_pb";

export interface AccountFixture {
  id: bigint;
  teamId: bigint;
  type: FinancialAccountType;
  provider: P;
  status: FinancialAccountStatus;
  accountNumber: string;
  name: string;
  holderName: string;
  description: string;
  operational: boolean;
  shopIds: bigint[];
  /** Days ago it was last reconciled — undefined is "never checked". */
  reconciledAgo?: number;
}

export interface LogFixture {
  id: bigint;
  accountId: bigint;
  changeType: T;
  change: number;
  description: string;
  /** 61 = Ani; 0 = a listener posted it, no person behind it. */
  actorId: bigint;
  /** When the money moved, in days before today. */
  ago: number;
  groupId?: bigint;
  counterAccountId?: bigint;
}

const ACTIVE = FinancialAccountStatus.ACTIVE;
const ANI = 61n;
const LISTENER = 0n;

// ── The accounts ────────────────────────────────────────────────────────────────────────────────
//
// ⚠ APPEND, never reorder — stories pick accounts by name through `account(...)`, but the order is the
// list's default order too.
export const financialAccounts: AccountFixture[] = [
  // ── Toko Melati (12), a selling team ──
  {
    // Where two of the shops withdraw, and what restocks are paid from. Reconciled yesterday — a bank fee
    // of 6.500 was the difference.
    id: 1301n, teamId: 12n, type: FinancialAccountType.BANK_ACCOUNT, provider: P.BCA, status: ACTIVE,
    accountNumber: "1234567890", name: "BCA Operasional", holderName: "PT Melati Sejahtera",
    description: "Withdrawals land here. Pay Toko Melati's fees into BCA 1234567890.", operational: true,
    shopIds: [21n, 22n], reconciledAgo: 1,
  },
  {
    // Payroll only. Never reconciled — "never checked" is the state worth seeing.
    id: 1302n, teamId: 12n, type: FinancialAccountType.BANK_ACCOUNT, provider: P.BCA, status: ACTIVE,
    accountNumber: "1234567891", name: "BCA Gaji", holderName: "PT Melati Sejahtera",
    description: "Payroll.", operational: false, shopIds: [],
  },
  {
    // BELOW ZERO — two restocks paid before the top-up landed (below-zero-is-warned-never-refused).
    id: 1303n, teamId: 12n, type: FinancialAccountType.WALLET, provider: P.SHOPEEPAY, status: ACTIVE,
    accountNumber: "081234567890", name: "ShopeePay Melati", holderName: "Ani Rahayu",
    description: "", operational: true, shopIds: [], reconciledAgo: 9,
  },
  {
    // UNKNOWN — Melati TikTok withdrew twice before anyone named its bank, so the listener made this
    // (a-shop-with-no-account-gets-an-unknown-one).
    id: 1304n, teamId: 12n, type: FinancialAccountType.UNKNOWN, provider: P.UNKNOWN, status: ACTIVE,
    accountNumber: "", name: "Unknown — Melati TikTok", holderName: "", description: "",
    operational: false, shopIds: [25n],
  },
  {
    // ARCHIVED at zero — the owner emptied it and closed it (an-account-is-archived-only-at-zero).
    id: 1305n, teamId: 12n, type: FinancialAccountType.BANK_ACCOUNT, provider: P.BNI,
    status: FinancialAccountStatus.ARCHIVED, accountNumber: "0987654321", name: "BNI Lama",
    holderName: "PT Melati Sejahtera", description: "Closed in August.", operational: false, shopIds: [],
  },

  // ── Gudang Pusat (11), a warehouse ──
  {
    // The box the courier's ask is paid from, counted a week ago and right.
    id: 1306n, teamId: 11n, type: FinancialAccountType.CASH, provider: P.CASH, status: ACTIVE,
    accountNumber: "", name: "Kas Gudang", holderName: "", description: "The drawer at the loading dock.",
    operational: true, shopIds: [], reconciledAgo: 7,
  },
  {
    id: 1307n, teamId: 11n, type: FinancialAccountType.BANK_ACCOUNT, provider: P.BCA, status: ACTIVE,
    accountNumber: "5550001111", name: "BCA Gudang", holderName: "CV Gudang Pusat",
    description: "Selling teams pay their fees here.", operational: false, shopIds: [], reconciledAgo: 3,
  },

  // ── Toko Kenanga (13) — here so a number registered in ANOTHER team can be refused ──
  {
    id: 1308n, teamId: 13n, type: FinancialAccountType.BANK_ACCOUNT, provider: P.JAGO, status: ACTIVE,
    accountNumber: "1029384756", name: "Jago Kenanga", holderName: "Kenanga Abadi", description: "",
    operational: true, shopIds: [24n],
  },
];

// ── The rows ────────────────────────────────────────────────────────────────────────────────────
//
// In ENTRY order — `balance_after` runs in id order per account (the-log-says-balance-after).
export const financialAccountLogs: LogFixture[] = [
  // BNI Lama → 0, then archived
  { id: 1401n, accountId: 1305n, changeType: T.OPENING_BALANCE, change: 500_000, description: "Opening balance", actorId: ANI, ago: 60 },
  { id: 1402n, accountId: 1305n, changeType: T.CAPITAL, change: -500_000, description: "Capital out — the owner emptied it before closing", actorId: ANI, ago: 45 },

  // Opening balances
  { id: 1403n, accountId: 1301n, changeType: T.OPENING_BALANCE, change: 10_000_000, description: "Opening balance", actorId: ANI, ago: 40 },
  { id: 1404n, accountId: 1302n, changeType: T.OPENING_BALANCE, change: 0, description: "Opening balance", actorId: ANI, ago: 40 },
  { id: 1405n, accountId: 1303n, changeType: T.OPENING_BALANCE, change: 200_000, description: "Opening balance", actorId: ANI, ago: 38 },
  { id: 1406n, accountId: 1306n, changeType: T.OPENING_BALANCE, change: 1_000_000, description: "Opening balance", actorId: ANI, ago: 30 },
  { id: 1407n, accountId: 1307n, changeType: T.OPENING_BALANCE, change: 23_500_000, description: "Opening balance", actorId: ANI, ago: 30 },
  { id: 1408n, accountId: 1308n, changeType: T.OPENING_BALANCE, change: 750_000, description: "Opening balance", actorId: ANI, ago: 20 },

  // BCA Operasional's month
  { id: 1409n, accountId: 1301n, changeType: T.WITHDRAWAL, change: 3_500_000, description: "Withdrawal from Melati Official", actorId: LISTENER, ago: 35 },
  { id: 1410n, accountId: 1301n, changeType: T.RESTOCK, change: -2_750_000, description: "Restock R-1021 — PT Sumber Makmur", actorId: LISTENER, ago: 30 },
  { id: 1411n, accountId: 1306n, changeType: T.RESTOCK, change: -150_000, description: "Courier's ask — restock R-1021", actorId: LISTENER, ago: 30 },
  { id: 1412n, accountId: 1301n, changeType: T.TRANSFER, change: -3_000_000, description: "To BCA Gaji — September payroll", actorId: ANI, ago: 28, groupId: 1n, counterAccountId: 1302n },
  { id: 1413n, accountId: 1302n, changeType: T.TRANSFER, change: 3_000_000, description: "From BCA Operasional — September payroll", actorId: ANI, ago: 28, groupId: 1n, counterAccountId: 1301n },
  { id: 1414n, accountId: 1302n, changeType: T.EXPENSE, change: -2_400_000, description: "Expense — September payroll (Payroll)", actorId: LISTENER, ago: 25 },
  { id: 1415n, accountId: 1301n, changeType: T.WITHDRAWAL, change: 4_800_000, description: "Withdrawal from Melati Store", actorId: LISTENER, ago: 21 },
  { id: 1416n, accountId: 1303n, changeType: T.RESTOCK, change: -450_000, description: "Restock R-1030 — CV Cahaya Abadi", actorId: LISTENER, ago: 20 },
  { id: 1417n, accountId: 1301n, changeType: T.EXPENSE, change: -1_200_000, description: "Expense — packing material (Operational)", actorId: LISTENER, ago: 18 },
  { id: 1418n, accountId: 1301n, changeType: T.ADS_EXPENSE, change: -900_000, description: "Expense — Shopee ads top-up (Ads)", actorId: LISTENER, ago: 14 },
  { id: 1419n, accountId: 1304n, changeType: T.WITHDRAWAL, change: 1_700_000, description: "Withdrawal from Melati TikTok", actorId: LISTENER, ago: 12 },
  { id: 1420n, accountId: 1301n, changeType: T.TEAM_PAYMENT, change: -1_500_000, description: "Payment to Gudang Pusat — September fees", actorId: LISTENER, ago: 10, groupId: 2n, counterAccountId: 1307n },
  { id: 1421n, accountId: 1307n, changeType: T.TEAM_PAYMENT, change: 1_500_000, description: "Payment from Toko Melati — September fees", actorId: LISTENER, ago: 10, groupId: 2n, counterAccountId: 1301n },
  { id: 1422n, accountId: 1301n, changeType: T.TRANSFER, change: -500_000, description: "To ShopeePay Melati — top-up", actorId: ANI, ago: 6, groupId: 3n, counterAccountId: 1303n },
  { id: 1423n, accountId: 1303n, changeType: T.TRANSFER, change: 500_000, description: "From BCA Operasional — top-up", actorId: ANI, ago: 6, groupId: 3n, counterAccountId: 1301n },
  { id: 1424n, accountId: 1304n, changeType: T.WITHDRAWAL, change: 2_500_000, description: "Withdrawal from Melati TikTok", actorId: LISTENER, ago: 4 },
  { id: 1425n, accountId: 1301n, changeType: T.WITHDRAWAL, change: 2_000_000, description: "Withdrawal from Melati Official", actorId: LISTENER, ago: 3 },
  { id: 1426n, accountId: 1303n, changeType: T.RESTOCK, change: -400_000, description: "Restock R-1044 — PT Sumber Makmur", actorId: LISTENER, ago: 2 },
  { id: 1427n, accountId: 1301n, changeType: T.CAPITAL, change: 1_000_000, description: "Capital in — the owner's top-up", actorId: ANI, ago: 2 },
  { id: 1428n, accountId: 1301n, changeType: T.ADJUSTMENT, change: -6_500, description: "Reconcile — the app showed Rp 11.443.500 · bank fee", actorId: ANI, ago: 1 },
];

// ── What the book adds up to — the numbers the stories assert ───────────────────────────────────
export const expectedBalance: Record<string, number> = {
  "1301": 11_443_500,
  "1302": 600_000,
  "1303": -150_000,
  "1304": 4_200_000,
  "1305": 0,
  "1306": 850_000,
  "1307": 25_000_000,
  "1308": 750_000,
};

/** The fixture account named `name` — by name, so a story reads like the screen does. */
export function account(name: string): AccountFixture {
  const found = financialAccounts.find((a) => a.name === name);
  if (!found) throw new Error(`no fixture account named ${name}`);

  return found;
}
