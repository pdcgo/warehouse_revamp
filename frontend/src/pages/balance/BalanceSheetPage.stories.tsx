import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { marker, routedPage } from "../../../.storybook/pageStory";
import { resolveRange, type DateRange } from "../../components/datetime/DateRangePicker";
import { unixToDateInput } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { BalanceSheetPage } from "./index";
import {
  HELD_DATES,
  august,
  broken,
  july,
  loss,
  profitMismatch,
  sheetFor,
  sinceJune,
} from "./fixtures";
import { check, formatBalance, gaps, sectionTotal, section } from "./model";

// ASSETS = LIABILITIES + EQUITY, at one instant — and the one screen in this app that is a DESIGN
// MOCK rather than a build.
//
// Nothing here is wired. There is no route, no menu entry, no query hook and no service behind it,
// because a balance sheet is not a page you build — it is a page that falls out of double-entry
// bookkeeping, and this system has no journal, no chart of accounts and no cash account. Assembling
// one by hand from revenue, expenses, settlement and inventory would produce a page that cannot fail
// to balance, which sounds like a feature and is the opposite: a wrong asset figure would become a
// wrong equity figure and the sheet would still print a reassuring tick.
//
// So the screen was built FIRST, to answer whether the ledger behind it is worth the work:
//
//   | mode        | what it is                                                              |
//   | ----------- | ----------------------------------------------------------------------- |
//   | default     | the finished screen, as it would look if the accounting existed          |
//   | show gaps   | the same screen as an ESTIMATE — every line nothing here can serve,      |
//   |             | marked, counted and totalled                                            |
//
// The stories below are the argument for and against building it. Seven of twelve lines have no
// source in this system today; roughly a fifth of the position would be typed in by hand every month.
// That is the number the decision turns on, and it is on the screen rather than in a paragraph.

const TIE = check(august);
const GAPS = gaps(august);

const ASSETS = sectionTotal(section(august, "assets"));
const LIABILITIES = sectionTotal(section(august, "liabilities"));
const EQUITY = sectionTotal(section(august, "equity"));

// The line that did NOT move between the two dates, and the one that is negative. Both are picked out
// here rather than typed into an assertion, so a fixture edit moves the test with it.
const UNCHANGED = "deposits";
const NEGATIVE = "drawings";

const meta = {
  title: "Pages/Statements/BalanceSheetPage",
  component: BalanceSheetPage,
  args: { sheet: august },
  parameters: {
    docs: {
      description: {
        component:
          "A DESIGN MOCK. Assets = liabilities + equity at one date, fed entirely from hand-written fixtures — this system has no ledger to serve it. Turn on **Show what is not tracked** to read the same screen as a gap analysis.",
      },
    },
  },
} satisfies Meta<typeof BalanceSheetPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// The previous period, reached the way the screen offers it. Worth its own sidebar entry and not only
// a `play()`: every figure on the sheet changes, and "does last month look like this month" is most of
// what a reader is doing when they open one.
export const PreviousPeriod: Story = {
  args: { sheet: july },
};

// A LOSING PERIOD. Equity goes DOWN — the business owns less of itself than it did — which is a
// materially different thing to read than a red bottom line on a report, and worth seeing laid out.
export const LosingPeriod: Story = {
  args: { sheet: loss },
};

// ⚠ THE SHEET THAT DOES NOT TIE: 1.200.000 of stock written off in one place and posted nowhere else.
// The most ordinary way a hand-assembled sheet breaks, and the reason the check is at the TOP of the
// page rather than in a footnote.
export const DoesNotTie: Story = {
  args: { sheet: broken },
};

// The gap analysis, as a state somebody can open and look at rather than only as an assertion — it is
// the entire reason this mock exists, so it gets a sidebar entry.
export const ShowingWhatIsNotTracked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("balance-show-gaps"));
    await waitFor(() => expect(canvas.getByTestId("balance-gap-summary")).toBeInTheDocument());
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// THE EQUATION IS CHECKED, NOT ASSUMED — and it can only be checked because equity is fed
// INDEPENDENTLY here: capital, retained earnings, the period's profit and drawings are four separate
// figures rather than `assets − liabilities`. A sheet that computes equity as the residual balances
// by construction and therefore tests nothing.
export const TheEquationIsCheckedAndTheSheetSaysWhenItTies: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(TIE.balanced).toBe(true);
    await expect(ASSETS).toBe(LIABILITIES + EQUITY);

    await expect(canvas.getByTestId("balance-check")).toHaveAttribute("data-balanced", "true");
    await expect(canvas.getByTestId("balance-tie-ok")).toBeInTheDocument();
    await expect(canvas.getByTestId("balance-check-assets")).toHaveTextContent(
      formatRupiah(ASSETS),
    );
    await expect(canvas.getByTestId("balance-check-liabilities")).toHaveTextContent(
      formatRupiah(LIABILITIES),
    );
    await expect(canvas.getByTestId("balance-check-equity")).toHaveTextContent(
      formatRupiah(EQUITY),
    );
  },
};

