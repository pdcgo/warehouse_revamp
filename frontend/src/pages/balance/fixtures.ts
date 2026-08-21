import type { BalanceLine, BalanceSheet, LineSource, SectionId } from "./model";

// THE MOCK'S DATA. Every figure here was typed by hand, and that is the entire point — see index.tsx.
//
// ⚠ IT IS STORED AS POSITIONS AT DATES, NOT AS SHEETS. A balance sheet is a LEVEL at an instant, and
// the prior column is simply the same level at an earlier instant — so one date's figures are the
// unit, and a sheet is composed from two of them. That is also what makes the range control real
// rather than a switch between two canned screens: any pair of held dates produces a coherent sheet.
//
// If a ledger is ever built, THIS FILE IS WHAT GETS DELETED and replaced by a query hook taking a
// date and returning a position. Nothing else on the page knows where its numbers came from.

/** The permanent facts about a line — what it is, and what could serve it. Not its value. */
interface LineSpec {
  id: string;
  section: SectionId;
  source: LineSource;
  drillTo?: string;
}

const LINES: LineSpec[] = [
  // Nothing in this system holds a cash balance. It is the largest single gap on the sheet and the
  // one with no partial answer available — settlement knows what is OWED, never what is HELD.
  { id: "cash", section: "assets", source: "none" },
  { id: "inventory", section: "assets", source: "inventory", drillTo: "/inventory" },
  // Stock that has left the supplier and not yet been received — an asset the business owns and
  // cannot touch.
  { id: "goodsInTransit", section: "assets", source: "inventory", drillTo: "/inventories/restock" },
  { id: "receivable", section: "assets", source: "settlement", drillTo: "/liability" },
  { id: "deposits", section: "assets", source: "none" },

  { id: "payable", section: "liabilities", source: "settlement", drillTo: "/liability" },
  // Suppliers exist as entities; what is owed to them does not. Goods are received without the debt
  // they create being recorded anywhere.
  { id: "supplierPayable", section: "liabilities", source: "none" },
  // Expenses recorded but not yet paid. expense_service knows the expense and not its payment.
  { id: "accrued", section: "liabilities", source: "none" },
];

// The equity lines are DERIVED rather than stored, because three of the four depend on which period
// the sheet covers — see `equityLines`.
const EQUITY_LINES: LineSpec[] = [
  { id: "capital", section: "equity", source: "none" },
  { id: "retained", section: "equity", source: "none" },
  // The ONE equity line this system can already serve, and the hinge between the two reports.
  { id: "profit", section: "equity", source: "profit", drillTo: "/profit" },
  { id: "drawings", section: "equity", source: "none" },
];

/**
 * What the business held and owed at one instant, plus the two running equity counters.
 *
 * ⚠ EARNINGS AND DRAWINGS ARE CUMULATIVE — everything ever made, everything ever taken out, up to
 * this date. Stored that way because "profit for the period" is not a property of a date: it depends
 * on where the period STARTED, which the reader chooses. Two cumulative counters differenced across
 * the chosen window give the period's figures for any pair of dates, and give them consistently —
 * a per-period store would let 30 Jun → 18 Aug show August's profit against June's retained earnings
 * and still look plausible.
 */
interface Position {
  capital: bigint;
  earningsToDate: bigint;
  drawingsToDate: bigint;
  lines: Record<string, bigint>;
}

// Every position ties on its own: assets − liabilities = capital + earnings − drawings. That is
// checked by the stories at each held date rather than trusted, because a fixture set that balances
// at one date and not another would make the page's own check look flaky.
const POSITIONS: Record<string, Position> = {
  "2026-06-30": {
    capital: 80_000_000n,
    earningsToDate: 14_300_000n,
    drawingsToDate: 2_000_000n,
    lines: {
      cash: 9_700_000n,
      inventory: 81_200_000n,
      goodsInTransit: 6_400_000n,
      receivable: 37_500_000n,
      deposits: 3_500_000n,
      payable: 22_900_000n,
      supplierPayable: 18_400_000n,
      accrued: 4_700_000n,
    },
  },
  "2026-07-31": {
    capital: 80_000_000n,
    earningsToDate: 23_800_000n,
    drawingsToDate: 4_500_000n,
    lines: {
      cash: 12_100_000n,
      inventory: 88_400_000n,
      goodsInTransit: 9_200_000n,
      receivable: 39_750_000n,
      // Deliberately UNCHANGED at all three dates — the line that exercises a blank change cell
      // rather than a printed "Rp 0".
      deposits: 3_500_000n,
      payable: 27_400_000n,
      supplierPayable: 21_150_000n,
      accrued: 5_100_000n,
    },
  },
  "2026-08-18": {
    capital: 80_000_000n,
    earningsToDate: 46_000_000n,
    drawingsToDate: 9_500_000n,
    lines: {
      cash: 18_400_000n,
      inventory: 96_000_000n,
      goodsInTransit: 12_750_000n,
      receivable: 47_300_000n,
      deposits: 3_500_000n,
      payable: 31_000_000n,
      supplierPayable: 24_600_000n,
      accrued: 5_850_000n,
    },
  },
};

