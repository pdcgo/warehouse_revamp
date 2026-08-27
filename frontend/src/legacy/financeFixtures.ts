// Sample data for the legacy FINANCE reference screens — invoices, billing, accounting.
//
// Kept separate from `fixtures.ts` because it is a different subject with no overlap: nothing in the
// warehouse screens reads a ledger entry, and nothing here reads a rack. One shared file would make
// every finance screen import the product catalogue to get at a journal line.
//
// ⚠ INVENTED. No figure, team name or account code here refers to anything real.
//
// ⚠ AND NOT A DESIGN COMMITMENT. This repo has no invoice, accounting or reporting service — these
// screens are ported as a REFERENCE of what the legacy system did (owner). Nothing here should be
// read as a decision that this system will work the same way.

export type InvoiceDirection = "payable" | "receivable";

export type InvoiceStatus = "open" | "partial" | "paid" | "overdue" | "void";

export interface InvoiceRow {
  id: bigint;
  code: string;
  counterparty: string;
  direction: InvoiceDirection;
  status: InvoiceStatus;
  issuedAt: bigint;
  dueAt: bigint;
  total: bigint;
  paid: bigint;
}

export const INVOICES: InvoiceRow[] = [
  { id: 9001n, code: "INV-9001", counterparty: "Jaya Abadi", direction: "receivable", status: "open", issuedAt: 1_784_000_000n, dueAt: 1_786_600_000n, total: 24_500_000n, paid: 0n },
  { id: 9002n, code: "INV-9002", counterparty: "Toko Makmur", direction: "receivable", status: "partial", issuedAt: 1_783_400_000n, dueAt: 1_786_000_000n, total: 12_000_000n, paid: 5_000_000n },
  { id: 9003n, code: "INV-9003", counterparty: "CV Sinar Jaya", direction: "payable", status: "overdue", issuedAt: 1_779_000_000n, dueAt: 1_782_000_000n, total: 41_200_000n, paid: 0n },
  { id: 9004n, code: "INV-9004", counterparty: "PT Benang Emas", direction: "payable", status: "paid", issuedAt: 1_778_000_000n, dueAt: 1_781_000_000n, total: 8_750_000n, paid: 8_750_000n },
  { id: 9005n, code: "INV-9005", counterparty: "Gudang Selatan", direction: "receivable", status: "void", issuedAt: 1_777_000_000n, dueAt: 1_780_000_000n, total: 3_100_000n, paid: 0n },
];

export interface InvoiceLine {
  id: bigint;
  description: string;
  qty: number;
  unitPrice: bigint;
}

export const INVOICE_LINES: InvoiceLine[] = [
  { id: 1n, description: "Kaos Polos Hitam L — 120 pcs", qty: 120, unitPrice: 89_000n },
  { id: 2n, description: "Hoodie Abu XL — 40 pcs", qty: 40, unitPrice: 234_000n },
  { id: 3n, description: "Shipping — Jakarta to Bandung", qty: 1, unitPrice: 450_000n },
];

export interface PaymentRow {
  id: bigint;
  invoiceCode: string;
  amount: bigint;
  method: string;
  at: bigint;
  reference: string;
  // A payment somebody has ASKED to record, but that has not been confirmed against a statement.
  confirmed: boolean;
}

export const PAYMENTS: PaymentRow[] = [
  { id: 1n, invoiceCode: "INV-9002", amount: 5_000_000n, method: "Bank transfer", at: 1_784_100_000n, reference: "TRX-88213", confirmed: true },
  { id: 2n, invoiceCode: "INV-9004", amount: 8_750_000n, method: "Bank transfer", at: 1_781_500_000n, reference: "TRX-77120", confirmed: true },
  { id: 3n, invoiceCode: "INV-9001", amount: 10_000_000n, method: "Bank transfer", at: 1_784_800_000n, reference: "TRX-90011", confirmed: false },
];

export interface DayTotalRow {
  day: string;
  invoiced: bigint;
  paid: bigint;
  outstanding: bigint;
}

