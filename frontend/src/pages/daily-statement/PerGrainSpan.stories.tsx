import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { expenseDays, liabilityDays } from "../../../.storybook/fixtures";
import { statementAsks } from "../../../.storybook/statementScenario";
import { LAST_MONTH } from "../../components/datetime/DateRangePicker";
import { GroupType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { firstOfMonthBack, jakartaToday, jakartaWindowOf } from "../../lib/jakartaDay";
import { bucketSpine, spanDays } from "../../lib/period";
import { DailyStatementPage } from "./index";
import {
  WAREHOUSE,
  type Canvas,
  type Window,
  expectTheYardstick,
  holdTheClock,
  loaded,
  pickGrain,
  plantDays,
} from "./storyYardstick";

// THE SPAN EACH GRAIN UNLOCKS (periods-are-grouped-on-the-server): Harian up to 366 days, Bulanan up to 60 months,
// Tahunan up to 20 years — the server's numbers (backend/pkgs/san_period), so a Tahunan over several years is ONE call
// per service answering a row per year.
//
// AND THE WINDOW EACH GRAIN OPENS ON (the-yearly-statement-opens-on-five-years):
//
//   a new grain     re-picks the window — Harian the last month, Bulanan the last 12 months (the first whole), Tahunan
//                   1 January four years back → today: five rows
//   a hand-picked   range stays until the grain is switched — three years of Tahunan read as three rows
//   too long        a range longer than the grain reads is KEPT, the line under the picker says how long it is and what
//                   the most is, and nothing is sent — never trimmed
//
// Gudang Pusat (11) gets a day in each of the last three years and one 20 months back (inside 24 months, outside any
// window Harian can read), for these stories only.

const today = jakartaToday();
const year = Number(today.slice(0, 4));
const daysBack = (day: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
const twentyMonthsBack = `${firstOfMonthBack(today, 20).slice(0, 8)}10`;

const EXTRA_FEES: typeof liabilityDays = [
  { teamId: WAREHOUSE.id, ago: daysBack(`${year - 2}-03-10`), handlingFee: 410_000, codFee: 20_000 },
  { teamId: WAREHOUSE.id, ago: daysBack(`${year - 1}-12-31`), handlingFee: 95_000, codFee: 0 },
  { teamId: WAREHOUSE.id, ago: daysBack(`${year}-01-01`), handlingFee: 64_000, codFee: 4_000 },
  { teamId: WAREHOUSE.id, ago: daysBack(twentyMonthsBack), handlingFee: 230_000, codFee: 0 },
];

const EXTRA_EXPENSES: typeof expenseDays = [
  { teamId: WAREHOUSE.id, ago: daysBack(`${year - 2}-03-10`), byKind: { [ExpenseKind.OTHER]: 150_000 } },
  { teamId: WAREHOUSE.id, ago: daysBack(`${year - 1}-12-31`), byKind: { [ExpenseKind.STOCK_LOSS]: 12_000 } },
  { teamId: WAREHOUSE.id, ago: daysBack(twentyMonthsBack), byKind: { [ExpenseKind.OPERATIONAL]: 33_000 } },
];

// Three calendar years, 1 January two years back through today; five, the window Tahunan opens on; 24 and 61 calendar
// months, the first of them whole.
const THREE_YEARS: Window = { from: `${year - 2}-01-01`, to: today };
const FIVE_YEARS: Window = { from: `${year - 4}-01-01`, to: today };
const TWENTY_FOUR_MONTHS: Window = { from: firstOfMonthBack(today, 23), to: today };
const SIXTY_ONE_MONTHS: Window = { from: firstOfMonthBack(today, 60), to: today };
const LAST_MONTH_WINDOW = jakartaWindowOf(LAST_MONTH);

// The page under its own router, opened at a URL — the grain and the window live there (a-lists-filters-live-in-the-url).
const at = (search: string) =>
  routedPage([{ path: "/statement", element: <><DailyStatementPage /><LocationProbe hidden /></> }], `/statement${search}`);
const range = (w: Window) => `range=${w.from}..${w.to}`;

const HarianOverThreeYears = at(`?${range(THREE_YEARS)}`);
const TahunanOverThreeYears = at(`?grain=year&${range(THREE_YEARS)}`);
const BulananOverTwentyFourMonths = at(`?grain=month&${range(TWENTY_FOUR_MONTHS)}`);
const BulananOverSixtyOneMonths = at(`?grain=month&${range(SIXTY_ONE_MONTHS)}`);
const TheDefaultWindow = at("");

const meta = {
  title: "Pages/Statements/DailyStatementPage/Span",
  component: DailyStatementPage,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: [asTeam(WAREHOUSE.id), plantDays(EXTRA_FEES, EXTRA_EXPENSES)],
} satisfies Meta<typeof DailyStatementPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// Every ask both services received — grain and window.
const asked = () => ({ expense: statementAsks.expense, liability: statementAsks.liability });
const ask = (groupBy: GroupType, w: Window) => ({ groupBy, from: w.from, to: w.to });
const both = (...asks: ReturnType<typeof ask>[]) => ({ expense: asks, liability: asks });
const rowIds = (canvas: Canvas) => canvas.getAllByTestId(/^statement-row-/).map((row: HTMLElement) => row.dataset.testid);

// The refusal line, and the screen drawing nothing else: no table, no summary.
async function expectRefused(canvas: Canvas, text: string) {
  await expect(await canvas.findByTestId("statement-range-invalid")).toHaveTextContent(text);
  await expect(canvas.queryByTestId("statement-table")).toBeNull();
  await expect(canvas.queryByTestId("statement-summary")).toBeNull();
}

// 1 January 2027, 00:30 in Jakarta — still 31 December 2026 on a UTC clock, so *this year* is Jakarta's or the story
// fails. Held for the story below, so every window it asks is written as dates.
const NEW_YEAR_IN_JAKARTA = "2026-12-31T17:30:00Z";

// A NEW GRAIN RE-PICKS THE WINDOW (the-yearly-statement-opens-on-five-years). From the default last month: Bulanan opens
// on the last twelve months, the first of them whole — twelve rows; Tahunan on 1 January four years back → today — five
// rows; each from ONE call per service over that window, at that grain. Back on Harian it is the last month again, and
// the URL drops the range (it is the default).
export const PickingAGrainRePicksTheWindow: Story = {
  beforeEach: holdTheClock(NEW_YEAR_IN_JAKARTA),
  render: () => <TheDefaultWindow />,
  play: async ({ canvasElement }) => {
    const lastMonth: Window = { from: "2026-12-02", to: "2027-01-01" };
    const twelveMonths: Window = { from: "2026-02-01", to: "2027-01-01" };
    const fiveYears: Window = { from: "2023-01-01", to: "2027-01-01" };
    await expect(jakartaWindowOf(LAST_MONTH)).toEqual(lastMonth);

    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");
    await expectTheYardstick(canvas, lastMonth, "day");
    await waitFor(() => expect(asked()).toEqual(both(ask(GroupType.DAILY, lastMonth))));

    await pickGrain(canvas, "month", twelveMonths);
    await expectTheYardstick(canvas, twelveMonths, "month");
    await expect(rowIds(canvas)).toEqual(bucketSpine(twelveMonths.from, twelveMonths.to, "month").map((m) => `statement-row-${m}`));
    await expect(rowIds(canvas)).toHaveLength(12);
    await expect(asked()).toEqual(both(ask(GroupType.DAILY, lastMonth), ask(GroupType.MONTHLY, twelveMonths)));
    await waitFor(() => expect(location).toHaveTextContent(range(twelveMonths)));

    await pickGrain(canvas, "year", fiveYears);
    await expectTheYardstick(canvas, fiveYears, "year");
    await expect(rowIds(canvas)).toEqual([2023, 2024, 2025, 2026, 2027].map((y) => `statement-row-${y}`));
    await expect(asked()).toEqual(
      both(ask(GroupType.DAILY, lastMonth), ask(GroupType.MONTHLY, twelveMonths), ask(GroupType.YEARLY, fiveYears)),
    );
    await waitFor(() => expect(location).toHaveTextContent(range(fiveYears)));
    await expect(location).toHaveTextContent("grain=year");
    await expect(canvas.queryByTestId("statement-range-invalid")).toBeNull();

    // Back on Harian: the last month, read again by day; the URL holds neither the grain nor the range.
    await pickGrain(canvas, "day", lastMonth);
    await expectTheYardstick(canvas, lastMonth, "day");
    await waitFor(() => expect(location).not.toHaveTextContent("grain="));
    await expect(location).not.toHaveTextContent("range=");
    await expect(canvas.getByTestId("statement-range")).toHaveTextContent(/last 1 month/i);
    await waitFor(() => expect(statementAsks.expense.at(-1)).toEqual(ask(GroupType.DAILY, lastMonth)));
    await expect(statementAsks.expense.slice(3).every((a) => a.groupBy === GroupType.DAILY && a.from === lastMonth.from)).toBe(true);
  },
};

// A HAND-PICKED RANGE STAYS until the grain is switched: Tahunan opened at three years reads three rows from ONE yearly
// call per service over the whole of it, each the sum of its year's days (31 December stays in its own year).
export const AHandPickedThreeYearsOfTahunanIsThreeRows: Story = {
  render: () => <TahunanOverThreeYears />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const expected = await expectTheYardstick(canvas, THREE_YEARS, "year");

    await expect(rowIds(canvas)).toEqual([year - 2, year - 1, year].map((y) => `statement-row-${y}`));
    await expect(asked()).toEqual(both(ask(GroupType.YEARLY, THREE_YEARS)));

    // Two years back carries its March day; last year its 31 December; this year its 1 January.
    await expect(expected.get(String(year - 2))!.fees).toBeGreaterThanOrEqual(410_000);
    await expect(expected.get(String(year - 1))!.stockLoss).toBeGreaterThanOrEqual(12_000);
    await expect(expected.get(String(year))!.fees).toBeGreaterThanOrEqual(64_000);
    await expect(canvas.queryByTestId("statement-range-invalid")).toBeNull();
  },
};

// BULANAN OVER 24 MONTHS — twenty-four rows from one MONTHLY call per service, each month the sum of its days; the month
// twenty back, beyond any window Harian can read, carries its own figures.
export const BulananOverTwentyFourMonthsIsTwentyFourRows: Story = {
  render: () => <BulananOverTwentyFourMonths />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const expected = await expectTheYardstick(canvas, TWENTY_FOUR_MONTHS, "month");

    await expect(bucketSpine(TWENTY_FOUR_MONTHS.from, TWENTY_FOUR_MONTHS.to, "month")).toHaveLength(24);
    await expect(spanDays(TWENTY_FOUR_MONTHS.from, TWENTY_FOUR_MONTHS.to)).toBeGreaterThan(366);
    await expect(asked()).toEqual(both(ask(GroupType.MONTHLY, TWENTY_FOUR_MONTHS)));

    const month = twentyMonthsBack.slice(0, 7);
    await expect(expected.get(month)).toEqual({ fees: 230_000, cod: 0, stockLoss: 0, other: 33_000 });
    await expect(canvas.getByTestId(`statement-row-${month}`)).not.toHaveAttribute("data-quiet");
    await expect(canvas.getByTestId("statement-day-count")).toHaveTextContent("Showing 24 of 24 months");
  },
};