/** The dates the mock holds, oldest first. A range lands on the nearest of these — see `snap`. */
export const HELD_DATES = Object.keys(POSITIONS).sort();

export const TEAM_NAME = "Gudang Pusat";

/**
 * The four equity lines for a window.
 *
 *   retained  = everything earned and not taken out BEFORE the window opened
 *   profit    = what the window itself earned
 *   drawings  = what was taken out during the window
 *
 * which always sums, with capital, to `capital + earnings(to) − drawings(to)` — the equity at `to`,
 * however the window was chosen. At the opening instant the window has earned nothing yet, so the
 * PRIOR column carries a zero profit and a zero drawings and folds the lot into retained. That reads
 * oddly for a beat and is literally true: at the start of a period, the period had made nothing.
 */
function equityLines(from: Position, to: Position): BalanceLine[] {
  const openingRetained = from.earningsToDate - from.drawingsToDate;

  const values: Record<string, { amount: bigint; prior: bigint }> = {
    capital: { amount: to.capital, prior: from.capital },
    retained: { amount: openingRetained, prior: openingRetained },
    profit: { amount: to.earningsToDate - from.earningsToDate, prior: 0n },
    drawings: { amount: -(to.drawingsToDate - from.drawingsToDate), prior: 0n },
  };

  return EQUITY_LINES.map((spec) => ({ ...spec, ...values[spec.id]! }));
}

/** The nearest held date at or before `date`; the oldest one if it predates them all. */
function snap(date: string): string {
  const held = [...HELD_DATES].reverse().find((d) => d <= date);

  return held ?? HELD_DATES[0]!;
}

/**
 * Compose the sheet for a window. `from` is the COMPARISON instant and `to` is the sheet's own —
 * a balance sheet is never summed over a period, so the range picks two levels and nothing else.
 *
 * Dates the mock does not hold snap to the nearest it does, and the page renders the dates it
 * actually used rather than the ones asked for. In a mock that is honest; behind a real query it
 * would be a lie, and the hook would return the position for the date asked.
 */
export function sheetFor(from: string, to: string): BalanceSheet {
  const fromKey = snap(from);
  const toKey = snap(to);
  const start = POSITIONS[fromKey]!;
  const end = POSITIONS[toKey]!;

  const positional = (id: SectionId) =>
    LINES.filter((l) => l.section === id).map((spec) => ({
      ...spec,
      amount: end.lines[spec.id] ?? 0n,
      prior: start.lines[spec.id] ?? 0n,
    }));

  const equity = equityLines(start, end);

  return {
    teamName: TEAM_NAME,
    asOf: toKey,
    priorAsOf: fromKey,
    // The profit line IS the income statement's bottom line — the mock keeps them equal by
    // construction, which is what makes a deliberate mismatch (below) worth a story.
    profitPerIncomeStatement: equity.find((l) => l.id === "profit")!.amount,
    sections: [
      { id: "assets", lines: positional("assets") },
      { id: "liabilities", lines: positional("liabilities") },
      { id: "equity", lines: equity },
    ],
  };
}

/** August so far, compared with the end of July — what the page opens on. */
export const august = sheetFor("2026-07-31", "2026-08-18");
/** July, closed, compared with the end of June. */
export const july = sheetFor("2026-06-30", "2026-07-31");
/** The whole window the mock holds — the case where the period spans two months of earnings. */
export const sinceJune = sheetFor("2026-06-30", "2026-08-18");

// ── The states worth designing FOR, rather than around ──────────────────────────────────────────

/** Swaps one line's amount without mutating the shared fixture. */
function withLine(sheet: BalanceSheet, sectionId: SectionId, lineId: string, amount: bigint): BalanceSheet {
  return {
    ...sheet,
    sections: sheet.sections.map((s) =>
      s.id !== sectionId
        ? s
        : { ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, amount } : l)) },
    ),
  };
}

/**
 * A SHEET THAT DOES NOT TIE — 1.200.000 of stock written off in inventory and never posted anywhere
 * else. The most ordinary way a hand-assembled sheet breaks, and the case the whole check exists for.
 */
export const broken: BalanceSheet = withLine(august, "assets", "inventory", 94_800_000n);

/**
 * A sheet that TIES while the two reports disagree — the equity section says the period made
 * 22.200.000, the Profit screen says 21.000.000. Both cannot be right, and no amount of staring at
 * the equation would reveal it: the equation is satisfied by the sheet's own figures either way.
 */
export const profitMismatch: BalanceSheet = { ...august, profitPerIncomeStatement: 21_000_000n };

/**
 * A LOSING PERIOD. Equity goes DOWN, which on a balance sheet shows as the business owning less of
 * itself rather than as a red number on a report somebody can skip.
 *
 * Built by moving 27.000.000 out of the assets that would actually have funded it — cash and money
 * owed to us — so the sheet still ties. A loss that left the assets alone would be a sheet nobody
 * could learn anything from.
 */
export const loss: BalanceSheet = (() => {
  const withLoss = withLine(august, "equity", "profit", -4_800_000n);
  const drained = withLine(withLoss, "assets", "cash", 11_400_000n);

  return {
    ...withLine(drained, "assets", "receivable", 27_300_000n),
    profitPerIncomeStatement: -4_800_000n,
  };
})();