export const DAY_TOTALS: DayTotalRow[] = [
  { day: "2026-08-12", invoiced: 24_500_000n, paid: 5_000_000n, outstanding: 19_500_000n },
  { day: "2026-08-13", invoiced: 12_000_000n, paid: 12_000_000n, outstanding: 0n },
  { day: "2026-08-14", invoiced: 0n, paid: 8_750_000n, outstanding: 0n },
  { day: "2026-08-15", invoiced: 41_200_000n, paid: 0n, outstanding: 41_200_000n },
];

// ── ACCOUNTING ──────────────────────────────────────────────────────────────────────────────────

export interface LedgerEntryRow {
  id: bigint;
  at: bigint;
  account: string;
  accountCode: string;
  memo: string;
  debit: bigint;
  credit: bigint;
}

export const LEDGER_ENTRIES: LedgerEntryRow[] = [
  { id: 1n, at: 1_784_900_000n, account: "Accounts receivable", accountCode: "1200", memo: "INV-9001 issued", debit: 24_500_000n, credit: 0n },
  { id: 2n, at: 1_784_900_000n, account: "Sales", accountCode: "4000", memo: "INV-9001 issued", debit: 0n, credit: 24_500_000n },
  { id: 3n, at: 1_784_100_000n, account: "Bank", accountCode: "1010", memo: "TRX-88213 received", debit: 5_000_000n, credit: 0n },
  { id: 4n, at: 1_784_100_000n, account: "Accounts receivable", accountCode: "1200", memo: "TRX-88213 received", debit: 0n, credit: 5_000_000n },
];

export interface AccountBalanceRow {
  code: string;
  name: string;
  kind: "asset" | "liability" | "equity" | "income" | "expense";
  debit: bigint;
  credit: bigint;
}

export const TRIAL_BALANCE: AccountBalanceRow[] = [
  { code: "1010", name: "Bank", kind: "asset", debit: 128_400_000n, credit: 0n },
  { code: "1200", name: "Accounts receivable", kind: "asset", debit: 36_500_000n, credit: 0n },
  { code: "1400", name: "Inventory", kind: "asset", debit: 214_000_000n, credit: 0n },
  { code: "2000", name: "Accounts payable", kind: "liability", debit: 0n, credit: 49_950_000n },
  { code: "3000", name: "Owner equity", kind: "equity", debit: 0n, credit: 200_000_000n },
  { code: "4000", name: "Sales", kind: "income", debit: 0n, credit: 186_300_000n },
  { code: "5000", name: "Cost of goods sold", kind: "expense", debit: 57_350_000n, credit: 0n },
];

export interface ExpenseRow {
  id: bigint;
  at: bigint;
  category: string;
  memo: string;
  amount: bigint;
  paidBy: string;
}

export const EXPENSES: ExpenseRow[] = [
  { id: 1n, at: 1_784_800_000n, category: "Shipping", memo: "Courier top-up", amount: 4_500_000n, paidBy: "Budi Hartono" },
  { id: 2n, at: 1_784_400_000n, category: "Packaging", memo: "Boxes and tape", amount: 1_240_000n, paidBy: "Ani Rahayu" },
  { id: 3n, at: 1_783_900_000n, category: "Rent", memo: "Gudang Utara — August", amount: 18_000_000n, paidBy: "Budi Hartono" },
  { id: 4n, at: 1_783_100_000n, category: "Utilities", memo: "Electricity", amount: 2_310_000n, paidBy: "Budi Hartono" },
];

export interface AdSpendRow {
  id: bigint;
  at: bigint;
  shopName: string;
  channel: string;
  spend: bigint;
  revenue: bigint;
  clicks: number;
}

