import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { dayKey, teams } from "../../../.storybook/fixtures";
import { settlementWindowCalls } from "../../../.storybook/settlementAnalyticStub";
import { jakartaWindowOf } from "../../lib/jakartaDay";
import { formatRupiah } from "../../lib/money";
import { SettlementReportPage } from "./index";

// THE SETTLEMENT REPORT — sales against what the marketplace actually moved, over time and by who
// carries the shortfall (docs/business/settlement/analytic_context.md).
//
// Every number below comes from ONE ledger book in `.storybook/fixtures.ts` (settlementBook), folded by the stub
// with settlement_service's own rules (settlementAnalyticStub.ts): a 300.000 sale, 250.000 arriving less 15.000 of ads
// fees, 200.000 withdrawn, and a 120.000 sale placed and cancelled with a 5.000 claim. So the window reads 300.000 sold,
// 240.000 received, a 60.000 gap — 20% — and a position to date of 260.000. The stories check the screen against that
// arithmetic, not against itself.

const SELLING = teams.find((t) => t.id === 12n)!; // Toko Melati

// formatRupiah uses a no-break space; toHaveTextContent normalises the element's whitespace, so the
// expectation is normalised the same way.
const rp = (amount: bigint) => formatRupiah(amount).replace(/\s/g, " ");

const meta = {
  title: "Pages/Settlement/Report",
  component: SettlementReportPage,
  parameters: { signedIn: true },
  beforeEach: asTeam(SELLING.id),
} satisfies Meta<typeof SettlementReportPage>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await waitFor(
    () => expect(canvas.getByTestId("report-sales-value")).toHaveTextContent(rp(300_000n)),
    { timeout: 3000 },
  );

  return canvas;
}

// THE WINDOW IS JAKARTA DAYS (backlog #36, the-system-runs-on-jakarta-time): at 23:30 UTC on 6 Nov it is already 06:30
// WIB on 7 Nov, so "the last 7 days" asks for 1–7 Nov — never the viewer's own midnight (a UTC browser would have sent
// 31 Oct – 6 Nov). The clock is held at that instant for this story alone.
const LATE = new Date("2026-11-06T23:30:00Z").getTime();

export const TheWindowIsJakartaDaysAt2330Utc: Story = {
  parameters: { dataRouter: true },
  render: routedPage([{ path: "/settlement/report", element: <SettlementReportPage /> }], "/settlement/report?range=7d"),
  beforeEach: () => {
    settlementWindowCalls.splice(0);
    const Real = Date;
    class Late extends Real {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(LATE);
        else super(...(args as [string | number | Date]));
      }

      static now() {
        return LATE;
      }
    }
    globalThis.Date = Late as DateConstructor;

    return () => {
      globalThis.Date = Real;
    };
  },
  play: async () => {
    await waitFor(() => expect(settlementWindowCalls.length).toBeGreaterThan(0), { timeout: 3000 });
    await expect(settlementWindowCalls.at(-1)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
  },
};

// The headline is the WHOLE WINDOW, asked of the server — never a sum of the page of periods below it.
export const TheWindowInSixNumbers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("report-received-value")).toHaveTextContent(rp(240_000n));
    await expect(canvas.getByTestId("report-withdrawn-value")).toHaveTextContent(rp(200_000n));
    await expect(canvas.getByTestId("report-gap-value")).toHaveTextContent(rp(60_000n));
    await expect(canvas.getByTestId("report-take-rate-value")).toHaveTextContent("20%");
    await expect(canvas.getByTestId("report-position-value")).toHaveTextContent(rp(260_000n));
  },
};

// withdrawal-counts-in-the-position · the-report-headline-is-position-to-date: a withdrawal is NOT
// received — the gap stays the platform's take — but it moves the position, which is therefore labelled
// "Position to date" and never "hidden cost".
export const AWithdrawalMovesThePositionNotTheGap: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const day = await canvas.findByTestId(`report-series-row-${dayKey(2)}`);
    const cells = within(day).getAllByRole("cell");

    // period · sold · received · withdrawn · gap · take rate · position
    await expect(cells[2]).toHaveTextContent(rp(0n));
    await expect(cells[3]).toHaveTextContent(rp(200_000n));
    await expect(cells[6]).toHaveTextContent(rp(265_000n));
    await expect(canvas.queryByText(/hidden cost/i)).toBeNull();
  },
};

// ⚠ A CANCELLED SALE IS NOT A SALE. The 120.000 placed and cancelled yesterday nets to nothing, so the
// window sold 300.000 — not 420.000. Counting the placement and ignoring the cancel is the one mistake
// this number is most likely to make.
export const ACancelledSaleNetsToNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const yesterday = await canvas.findByTestId(`report-series-row-${dayKey(1)}`);
    const cells = within(yesterday).getAllByRole("cell");

    // period · sold · received · withdrawn · gap · take rate · position
    await expect(cells[1]).toHaveTextContent(rp(0n));
    await expect(cells[2]).toHaveTextContent(rp(5_000n));
  },
};

