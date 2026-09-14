import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { dayKey, teams } from "../../../.storybook/fixtures";
import { formatRupiah } from "../../lib/money";
import { SettlementReportPage } from "./index";

// THE SETTLEMENT REPORT — sales against what the marketplace actually moved, over time and by who
// carries the shortfall (docs/business/settlement/analytic_context.md).
//
// Every number below comes from ONE consistent book in `.storybook/fixtures.ts` (settlementReportDays):
// a 300.000 sale, 250.000 arriving less a 15.000 ads fee, and a 120.000 sale placed and cancelled with a
// 5.000 claim. So the window reads 300.000 sold, 240.000 received, a 60.000 gap — 20% — and 60.000 of
// hidden cost to date. The stories check the screen against that arithmetic, not against itself.

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

// The headline is the WHOLE WINDOW, asked of the server — never a sum of the page of periods below it.
export const TheWindowInFiveNumbers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("report-received-value")).toHaveTextContent(rp(240_000n));
    await expect(canvas.getByTestId("report-gap-value")).toHaveTextContent(rp(60_000n));
    await expect(canvas.getByTestId("report-take-rate-value")).toHaveTextContent("20%");
    await expect(canvas.getByTestId("report-hidden-cost-value")).toHaveTextContent(rp(60_000n));
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

    // period · sold · received · gap · take rate · hidden cost
    await expect(cells[1]).toHaveTextContent(rp(0n));
    await expect(cells[2]).toHaveTextContent(rp(5_000n));
  },
};

// Every period in the window is a row, NEWEST first — and a quiet day still carries the hidden cost
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
    await expect(today[5]).toHaveTextContent(rp(60_000n));
  },
};

// Ranked by who CARRIES the shortfall — Melati Official's 50.000 before Melati Store's 10.000.
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

// ⚠ THE POSITION IS HIDDEN COST, never a debt (#hidden-cost-is-left-in-the-balance). A label that
// promised a receivable would be wrong on every row — nobody is going to collect it.
export const NeverCallsItOwed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByText(/outstanding/i)).toBeNull();
    await expect(canvas.queryByText(/unpaid/i)).toBeNull();
    await expect(canvas.queryByText(/balance/i)).toBeNull();
  },
};
