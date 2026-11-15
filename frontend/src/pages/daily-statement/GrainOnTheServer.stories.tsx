import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { dayKey, expenseDays, liabilityDays } from "../../../.storybook/fixtures";
import { statementCalls } from "../../../.storybook/statementScenario";
import { LAST_MONTH } from "../../components/datetime/DateRangePicker";
import { GroupType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { firstOfMonthBack, jakartaToday, jakartaWindowOf } from "../../lib/jakartaDay";
import { bucketOf } from "../../lib/period";
import { DailyStatementPage } from "./index";
import { WAREHOUSE, expectTheYardstick, loaded, pickGrain, plantDays } from "./storyYardstick";

// THE GRAIN IS THE SERVER'S (periods-are-grouped-on-the-server) — the warehouse's statement at Harian, Bulanan and
// Tahunan, run as tests while the page's own story file stays `!test` (the-daily-report-is-deferred).
//
// The screen sends the grain and lays the server's rows on its spine; it no longer adds days into months. What must NOT
// change is what a reader sees, so every month's and every year's row is checked against a YARDSTICK
// (`storyYardstick.ts`): the rollup the browser used to do — the fixture's days summed by the `yyyy-mm` / `yyyy`
// prefix — cell by cell.
//
// A new grain re-picks the window (the-yearly-statement-opens-on-five-years — `PerGrainSpan.stories.tsx` pins it on a
// held clock): the stories open on the default last month and switch, so Bulanan reads the last twelve months and
// Tahunan 1 January four years back → today.
//
// Gudang Pusat (11) gets extra days for these stories only: the LAST day of the previous month and the FIRST of this one
// (a month boundary inside every window), and 31 December / 1 January (a year boundary — inside the five years always,
// inside the twelve months whenever today is not in December).

const today = jakartaToday();
const dayOfMonth = Number(today.slice(8, 10));
const daysBack = (day: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
const lastYear = Number(today.slice(0, 4)) - 1;

const EXTRA_FEES: typeof liabilityDays = [
  // The last day of the previous month, and the first of this one.
  { teamId: WAREHOUSE.id, ago: dayOfMonth, handlingFee: 70_000, codFee: 30_000 },
  { teamId: WAREHOUSE.id, ago: dayOfMonth - 1, handlingFee: 45_000, codFee: 0 },
  // Two months back — a month the daily view cannot see.
  { teamId: WAREHOUSE.id, ago: dayOfMonth + 40, handlingFee: 125_000, codFee: 60_000 },
  // 31 December and 1 January.
  { teamId: WAREHOUSE.id, ago: daysBack(`${lastYear}-12-31`), handlingFee: 90_000, codFee: 10_000 },
  { teamId: WAREHOUSE.id, ago: daysBack(`${lastYear + 1}-01-01`), handlingFee: 55_000, codFee: 5_000 },
];

const EXTRA_EXPENSES: typeof expenseDays = [
  { teamId: WAREHOUSE.id, ago: dayOfMonth, byKind: { [ExpenseKind.STOCK_LOSS]: 20_000, [ExpenseKind.PAYROLL]: 300_000 } },
  { teamId: WAREHOUSE.id, ago: dayOfMonth - 1, byKind: { [ExpenseKind.OPERATIONAL]: 15_000 } },
  { teamId: WAREHOUSE.id, ago: dayOfMonth + 40, byKind: { [ExpenseKind.OTHER]: 80_000 } },
  { teamId: WAREHOUSE.id, ago: daysBack(`${lastYear}-12-31`), byKind: { [ExpenseKind.STOCK_LOSS]: 12_000 } },
  { teamId: WAREHOUSE.id, ago: daysBack(`${lastYear + 1}-01-01`), byKind: { [ExpenseKind.OPERATIONAL]: 7_000 } },
];

// The windows each grain opens on: the rolling last month; twelve calendar months, the first of them whole; five
// calendar years, this one to date.
const LAST_MONTH_WINDOW = jakartaWindowOf(LAST_MONTH);
const TWELVE_MONTHS = { from: firstOfMonthBack(today, 11), to: today };
const FIVE_YEARS = { from: `${lastYear - 3}-01-01`, to: today };

const meta = {
  title: "Pages/Statements/DailyStatementPage/Grain",
  component: DailyStatementPage,
  parameters: { signedIn: true },
  beforeEach: [asTeam(WAREHOUSE.id), plantDays(EXTRA_FEES, EXTRA_EXPENSES)],
} satisfies Meta<typeof DailyStatementPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const last = (calls: GroupType[]) => calls[calls.length - 1];

// The grain goes ON THE WIRE, to both services: Harian asks for days, Bulanan for months, Tahunan for years.
export const EachGrainIsAskedOfTheServer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(last(statementCalls.expense)).toBe(GroupType.DAILY));
    await expect(last(statementCalls.liability)).toBe(GroupType.DAILY);

    await pickGrain(canvas, "month", TWELVE_MONTHS);
    await waitFor(() => expect(last(statementCalls.expense)).toBe(GroupType.MONTHLY));
    await expect(last(statementCalls.liability)).toBe(GroupType.MONTHLY);

    await pickGrain(canvas, "year", FIVE_YEARS);
    await waitFor(() => expect(last(statementCalls.expense)).toBe(GroupType.YEARLY));
    await expect(last(statementCalls.liability)).toBe(GroupType.YEARLY);
  },
};

// Harian is what it was: every day of the rolling month, the two boundary days carrying their own figures.
export const TheDailyRowsAreTheDaysTheyWere: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const expected = await expectTheYardstick(canvas, LAST_MONTH_WINDOW, "day");

    // The last day of the previous month and the first of this one are both on screen, each with its own money.
    await expect(expected.get(dayKey(dayOfMonth))!.fees).toBeGreaterThanOrEqual(70_000);
    await expect(expected.get(dayKey(dayOfMonth - 1))!.fees).toBeGreaterThanOrEqual(45_000);
  },
};

// Bulanan over the twelve months it opens on — each month's row is the sum of its days, exactly as the browser used to
// add them, the month boundary and a month the daily view cannot see included.
export const AMonthsRowIsTheSumOfItsDays: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickGrain(canvas, "month", TWELVE_MONTHS);
    const expected = await expectTheYardstick(canvas, TWELVE_MONTHS, "month");

    // The previous month holds its last day's 70.000 — it did not slide into this month.
    const previous = bucketOf(dayKey(dayOfMonth), "month");
    await expect(previous).not.toBe(today.slice(0, 7));
    await expect(expected.get(previous)!.fees).toBeGreaterThanOrEqual(70_000);
  },
};

// Tahunan over the five years it opens on — a row per year, each the sum of its days: 31 December stays in its own
// year, 1 January opens the next.
export const AYearsRowIsTheSumOfItsDays: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickGrain(canvas, "year", FIVE_YEARS);
    const expected = await expectTheYardstick(canvas, FIVE_YEARS, "year");

    await expect(canvas.getAllByTestId(/^statement-row-/).map((row: HTMLElement) => row.dataset.testid)).toEqual(
      [lastYear - 3, lastYear - 2, lastYear - 1, lastYear, lastYear + 1].map((y) => `statement-row-${y}`),
    );
    // 31 December's 90.000 is last year's, 1 January's 55.000 this year's.
    await expect(expected.get(String(lastYear))!.fees).toBeGreaterThanOrEqual(90_000);
    await expect(expected.get(String(lastYear + 1))!.fees).toBeGreaterThanOrEqual(55_000);
  },
};
