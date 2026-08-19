import { formatRupiah } from "../../lib/money";

// THE SHAPE OF A BALANCE SHEET, and nothing about where the numbers came from.
//
// ⚠ THIS PAGE IS A DESIGN MOCK. Nothing here is wired to a service, and that is deliberate: a real
// balance sheet is not a screen you build, it is a screen that FALLS OUT of double-entry bookkeeping.
// This system has no journal, no chart of accounts and no cash account — so the page exists to answer
// one question before any of that is built: *is the finished screen worth the ledger it would take?*
//
// Which is why every line carries a `source`. Rendered with the gap mode on, the same screen doubles
// as the gap analysis — it says exactly how much of the position no part of this system knows.

/** Which service could serve a line TODAY. `none` is the interesting one. */
export type LineSource = "inventory" | "settlement" | "profit" | "none";

export interface BalanceLine {
  /** Stable id — the i18n key and the test id both derive from it. */
  id: string;
  /** The figure at the sheet's `asOf` date. Negative is allowed (drawings). */
  amount: bigint;
  /** The same line at `priorAsOf`. A one-column balance sheet is a photo, not information. */
  prior: bigint;
  /** The screen that explains the figure. A line the reader cannot open is a dead end. */
  drillTo?: string;
  source: LineSource;
}

export type SectionId = "assets" | "liabilities" | "equity";

export interface BalanceSection {
  id: SectionId;
  lines: BalanceLine[];
}

export interface BalanceSheet {
  teamName: string;
  /** yyyy-mm-dd — a balance sheet is a LEVEL at one instant, never a period. */
  asOf: string;
  priorAsOf: string;
  sections: BalanceSection[];
  /**
   * What the Profit screen reports for the same period.
   *
   * THE ONE NUMBER THAT JOINS THE TWO REPORTS. Equity moves by profit, so the income statement's
   * bottom line and the equity section's profit line are the same figure seen from two directions. If
   * they disagree, one of the two reports is wrong — and that is worth an assertion rather than a
   * hope, because nothing else on either screen would notice.
   */
  profitPerIncomeStatement: bigint;
}

// ── The arithmetic ──────────────────────────────────────────────────────────────────────────────

export const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

export const sectionTotal = (s: BalanceSection) => sum(s.lines.map((l) => l.amount));
export const sectionPrior = (s: BalanceSection) => sum(s.lines.map((l) => l.prior));

export function section(sheet: BalanceSheet, id: SectionId): BalanceSection {
  return sheet.sections.find((s) => s.id === id) ?? { id, lines: [] };
}

export interface BalanceCheckResult {
  assets: bigint;
  liabilities: bigint;
  equity: bigint;
  /** assets − (liabilities + equity). Zero, or the page has a problem to report. */
  difference: bigint;
  balanced: boolean;
}

/**
 * A = L + E, checked rather than assumed.
 *
 * ⚠ EQUITY IS FED INDEPENDENTLY HERE — capital, retained earnings, the period's profit and drawings
 * are four separate figures, not `assets − liabilities`. That is the whole reason this check can
 * FAIL, and the reason it is worth showing. A screen that computes equity as the residual can never
 * fail to balance, which sounds like a feature and is the opposite: it means a wrong asset figure
 * silently becomes a wrong equity figure and the sheet still prints a reassuring tick.
 */
export function check(sheet: BalanceSheet): BalanceCheckResult {
  const assets = sectionTotal(section(sheet, "assets"));
  const liabilities = sectionTotal(section(sheet, "liabilities"));
  const equity = sectionTotal(section(sheet, "equity"));
  const difference = assets - (liabilities + equity);

  return { assets, liabilities, equity, difference, balanced: difference === 0n };
}

export interface GapReport {
  untrackedLines: number;
  totalLines: number;
  /**
   * How much of the POSITION (assets + liabilities) has no source in this system.
   *
   * Equity is left out on purpose: three of its four lines are untracked, and including them would
   * push the share past three quarters and stop the number meaning anything. What a decision needs is
   * "how much of what we hold and owe would a person have to type in", and that is this.
   */
  untrackedAmount: bigint;
  positionAmount: bigint;
}

export function gaps(sheet: BalanceSheet): GapReport {
  const all = sheet.sections.flatMap((s) => s.lines);
  const position = [...section(sheet, "assets").lines, ...section(sheet, "liabilities").lines];

  return {
    untrackedLines: all.filter((l) => l.source === "none").length,
    totalLines: all.length,
    untrackedAmount: sum(position.filter((l) => l.source === "none").map((l) => abs(l.amount))),
    positionAmount: sum(position.map((l) => abs(l.amount))),
  };
}

const abs = (x: bigint) => (x < 0n ? -x : x);

// ── How money reads on a balance sheet ──────────────────────────────────────────────────────────

/**
 * Negatives in PARENTHESES, the accounting convention — `(Rp 5.000.000)`.
 *
 * A leading minus is one glyph wide and sits where the eye is scanning for a digit; on a column of
 * right-aligned figures it is genuinely easy to miss, and the one line it appears on here (drawings)
 * is subtracted from the owner's own money. The rest of the app uses `formatRupiah` directly, which
 * is right — no other screen has a column where a sign flips the meaning of a total.
 */
export function formatBalance(amount: bigint): string {
  return amount < 0n ? `(${formatRupiah(-amount)})` : formatRupiah(amount);
}

/**
 * The movement between the two dates, with an explicit sign — and a DASH when nothing moved.
 *
 * "Rp 0" and "did not move" are different statements, and printing the first for the second makes a
 * column of zeroes that the eye has to read digit by digit to find the two rows that changed.
 */
export function formatChange(delta: bigint): string {
  if (delta === 0n) {
    return "—";
  }

  return `${delta > 0n ? "+" : "−"} ${formatRupiah(abs(delta))}`;
}