// ⚠ WHEN IT DOES NOT TIE, THE DIFFERENCE IS NAMED — and no line absorbs it.
//
// A hand-assembled sheet always tempts a "difference" row that swallows whatever is left over, and
// the moment one exists the sheet balances forever and stops being evidence of anything. So the
// section totals here stay exactly what their lines add up to, and the shortfall is stated as a
// fault with its size beside it.
export const WhenItDoesNotTieTheDifferenceIsNamedRatherThanAbsorbed: Story = {
  args: { sheet: broken },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const shortfall = check(broken);
    await expect(shortfall.balanced).toBe(false);
    await expect(shortfall.difference).toBe(-1_200_000n);

    await expect(canvas.getByTestId("balance-check")).toHaveAttribute("data-balanced", "false");
    await expect(canvas.getByTestId("balance-tie-broken")).toHaveTextContent(
      formatBalance(shortfall.difference),
    );
    await expect(canvas.queryByTestId("balance-tie-ok")).toBeNull();

    // The totals are still the honest sums of their own lines — nothing was quietly moved to make
    // the equation work.
    await expect(canvas.getByTestId("balance-total-assets")).toHaveTextContent(
      formatRupiah(sectionTotal(section(broken, "assets"))),
    );
    await expect(canvas.getByTestId("balance-total-equity")).toHaveTextContent(
      formatRupiah(EQUITY),
    );
  },
};

// THE PROFIT LINE IS THE INCOME STATEMENT'S BOTTOM LINE. Equity moves by what the business earned, so
// the same figure appears on two reports approached from opposite ends. It is the only number that
// joins them, and nothing else on either screen would notice the two drifting apart.
export const TheProfitLineIsTheIncomeStatementsBottomLine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("balance-profit-ties")).toHaveTextContent(
      formatRupiah(august.profitPerIncomeStatement),
    );
    await expect(canvas.queryByTestId("balance-profit-mismatch")).toBeNull();
  },
};

// …and a disagreement is called out EVEN THOUGH THE SHEET TIES. This is the case that argues for the
// check existing at all: the equation is satisfied by the sheet's own four equity figures whether or
// not they agree with the Profit screen, so no amount of staring at A = L + E would surface it.
export const AProfitThatDisagreesWithTheIncomeStatementIsCalledOutEvenThoughTheSheetTies: Story = {
  args: { sheet: profitMismatch },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(check(profitMismatch).balanced).toBe(true);
    await expect(canvas.getByTestId("balance-check")).toHaveAttribute("data-balanced", "true");

    const mismatch = canvas.getByTestId("balance-profit-mismatch");
    await expect(mismatch).toHaveTextContent(formatRupiah(22_200_000n));
    await expect(mismatch).toHaveTextContent(formatRupiah(21_000_000n));
    await expect(canvas.queryByTestId("balance-profit-ties")).toBeNull();
  },
};

// A LINE THAT DID NOT MOVE SHOWS A DASH, NOT "Rp 0". They are different statements, and printing the
// first for the second fills the column with zeroes the eye has to read digit by digit to find the
// two rows that actually changed.
export const AChangeCellIsBlankWhenTheLineDidNotMove: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`balance-change-${UNCHANGED}`)).toHaveTextContent("—");
    await expect(canvas.getByTestId(`balance-change-${UNCHANGED}`)).not.toHaveTextContent("Rp 0");

    // …while a line that did move carries an explicit sign, so the direction is readable without
    // comparing two columns by eye.
    await expect(canvas.getByTestId("balance-change-inventory")).toHaveTextContent("+");
  },
};

// NEGATIVES ARE IN PARENTHESES, the accounting convention. A leading minus is one glyph wide and sits
// exactly where the eye is scanning for a digit; on a right-aligned money column it is genuinely
// missable, and the line it appears on here is subtracted from the owner's own money.
export const ANegativeLineReadsInParenthesesRatherThanWithAMinus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const cell = canvas.getByTestId(`balance-amount-${NEGATIVE}`);
    await expect(cell).toHaveTextContent("(Rp 5.000.000)");
    await expect(cell).not.toHaveTextContent("-Rp");
  },
};

