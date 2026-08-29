import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { dayKey, expenseDays, revenueDays, liabilityDays, teams } from "../../../.storybook/fixtures";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { formatRupiah } from "../../lib/money";
import { DailyStatementPage } from "./index";

// THE MONEY, DAY BY DAY — and the one screen in the app that subtracts one service from another.
//
// Revenue, Expenses and Profit each answer "what did this MONTH do". None of them answers "which DAY
// did it", and a month is not a thing that goes wrong — a Tuesday is. So this screen is one row per
// day, and almost every rule below exists because a day-grained answer can lie in ways a monthly one
// cannot: a quiet day silently missing, a losing Tuesday buried under a good fortnight, a footer that
// follows a filter and makes it look like the money changed.
//
// IT SERVES BOTH TEAM TYPES from one component, reading a different income column for each:
//
//   |               | selling (Toko Melati)                 | warehouse (Gudang Pusat)              |
//   | ------------- | ------------------------------------- | ------------------------------------- |
//   | income        | expected margin on its orders         | handling fees it charged              |
//   | which service | revenue_service                       | liability_service                    |
//   | the notice    | "these are EXPECTED figures"          | none — both sides are real movements  |
//   | stock loss    | none — losses post to the warehouse   | its biggest controllable cost         |
//
// The team is chosen by planting the current-team key before the providers mount (`asTeam`), which is
// what the team switcher does — the page has no prop for it, and should not.
//
// No `dataRouter` here, unlike the order list: this screen navigates nowhere. It is a thing you read.

const SELLING = teams[1]!; // Toko Melati (12)
const WAREHOUSE = teams[0]!; // Gudang Pusat (11)

// The window the page opens on — a rolling 30 days, which is `DEFAULT_RANGE` in index.tsx.
const WINDOW_DAYS = 30;

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
// A relative range of N days runs from the start of the day N−1 back through the end of today, so
// `ago` 0…N−1 is what lands inside it. Same arithmetic `resolveRange` does.
const inWindow = (ago: number, days: number) => ago <= days - 1;

// ── What the stub will have served, derived rather than typed twice ─────────────────────────────
//
// ⚠ EVERYTHING BELOW IS SPLIT BY WINDOW, because the fixtures deliberately reach further back than the
// daily view can see: two of the selling team's months sit outside the 30-day window and only the
// MONTHLY grain ever reads them. A total summed over the whole fixture set would be right for the
// monthly assertions and silently wrong for every daily one.

const sellingRevenue = revenueDays.filter((d) => d.teamId === SELLING.id);
const sellingExpenses = expenseDays.filter((d) => d.teamId === SELLING.id);
const warehouseFees = liabilityDays.filter((d) => d.teamId === WAREHOUSE.id);
const warehouseExpenses = expenseDays.filter((d) => d.teamId === WAREHOUSE.id);

const dayTotal = (d: { byKind: Record<number, bigint> }) => sum(Object.values(d.byKind));

// …what the DAILY view (a rolling 30 days) can see.
const revenue30 = sellingRevenue.filter((d) => inWindow(d.ago, WINDOW_DAYS));
const expenses30 = sellingExpenses.filter((d) => inWindow(d.ago, WINDOW_DAYS));

const MARGIN = sum(revenue30.map((d) => d.expectedMargin));
const SPENT = sum(expenses30.map(dayTotal));
const PROFIT = MARGIN - SPENT;

const ADS_SPENT = sum(expenses30.map((d) => d.byKind[ExpenseKind.ADS] ?? 0n));

// …and what the MONTHLY view (the last twelve months) can. Every fixture row is inside it by
// construction — the furthest back is 200 days, and the window's near edge is at least 334 — which the
// grain stories assert rather than assume.
const MONTHLY_BUCKETS = 12;
const OLDEST_AGO = Math.max(...[...sellingRevenue, ...sellingExpenses].map((d) => d.ago));
const MARGIN_12M = sum(sellingRevenue.map((d) => d.expectedMargin));
const SPENT_12M = sum(sellingExpenses.map(dayTotal));
const PROFIT_12M = MARGIN_12M - SPENT_12M;

const FEES = sum(warehouseFees.map((d) => d.handlingFee));
const COD = sum(warehouseFees.map((d) => d.codFee));
const WAREHOUSE_STOCK_LOSS = sum(
  warehouseExpenses.map((d) => d.byKind[ExpenseKind.STOCK_LOSS] ?? 0n),
);