// Every period in the window is a row, NEWEST first — and a quiet day still carries the position
// forward rather than dropping to nothing.
export const AQuietDayCarriesTheShortfall: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await canvas.findByTestId("report-series-table");
    const rows = within(table).getAllByRole("row");

    // rows[0] is the header; the first data row is TODAY, which had no movement at all.
    await expect(rows[1]).toHaveAttribute("data-testid", `report-series-row-${dayKey(0)}`);

    const today = within(rows[1]!).getAllByRole("cell");
    await expect(today[1]).toHaveTextContent(rp(0n));
    await expect(today[6]).toHaveTextContent(rp(260_000n));
  },
};

// Ranked by the POSITION each carries — Melati Official's 250.000 (its 50.000 gap and the 200.000 it withdrew) before
// Melati Store's 10.000.
export const RankedByTheShortfallTheyCarry: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = await canvas.findByTestId("report-groups-table");

    await waitFor(() => expect(within(table).getByText("Melati Official")).toBeInTheDocument());

    const rows = within(table).getAllByRole("row");
    await expect(rows[1]).toHaveAttribute("data-testid", "report-group-row-21");
    await expect(rows[2]).toHaveAttribute("data-testid", "report-group-row-22");
  },
};

// By PERSON the rows are named from user_service — settlement only ever holds the id.
export const ByPersonNamesThePeople: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("report-group-user"));

    const ani = await canvas.findByTestId("report-group-row-61", {}, { timeout: 3000 });
    await waitFor(() => expect(ani).toHaveTextContent("Ani Rahayu"));
  },
};

// A month is ROLLED UP on the server: the 300.000 sale lands in its month's row.
export const MonthlyRollsUpThePeriod: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("report-grain-month"));

    const month = `${dayKey(5).slice(0, 7)}-01`;
    const row = await canvas.findByTestId(`report-series-row-${month}`, {}, { timeout: 3000 });

    await waitFor(() => expect(within(row).getAllByRole("cell")[1]).toHaveTextContent(rp(300_000n)));
  },
};

// THE WINDOW, THE GRAIN AND THE RANKING LIVE IN THE URL (a-lists-filters-live-in-the-url) — opened at `?grain=month`
// the series is monthly; Per Pengguna is written back, the grain kept.
const AtFilteredUrl = routedPage(
  [{ path: "/settlement/report", element: <><SettlementReportPage /><LocationProbe /></> }],
  "/settlement/report?grain=month",
);

export const FiltersLiveInTheUrl: Story = {
  parameters: { dataRouter: true },
  render: () => <AtFilteredUrl />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const location = canvas.getByTestId("location-search");

    // Monthly: the sale in its month's row, and thirty days are at most two rows (a header over them).
    const month = `${dayKey(5).slice(0, 7)}-01`;
    const row = await canvas.findByTestId(`report-series-row-${month}`, {}, { timeout: 3000 });
    await waitFor(() => expect(within(row).getAllByRole("cell")[1]).toHaveTextContent(rp(300_000n)));
    await expect(within(canvas.getByTestId("report-series-table")).getAllByRole("row").length).toBeLessThanOrEqual(3);

    await userEvent.click(canvas.getByTestId("report-group-user"));
    await waitFor(() => expect(location).toHaveTextContent("group=user"));
    await expect(location).toHaveTextContent("grain=month");
  },
};

// ⚠ THE POSITION IS NEVER A DEBT. A label that promised a receivable would be wrong on every row — nobody
// is going to collect it (#the-report-headline-is-position-to-date).
export const NeverCallsItOwed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByText(/outstanding/i)).toBeNull();
    await expect(canvas.queryByText(/unpaid/i)).toBeNull();
    await expect(canvas.queryByText(/balance/i)).toBeNull();
  },
};

// AS OF WHEN (a-money-metric-says-as-of-when): the figures are a fold, never live, so the report says when its service
// last claimed an event — in Jakarta time, under the headline.
export const SaysAsOfWhen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("report-as-of")).toHaveTextContent("14:04 WIB");
  },
};