// BACK TO HARIAN FROM A HAND-PICKED RANGE — the grain re-picks its window: the three years give way to the last month,
// read by day (never three years by day, never refused), and the URL drops the range.
export const BackToHarianOpensTheLastMonth: Story = {
  render: () => <TahunanOverThreeYears />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expectTheYardstick(canvas, THREE_YEARS, "year");

    await pickGrain(canvas, "day", LAST_MONTH_WINDOW);
    await expectTheYardstick(canvas, LAST_MONTH_WINDOW, "day");
    await expect(canvas.queryByTestId("statement-range-invalid")).toBeNull();

    // The URL write lands a beat after the screen answers — waited for.
    const location = canvas.getByTestId("location-search");
    await waitFor(() => expect(location).not.toHaveTextContent("grain=year"));
    await expect(location).not.toHaveTextContent("range=");
    await expect(asked()).toEqual(both(ask(GroupType.YEARLY, THREE_YEARS), ask(GroupType.DAILY, LAST_MONTH_WINDOW)));
  },
};

// A RANGE LONGER THAN HARIAN READS IS NAMED, NOT SENT — three years picked by hand at Harian: the line says it is more
// days than Harian reads, nothing is sent, and it is never trimmed to its last 366 days. The fix is the picker beside
// it: the last month reads at once.
export const AHarianRangeTooLongIsNamedAndNotSent: Story = {
  render: () => <HarianOverThreeYears />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expectRefused(canvas, `That range covers ${spanDays(THREE_YEARS.from, THREE_YEARS.to)} days. Daily reads at most 366 days.`);
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(range(THREE_YEARS));
    await expect(asked()).toEqual({ expense: [], liability: [] });

    await userEvent.click(canvas.getByTestId("statement-range"));
    const lastMonth = await screen.findByTestId("statement-range-quick-1m");
    await waitFor(() => expect(lastMonth).toBeVisible());
    await userEvent.click(lastMonth);
    await expectTheYardstick(canvas, LAST_MONTH_WINDOW, "day");
    await expect(asked()).toEqual(both(ask(GroupType.DAILY, LAST_MONTH_WINDOW)));
  },
};

// PAST WHAT A GRAIN UNLOCKS IS NOT SENT — 61 months is one more than Bulanan reads: the line names both numbers in
// months and nothing is sent. Switching to Tahunan re-picks its own window, the five years, and reads them at once.
export const PastSixtyMonthsBulananIsNotSentAndTahunanOpensOnFiveYears: Story = {
  render: () => <BulananOverSixtyOneMonths />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expectRefused(canvas, "That range covers 61 months. Monthly reads at most 60 months.");
    await expect(asked()).toEqual({ expense: [], liability: [] });

    await pickGrain(canvas, "year", FIVE_YEARS);
    await expectTheYardstick(canvas, FIVE_YEARS, "year");
    await expect(rowIds(canvas)).toHaveLength(5);
    await expect(asked()).toEqual(both(ask(GroupType.YEARLY, FIVE_YEARS)));
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent(range(FIVE_YEARS)));
  },
};