// The days ANYTHING happened on inside the daily window, either side — the rows that survive "hide
// quiet days".
const ACTIVE = [...new Set([...revenue30, ...expenses30].map((d) => d.ago))].sort((a, b) => a - b);
// A day inside the window with nothing on it from either service. 4 is deliberate: it sits between
// two active days, so a missing row here would be a hole in the middle rather than a short tail.
const QUIET_AGO = 4;

// The day the fixtures make a LOSS: 170.000 of expected margin against 500.000 of ads and operational.
const LOSS_AGO = 5;
const LOSS_PROFIT =
  (sellingRevenue.find((d) => d.ago === LOSS_AGO)?.expectedMargin ?? 0n) -
  dayTotal(sellingExpenses.find((d) => d.ago === LOSS_AGO)!);

// A month the DAILY view cannot reach — the one that proves a monthly rollup is reading more than the
// last thirty days.
const OLD_MONTH_AGO = 200;

const meta = {
  title: "Pages/Statements/DailyStatementPage",
  component: DailyStatementPage,
  parameters: {
    // `useTeam()` throws outside a TeamProvider, and this page reads the current team on every path.
    signedIn: true,
  },
  beforeEach: asTeam(SELLING.id),
} satisfies Meta<typeof DailyStatementPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// The table is waited for rather than any single row: the screen holds a spinner until BOTH services
// have answered, and an assertion racing that reads one service's answer as the whole statement.
async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await waitFor(() => expect(canvas.getByTestId("statement-table")).toBeInTheDocument(), {
    timeout: 3000,
  });

  return canvas;
}

// Switch the grain and wait for the table to have been rebuilt at it.
//
// `listQuery` keeps the previous rows on screen while the next window loads, so the old grain's table
// is still there for a beat after the click — asserting immediately would read the DAILY rows and pass
// for the wrong reason. The wait is on the row count changing, which is the first thing that does.
async function pickGrain(canvas: ReturnType<typeof within>, grain: "day" | "month" | "year") {
  const rowsNow = canvas.queryAllByTestId(/^statement-row-/).length;

  await userEvent.click(canvas.getByTestId(`statement-grain-${grain}`));
  await waitFor(() =>
    expect(canvas.queryAllByTestId(/^statement-row-/).length).not.toBe(rowsNow),
  );

  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// The same screen for the building rather than the shop. Worth its own entry in the sidebar and not
// only a `play()`: the two versions differ by five columns and two notices, and that is a difference
// somebody should be able to SEE beside the other rather than read in an assertion.
export const Warehouse: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
};

// The other two grains, as states rather than only as assertions — the whole point of a grain is what
// it LOOKS like, and twelve months of one row each is a different screen from thirty days of them.
//
// They open on Daily and switch, because that is the real path: a grain is not a route, and a story
// that mounted straight into Monthly would skip the re-picked window that makes Monthly readable.
export const Monthly: Story = {
  play: async ({ canvasElement }) => {
    await pickGrain(await loaded(canvasElement), "month");
  },
};

export const Yearly: Story = {
  play: async ({ canvasElement }) => {
    await pickGrain(await loaded(canvasElement), "year");
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// EVERY DAY IN THE PERIOD GETS A ROW, including the ones nothing happened on. That is what makes this
// a statement rather than a list of things that happened: a gap where the 14th should be leaves the
// reader unable to tell "nothing was sold" from "the 14th did not load", and only one of those is
// worth getting out of a chair for.
//
// The three series are SPARSE and the date spine is built on the CLIENT, so this rule is entirely the
// screen's to keep.
export const EveryDayInThePeriodGetsARowIncludingTheQuietOnes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(WINDOW_DAYS));

    // Present, and MARKED as quiet — dimmed rather than dropped.
    await expect(canvas.getByTestId(`statement-row-${dayKey(QUIET_AGO)}`)).toHaveAttribute(
      "data-quiet",
      "true",
    );
    await expect(canvas.getByTestId(`statement-row-${dayKey(ACTIVE[0]!)}`)).not.toHaveAttribute(
      "data-quiet",
    );
  },
};

// …and the toggle is the buy-out, for a long range over a young team where the signal is five rows in
// three hundred. It says how much it is hiding, which is what keeps it from reading as "these are all
// the days there were".
export const HidingQuietDaysLeavesOnlyTheDaysThatTraded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-day-count")).toHaveTextContent(
        `${WINDOW_DAYS} of ${WINDOW_DAYS}`,
      ),
    );

    await userEvent.click(canvas.getByTestId("statement-hide-quiet"));

    await waitFor(() =>
      expect(canvas.queryByTestId(`statement-row-${dayKey(QUIET_AGO)}`)).toBeNull(),
    );
    await expect(canvas.getByTestId("statement-day-count")).toHaveTextContent(
      `${ACTIVE.length} of ${WINDOW_DAYS}`,
    );

    for (const ago of ACTIVE) {
      await expect(canvas.getByTestId(`statement-row-${dayKey(ago)}`)).toBeInTheDocument();
    }
  },
};