// A RANGE OVER A YEAR IS NOT LOADED (a-metric-reads-at-most-a-year; backlog #130). Today and the 400 days before it — 401
// days — picked on the calendar AFTER a loaded report: the line under the picker says a year at most, nothing is asked of
// the server for it, and NOTHING of the last window stays on screen — every tile `—`, no Over time row, no as-of, the
// ranking empty, no refusal. (TanStack kept a DISABLED query's last answer as its placeholder, so the last month's figures
// stood under a picker naming the 401-day window, as if they were its.) A valid range again loads as before.
const TODAY = dayKey(0);
const OVER_A_YEAR_FROM = dayKey(400);
const TILES = ["sales", "received", "withdrawn", "gap", "take-rate", "position"] as const;

/** Pick `from`–`to` on the page's range calendar, as a person does: the end day, back month by month to the start day, Apply. */
async function pickRange(canvas: ReturnType<typeof within>, from: string, to: string) {
  await userEvent.click(canvas.getByTestId("report-range"));
  // The panel portals — it is on `screen`, not in the canvas — and animates in before it takes a click.
  const end = await screen.findByTestId(`report-range-day-${to}`);
  await waitFor(() => expect(end).toBeVisible());
  await userEvent.click(end);
  for (let i = 0; i < 24 && screen.queryByTestId(`report-range-day-${from}`) === null; i++) {
    await userEvent.click(screen.getByTestId("report-range-prev"));
  }
  await userEvent.click(screen.getByTestId(`report-range-day-${from}`));
  await userEvent.click(screen.getByTestId("report-range-apply"));
}

async function aRangeOverAYearIsNotLoaded(canvasElement: HTMLElement, message: string) {
  const canvas = await loaded(canvasElement);
  // The loaded report the longer range must not keep showing.
  await waitFor(() => expect(canvas.getByTestId("report-as-of")).toBeVisible(), { timeout: 3000 });
  await waitFor(() => expect(canvas.getByTestId(`report-series-row-${TODAY}`)).toBeVisible(), { timeout: 3000 });
  await waitFor(() => expect(canvas.getByTestId("report-groups-table")).toBeVisible());
  settlementWindowCalls.splice(0);

  await pickRange(canvas, OVER_A_YEAR_FROM, TODAY);

  await expect(await canvas.findByTestId("report-range-invalid")).toHaveTextContent(message);
  for (const tile of TILES) {
    await waitFor(() => expect(canvas.getByTestId(`report-${tile}-value`)).toHaveTextContent("—"));
  }
  await expect(canvas.queryByTestId(`report-series-row-${TODAY}`)).toBeNull();
  await expect(canvas.queryByTestId("report-series-table")).toBeNull();
  await expect(canvas.getByTestId("report-series-empty")).toBeVisible();
  await expect(canvas.queryByTestId("report-groups-table")).toBeNull();
  await expect(canvas.getByTestId("report-groups-empty")).toBeVisible();
  await expect(canvas.queryByTestId("report-as-of")).toBeNull();
  await expect(canvas.queryByTestId("report-error")).toBeNull();
  // Not loaded: nothing was asked of the server for that window.
  await expect(settlementWindowCalls.filter((call) => call.from === OVER_A_YEAR_FROM)).toEqual([]);

  // A valid range again — the last 3 months, a window not read before — loads as before.
  const three = jakartaWindowOf({ kind: "relative", months: 3 });
  await userEvent.click(canvas.getByTestId("report-range"));
  const quick = await screen.findByTestId("report-range-quick-3m");
  await waitFor(() => expect(quick).toBeVisible());
  await userEvent.click(quick);

  await waitFor(() => expect(canvas.getByTestId("report-sales-value")).toHaveTextContent(rp(300_000n)), { timeout: 3000 });
  await expect(canvas.getByTestId("report-position-value")).toHaveTextContent(rp(260_000n));
  await expect(canvas.queryByTestId("report-range-invalid")).toBeNull();
  await waitFor(() => expect(canvas.getByTestId(`report-series-row-${TODAY}`)).toBeVisible(), { timeout: 3000 });
  await waitFor(() => expect(canvas.getByTestId("report-as-of")).toBeVisible(), { timeout: 3000 });
  await expect(settlementWindowCalls).toContainEqual({ from: three.from, to: three.to });
}

export const ARangeOverAYearIsNotLoaded: Story = {
  name: "A Range over a Year Is Not Loaded",
  play: async ({ canvasElement }) =>
    aRangeOverAYearIsNotLoaded(canvasElement, "That range covers 401 days. A report reads at most 366 — pick a year at most."),
};

export const ARangeOverAYearIsNotLoadedIndonesian: Story = {
  name: "A Range over a Year Is Not Loaded (Indonesian)",
  globals: { locale: "id" },
  play: async ({ canvasElement }) =>
    aRangeOverAYearIsNotLoaded(
      canvasElement,
      "Rentang itu mencakup 401 hari. Laporan membaca maksimal 366 hari — pilih paling lama setahun.",
    ),
};