// THE GAP MODE IS THE ESTIMATE. Not "some lines are missing" — seven of twelve, and the share of the
// position somebody would have to type in every month. That is the number the decision to build a
// ledger turns on, so it is on the screen rather than in a paragraph somewhere.
//
// The count is asserted as a LITERAL as well as against the helper: deriving both sides from `gaps()`
// would pass just as happily if a line were mislabelled as sourced when nothing can serve it.
export const ShowingTheGapsMarksEveryUntrackedLineAndTotalsThem: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Off by default: the ideal screen is what somebody is asked to judge first.
    await expect(canvas.queryByTestId("balance-gap-summary")).toBeNull();
    await expect(canvas.getByTestId("balance-line-cash")).not.toHaveAttribute("data-untracked");

    await userEvent.click(canvas.getByTestId("balance-show-gaps"));

    const summary = await canvas.findByTestId("balance-gap-summary");

    await expect(GAPS.untrackedLines).toBe(7);
    await expect(GAPS.totalLines).toBe(12);
    await expect(GAPS.untrackedAmount).toBe(52_350_000n);
    await expect(summary).toHaveTextContent(formatRupiah(GAPS.untrackedAmount));

    // Marked per line, both ways round — the four lines this system CAN serve stay unmarked, or the
    // mode would be saying nothing is available rather than showing which parts are.
    for (const id of ["cash", "deposits", "supplierPayable", "accrued", "capital", "retained", "drawings"]) {
      await expect(canvas.getByTestId(`balance-line-${id}`)).toHaveAttribute(
        "data-untracked",
        "true",
      );
    }

    for (const id of ["inventory", "goodsInTransit", "receivable", "profit"]) {
      await expect(canvas.getByTestId(`balance-line-${id}`)).not.toHaveAttribute("data-untracked");
    }
  },
};

// EVERY SOURCED LINE OPENS THE SCREEN THAT EXPLAINS IT. A balance sheet is the top of a drill path —
// its whole job is to be the place you notice something and leave from. A total nobody can open is a
// number to be believed rather than checked.
const Routed = routedPage(
  [
    { path: "/balance", element: <BalanceSheetPage sheet={august} /> },
    marker("/inventory", "at-inventory"),
    marker("/inventories/restock", "at-restock"),
    marker("/liability", "at-liability"),
    marker("/profit", "at-profit"),
  ],
  "/balance",
);

export const ASourcedLineOpensTheScreenThatExplainsIt: Story = {
  parameters: { dataRouter: true },
  render: () => <Routed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("balance-line-receivable"));
    await expect(await canvas.findByTestId("at-liability")).toBeInTheDocument();
  },
};

// …and a line with nowhere to go IS NOT A DEAD LINK. An untracked line has no source screen by
// definition, so it stays inert rather than being a row that looks clickable and does nothing —
// which reads as the app being broken rather than as the data being absent.
const RoutedUntracked = routedPage(
  [
    { path: "/balance", element: <BalanceSheetPage sheet={august} /> },
    marker("/inventory", "at-inventory"),
    marker("/liability", "at-liability"),
  ],
  "/balance",
);

export const AnUntrackedLineIsInertRatherThanADeadLink: Story = {
  parameters: { dataRouter: true },
  render: () => <RoutedUntracked />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("balance-line-cash"));

    // Still on the sheet — nothing navigated, nothing blanked.
    await expect(canvas.getByTestId("balance-check")).toBeInTheDocument();
    await expect(canvas.queryByTestId("at-inventory")).toBeNull();
  },
};

// ── The window ──────────────────────────────────────────────────────────────────────────────────

// ⚠ THE RANGE PICKS TWO INSTANTS, NOT A PERIOD TO SUM. This is the same shared control every other
// screen uses to mean "the movements INSIDE this window", and here it means the opposite: `to` is the
// sheet's own date, `from` is the comparison column, and nothing on the page is summed across the
// span. A balance sheet has no inside — it is a level, and a comparison needs two of them.
//
// That inversion is the one genuinely risky thing about reusing the control, so the page states the
// reading in words under it, and this story fails if that caption goes.
//
// The state lives in the story, not the page: the page renders one sheet and nothing else, which is
// what makes the swap to a real query hook a one-import change if the ledger is ever built.
function RangedSheet() {
  const [range, setRange] = useState<DateRange>({
    kind: "absolute",
    from: august.priorAsOf,
    to: august.asOf,
  });

  // Exactly what a real caller would do: resolve the window, then ask for a position per end. The
  // relative shortcuts ("Last 90 days") come out the other side as two dates like any other window.
  const { fromUnix, toUnix } = resolveRange(range);
  const sheet = sheetFor(unixToDateInput(fromUnix), unixToDateInput(toUnix));

  return <BalanceSheetPage sheet={sheet} onRangeChange={setRange} />;
}