// ⚠ THE FOOTER IS THE SERVER'S PERIOD TOTAL, AND HIDING ROWS MUST NOT MOVE IT. A footer that summed
// what is on screen would change the moment somebody hid days worth nothing — a total that shifts
// while the money did not, which reads as the filter having spent something.
export const TheFooterIsThePeriodTotalAndDoesNotFollowTheQuietFilter: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-footer-profit")).toHaveTextContent(formatRupiah(PROFIT)),
    );

    await userEvent.click(canvas.getByTestId("statement-hide-quiet"));

    await waitFor(() =>
      expect(canvas.queryByTestId(`statement-row-${dayKey(QUIET_AGO)}`)).toBeNull(),
    );
    await expect(canvas.getByTestId("statement-footer-profit")).toHaveTextContent(
      formatRupiah(PROFIT),
    );
  },
};

// A BAD DAY SURVIVES A GOOD PERIOD. The fixtures spend more than they earn on one day inside a period
// that still closes ahead, which is the ordinary case — and the entire argument for a daily statement
// existing beside the monthly screens. A row that netted its loss into the period would only answer
// the question the Profit page already answers.
export const ALosingDayIsVisibleInsideAProfitablePeriod: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(LOSS_PROFIT < 0n).toBe(true);
    const row = await canvas.findByTestId(`statement-row-${dayKey(LOSS_AGO)}`);
    await waitFor(() => expect(row).toHaveTextContent(formatRupiah(LOSS_PROFIT)));

    // …while the period itself is ahead, and says so without the loss caption.
    await expect(PROFIT > 0n).toBe(true);
    await expect(canvas.getByTestId("statement-total-profit")).toHaveTextContent(
      formatRupiah(PROFIT),
    );
    await expect(canvas.queryByTestId("statement-loss")).toBeNull();
  },
};

// A SELLING STATEMENT SUBTRACTS TWO DIFFERENT KINDS OF CERTAINTY, and says so. The expenses are money
// that genuinely left the business; the margin is only what we EXPECT, with no marketplace payout
// reconciled against it. An unlabelled money screen is read as cash in the bank.
export const ASellingStatementSaysItsIncomeIsOnlyExpected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("statement-expected-notice")).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-margin")).toHaveTextContent(formatRupiah(MARGIN)),
    );
  },
};

// …and the WAREHOUSE does not get it. Both sides of its statement are real ledger movements — fees it
// actually charged, stock it actually wrote off — so the same warning here would be crying wolf about
// the one screen in this pair that has nothing to warn about.
export const AWarehouseStatementCarriesNoExpectedNotice: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("statement-expected-notice")).toBeNull();
    await expect(canvas.queryByTestId("statement-unknown-cost")).toBeNull();
  },
};

// ⚠ COD IS NOT INCOME, and in the fixtures it is worth roughly twice the fees. A warehouse pays a
// courier at the door for goods it does not own and is owed the money back, so counting it would
// inflate income against an outflow that was never recorded as an expense — here it would report
// about three times the profit the building actually made.
//
// It is SHOWN, because the warehouse is genuinely owed it, and the notice is what stops the number
// above it from looking like a mistake.
export const AWarehouseEarnsItsHandlingFeesAndNotItsCodFloat: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-margin")).toHaveTextContent(formatRupiah(FEES)),
    );

    // The float is bigger than the earnings, which is what makes the exclusion load-bearing.
    await expect(COD > FEES).toBe(true);
    await expect(canvas.getByTestId("statement-cod-notice")).toHaveTextContent(formatRupiah(COD));
  },
};

// STOCK LOSS IS CALLED OUT WHERE THERE IS SOME, AND NOWHERE ELSE. Rent is a decision somebody made; a
// dropped pallet is not, and only one of the two is worth a manager's morning — which is the whole
// reason it was given its own expense kind rather than sitting inside Operational.
export const TheStockLossLineAppearsOnTheStatementThatHasSome: Story = {
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-stock-loss")).toHaveTextContent(
        formatRupiah(WAREHOUSE_STOCK_LOSS),
      ),
    );
    await expect(canvas.getByTestId("statement-total-stock-loss")).toHaveTextContent(
      /stock written off/i,
    );
  },
};