export const AD_SPEND: AdSpendRow[] = [
  { id: 1n, at: 1_784_800_000n, shopName: "Toko Jaya Abadi", channel: "Shopee Ads", spend: 2_400_000n, revenue: 11_800_000n, clicks: 3_120 },
  { id: 2n, at: 1_784_800_000n, shopName: "Toko Jaya Abadi", channel: "TikTok Ads", spend: 1_850_000n, revenue: 6_200_000n, clicks: 2_480 },
  { id: 3n, at: 1_784_400_000n, shopName: "Gudang Selatan", channel: "Shopee Ads", spend: 980_000n, revenue: 2_100_000n, clicks: 1_040 },
  { id: 4n, at: 1_784_000_000n, shopName: "Gudang Selatan", channel: "Tokopedia Ads", spend: 620_000n, revenue: 380_000n, clicks: 610 },
  // A shop that loses money OVERALL, not just on one channel.
  //
  // It is here on purpose: grouped by shop, a losing channel can be hidden by a profitable sibling
  // (Gudang Selatan is net-positive despite its Tokopedia line losing money). Without a shop that is
  // net-losing, the shop view would never show a sub-1 ROAS and the screens would look as though
  // advertising always pays.
  { id: 5n, at: 1_783_600_000n, shopName: "Toko Rugi", channel: "Lazada Ads", spend: 3_100_000n, revenue: 1_450_000n, clicks: 2_050 },
];

export interface TeamBalanceRow {
  id: bigint;
  name: string;
  kind: "selling" | "warehouse";
  owed: bigint;
  owing: bigint;
  limit: bigint;
}

export const TEAM_BALANCES: TeamBalanceRow[] = [
  { id: 3n, name: "Gudang Utara", kind: "warehouse", owed: 0n, owing: 44_000_000n, limit: 50_000_000n },
  { id: 7n, name: "Gudang Selatan", kind: "warehouse", owed: 2_400_000n, owing: 8_100_000n, limit: 25_000_000n },
  { id: 9n, name: "Jaya Abadi", kind: "selling", owed: 24_500_000n, owing: 0n, limit: 0n },
  { id: 12n, name: "Toko Makmur", kind: "selling", owed: 7_000_000n, owing: 0n, limit: 40_000_000n },
];

// ── HELD FUNDS ──────────────────────────────────────────────────────────────────────────────────

export interface HoldFixtureRow {
  id: bigint;
  subject: string;
  marketplace: string;
  amount: bigint;
  heldSince: bigint;
  orderCount: number;
}

// `heldSince` is computed from NOW so the age-based states stay true whenever this is read — a fixed
// timestamp would drift into "overdue" as the file aged, and every row would eventually be stuck.
const daysAgo = (n: number): bigint => BigInt(Math.floor(Date.now() / 1000) - n * 86_400);

export const HOLDS_BY_SHOP: HoldFixtureRow[] = [
  { id: 1n, subject: "Toko Jaya Abadi", marketplace: "Shopee", amount: 18_400_000n, heldSince: daysAgo(4), orderCount: 62 },
  { id: 2n, subject: "Toko Jaya Abadi", marketplace: "Tokopedia", amount: 7_100_000n, heldSince: daysAgo(11), orderCount: 28 },
  // Small and old — the case the screen exists to surface, and the one an amount-sorted list buries.
  { id: 3n, subject: "Gudang Selatan", marketplace: "Lazada", amount: 640_000n, heldSince: daysAgo(38), orderCount: 3 },
  { id: 4n, subject: "Gudang Selatan", marketplace: "TikTok", amount: 4_900_000n, heldSince: daysAgo(2), orderCount: 19 },
];

export const HOLDS_BY_TEAM: HoldFixtureRow[] = [
  { id: 1n, subject: "Jaya Abadi", marketplace: "Multiple", amount: 25_500_000n, heldSince: daysAgo(4), orderCount: 90 },
  { id: 2n, subject: "Toko Makmur", marketplace: "Multiple", amount: 1_240_000n, heldSince: daysAgo(31), orderCount: 6 },
  { id: 3n, subject: "Gudang Selatan", marketplace: "Multiple", amount: 5_540_000n, heldSince: daysAgo(9), orderCount: 22 },
];