export const TheWindow: Story = {
  render: () => <RangedSheet />,
};

// WIDENING THE WINDOW CHANGES WHAT "THE PERIOD" MEANS, and the equity section follows it: a sheet
// spanning two months of trading shows BOTH months' earnings on its profit line and the retained
// figure from before the window opened. This is the case a two-canned-sheets mock cannot represent
// at all, and the reason the fixtures store positions per date rather than finished sheets.
export const WideningTheWindowRecomputesTheProfitAndRetainedLines: Story = {
  render: () => <RangedSheet />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("balance-amount-profit")).toHaveTextContent(
      formatRupiah(august.profitPerIncomeStatement),
    );

    // The popover portals, so its contents are on `screen` rather than in the canvas. The calendar
    // opens on the month of `to` (August), so June is two steps back — navigated rather than assumed.
    await userEvent.click(canvas.getByTestId("balance-range"));
    const prev = await screen.findByTestId("balance-range-prev");
    await waitFor(() => expect(prev).toBeVisible());
    await userEvent.click(prev);
    await userEvent.click(prev);

    await userEvent.click(await screen.findByTestId("balance-range-day-2026-06-30"));

    await userEvent.click(screen.getByTestId("balance-range-next"));
    await userEvent.click(screen.getByTestId("balance-range-next"));
    await userEvent.click(await screen.findByTestId("balance-range-day-2026-08-18"));

    await userEvent.click(screen.getByTestId("balance-range-apply"));

    // Two months of earnings on one sheet — strictly more than August alone.
    const spanProfit = sinceJune.profitPerIncomeStatement;
    await expect(spanProfit).toBeGreaterThan(august.profitPerIncomeStatement);
    await waitFor(() =>
      expect(canvas.getByTestId("balance-amount-profit")).toHaveTextContent(
        formatRupiah(spanProfit),
      ),
    );

    // …and retained earnings steps BACK to what had accumulated before June closed, because that is
    // now what "before the period" means. The two move in opposite directions, which is exactly the
    // bug a per-period fixture store would hide.
    const spanRetained = section(sinceJune, "equity").lines.find((l) => l.id === "retained")!.amount;
    const augustRetained = section(august, "equity").lines.find((l) => l.id === "retained")!.amount;
    await expect(spanRetained).toBeLessThan(augustRetained);
    await expect(canvas.getByTestId("balance-amount-retained")).toHaveTextContent(
      formatRupiah(spanRetained),
    );

    // The sheet still ties, which is the whole claim: any window over these positions is coherent.
    await expect(check(sinceJune).balanced).toBe(true);
    await expect(canvas.getByTestId("balance-check")).toHaveAttribute("data-balanced", "true");
  },
};

// THE WINDOW'S MEANING IS SPELLED OUT, because the control cannot say it. Somebody carrying the habit
// from the Statement or Revenue screens would read this window as "August's trading" rather than as
// "August's position against July's", and every figure on the page would look plausible under that
// misreading. A caption is a weak fix and much better than none.
export const TheWindowSaysItIsTwoInstantsAndNotAPeriod: Story = {
  render: () => <RangedSheet />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const meaning = canvas.getByTestId("balance-range-meaning");
    await expect(meaning).toHaveTextContent(/two instants/i);
    await expect(meaning).toHaveTextContent(/not summed|nothing on this page is summed/i);
  },
};

// EVERY HELD POSITION TIES ON ITS OWN, not only the pair the page opens on. A fixture set that
// balanced at one date and not another would make the page's own check look flaky — the failure would
// arrive as "sometimes the mock is red" rather than as "the June figures are wrong".
export const EveryHeldPositionTiesOnItsOwn: Story = {
  play: async () => {
    for (const date of HELD_DATES) {
      await expect(check(sheetFor(date, date)).balanced).toBe(true);
    }

    // …and so does every ordered pair of them, which is what the range control can actually produce.
    for (const from of HELD_DATES) {
      for (const to of HELD_DATES) {
        if (from <= to) {
          await expect(check(sheetFor(from, to)).balanced).toBe(true);
        }
      }
    }
  },
};