// A selling team never writes stock off — inventory posts every loss against the warehouse's team —
// so an unconditional line would print "of which Rp 0" on every selling statement forever, which is a
// caption that has stopped saying anything and trains the eye to skip the line that will one day
// matter.
export const ASellingStatementShowsNoStockLossLine: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-stock-loss")).toHaveTextContent(
        /recorded against this period/i,
      ),
    );
  },
};

// AN ORDER WITH AN UNKNOWN COST COUNTS AS PURE PROFIT (#74), so it pushes every figure on this screen
// UP. It matters more here than on the revenue list: this is the screen somebody reads to decide
// whether the month was any good.
export const AnOrderWithAnUnknownCostIsCalledOutAsAnOverstatement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("statement-unknown-cost")).toHaveTextContent(
      /overstated/i,
    );
  },
};

// THE KIND FILTER NARROWS THE EXPENSE HALF ONLY — revenue has no kinds. "Which days did we spend the
// ads budget" is a question this table can answer directly, and it must not answer it by also moving
// the income the spending is being compared against.
export const TheKindFilterNarrowsTheSpendingAndLeavesTheIncomeAlone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-expenses")).toHaveTextContent(formatRupiah(SPENT)),
    );

    // ExpenseKindSelect portals its listbox, so the option is on `screen`, not in the canvas.
    await userEvent.click(canvas.getByTestId("statement-kind"));
    const ads = await screen.findByTestId(`statement-kind-${ExpenseKind.ADS}`);
    await waitFor(() => expect(ads).toBeVisible());
    await userEvent.click(ads);

    await expect(ADS_SPENT < SPENT).toBe(true);
    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-expenses")).toHaveTextContent(
        formatRupiah(ADS_SPENT),
      ),
    );

    // The income is untouched, so profit moved by exactly what the filter hid and nothing else.
    await expect(canvas.getByTestId("statement-total-margin")).toHaveTextContent(
      formatRupiah(MARGIN),
    );
    await expect(canvas.getByTestId("statement-total-profit")).toHaveTextContent(
      formatRupiah(MARGIN - ADS_SPENT),
    );
  },
};

// THE WINDOW IS THE PERIOD — the spine, the totals and the per-day average all follow it. A quick
// range is RELATIVE and live, so this asserts against the clock the story runs on rather than a date
// typed into a fixture.
export const NarrowingTheWindowNarrowsTheSpineAndTheTotals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(WINDOW_DAYS));

    // The picker's panel is portalled too.
    await userEvent.click(canvas.getByTestId("statement-range"));
    const last7 = await screen.findByTestId("statement-range-quick-7");
    await waitFor(() => expect(last7).toBeVisible());
    await userEvent.click(last7);

    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(7));

    // The days that fell out took their money with them.
    const kept = sum(revenue30.filter((d) => inWindow(d.ago, 7)).map((d) => d.expectedMargin));
    await expect(kept < MARGIN).toBe(true);
    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-margin")).toHaveTextContent(formatRupiah(kept)),
    );

    const dropped = revenue30.find((d) => !inWindow(d.ago, 7))!;
    await expect(canvas.queryByTestId(`statement-row-${dayKey(dropped.ago)}`)).toBeNull();
  },
};

// ── The grain ───────────────────────────────────────────────────────────────────────────────────

// ⚠ THE ROLLUP MUST NOT LOSE OR INVENT A DAY. This is the one thing a grain can get wrong that nobody
// would notice: a monthly total that quietly covered only the recent weeks looks perfectly plausible,
// and it is exactly what a rollup written over the daily view's own window would produce.
//
// The fixtures make it visible on purpose — two months of money sit outside the 30-day window, so a
// monthly total that matched the daily one would be the bug rather than a coincidence.
export const TheMonthlyRollupCoversMonthsTheDailyViewCannotSee: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    // The fixtures' furthest-back row has to be inside the 12-month window for any of this to mean
    // anything, and the window's near edge is at worst 334 days back.
    await expect(OLDEST_AGO).toBeLessThan(334);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-profit")).toHaveTextContent(formatRupiah(PROFIT)),
    );

    await pickGrain(canvas, "month");

    await expect(PROFIT_12M).not.toBe(PROFIT);
    await waitFor(() =>
      expect(canvas.getByTestId("statement-total-margin")).toHaveTextContent(
        formatRupiah(MARGIN_12M),
      ),
    );
    await expect(canvas.getByTestId("statement-total-expenses")).toHaveTextContent(
      formatRupiah(SPENT_12M),
    );
    await expect(canvas.getByTestId("statement-footer-profit")).toHaveTextContent(
      formatRupiah(PROFIT_12M),
    );

    // The month that was invisible a moment ago now has a row, and it is not a quiet one.
    const old = canvas.getByTestId(`statement-row-${dayKey(OLD_MONTH_AGO).slice(0, 7)}`);
    await expect(old).not.toHaveAttribute("data-quiet");
  },
};

// A GRAIN CARRIES ITS OWN WINDOW, because thirty days of MONTHS is one row — and one row under a
// picker that says "Monthly" reads as a broken screen rather than as a window too short to be one.
// Switching back restores the daily window, so the grain is a view and not a one-way door.
export const SwitchingTheGrainRePicksTheWindow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(WINDOW_DAYS));

    await pickGrain(canvas, "month");
    await waitFor(() =>
      expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(MONTHLY_BUCKETS),
    );

    await pickGrain(canvas, "day");
    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(WINDOW_DAYS));
  },
};

// THE AVERAGE IS PER ROW, and it has to follow the grain: "about 25.000 a month" and "about 25.000 a
// day" are the same digits saying two entirely different things, and a per-day figure sitting above a
// per-month table has nothing on screen to say which one it is.
export const TheAverageFollowsTheGrain: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() =>
      expect(canvas.getByTestId("statement-per-day")).toHaveTextContent(
        formatRupiah(PROFIT / BigInt(WINDOW_DAYS)),
      ),
    );
    await expect(canvas.getByText(/per day/i)).toBeInTheDocument();

    await pickGrain(canvas, "month");

    await waitFor(() =>
      expect(canvas.getByTestId("statement-per-day")).toHaveTextContent(
        formatRupiah(PROFIT_12M / BigInt(MONTHLY_BUCKETS)),
      ),
    );
    await expect(canvas.getByText(/per month/i)).toBeInTheDocument();
    await expect(canvas.getByText(/averaged over 12 months/i)).toBeInTheDocument();
  },
};

// ⚠ A YEARLY VIEW IS ONE ROW, AND THE SCREEN SAYS WHY. The series underneath is DAILY and capped at a
// leap year, so "last year beside this one" is a window this screen is not allowed to ask for — and a
// lone row under a picker that says Yearly is indistinguishable from a screen that failed to load.
//
// Shipping the limitation with a sentence attached beats hiding the grain until the contract grows one:
// the row is real, the total is right, and what is missing is named rather than guessed at.
export const AYearlyViewIsOneRowAndSaysWhyItCannotBeTwo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickGrain(canvas, "year");

    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(1));
    await expect(canvas.getByTestId("statement-grain-capped")).toHaveTextContent(/only show this year/i);

    // With ONE bucket, the row IS the period — so the running total, the row's profit and the footer are
    // three renderings of a single number, and any of them drifting shows up here.
    const year = new Date().getFullYear().toString();
    const row = canvas.getByTestId(`statement-row-${year}`);
    const total = canvas.getByTestId("statement-total-profit").textContent!;

    await expect(row).toHaveTextContent(total);
    await expect(canvas.getByTestId("statement-footer-profit")).toHaveTextContent(total);
  },
};

// The daily grain is the DEFAULT, and stays it. The screen is read at a shelf to answer "what happened
// yesterday" far more often than "how was the year", so a grain that remembered its last setting would
// make the common case a click every time.
export const TheScreenOpensOnDaily: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getAllByTestId(/^statement-row-/)).toHaveLength(WINDOW_DAYS));
    await expect(canvas.getByTestId(`statement-row-${dayKey(0)}`)).toBeInTheDocument();
    await expect(canvas.queryByTestId("statement-grain-capped")).toBeNull();
  },
};

// AN UNBOUNDED RANGE IS REFUSED, NOT GUESSED AT — and nothing is sent. A daily statement needs both
// ends, because its response length IS the span; that is the same call the server makes, and the same
// reason neither Daily RPC has a page cursor.
//
// Refused rather than silently clamped to something sensible: a clamped range answers a question
// nobody asked, with a total that looks like the one they wanted.
export const ClearingTheWindowRefusesRatherThanGuessingAPeriod: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("statement-range"));
    const clear = await screen.findByTestId("statement-range-clear");
    await waitFor(() => expect(clear).toBeVisible());
    await userEvent.click(clear);

    await expect(await canvas.findByTestId("statement-range-invalid")).toHaveTextContent(
      /start and an end date/i,
    );
    // The screen says why, instead of showing half an answer.
    await expect(canvas.queryByTestId("statement-table")).toBeNull();
    await expect(canvas.queryByTestId("statement-summary")).toBeNull();
  },
};
