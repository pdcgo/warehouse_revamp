import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, pickTeam } from "../../../.storybook/pageStory";
import { teams } from "../../../.storybook/fixtures";
import { dayAgo } from "../../../.storybook/supplierFigureFixtures";
import { formatRupiah } from "../../lib/money";
import { SupplierStatistics, description } from "./SupplierStatistics";

// A SUPPLIER'S STATISTICS TAB (the-figures-are-a-statistics-tab-and-a-supplier-report, the-figures-screens-are-accepted)
// — on both supplier details. The stub serves supplier_service's figures from supplierFigureFixtures.ts.
//
// PT Sumber Makmur (31) in the last 30 days — three accepts, and a fourth 40 days back that no default window counts:
//
//   2 days ago   Toko Melati    Beras  40 good  Rp 2.000.000 · 1 short Rp 50.000 · 2 broken Rp 100.000
//   5 days ago   Toko Kenanga   Gula   60 good  Rp   900.000 ·                    · 3 broken Rp  45.000
//   12 days ago  Toko Melati    Beras  30 good  Rp 1.500.000 ·                    · 1 broken Rp  50.000
//   ─────────────────────────────────────────────────────────────────────────────────────────────────
//   the window                         130 good Rp 4.400.000 · 1 short Rp 50.000 · 6 broken Rp 195.000 — 4,4% broken

const MELATI = teams.find((t) => t.id === 12n)!;

// formatRupiah uses a no-break space; toHaveTextContent normalises the element's whitespace.
const rp = (amount: bigint) => formatRupiah(amount).replace(/\s/g, " ");

const meta = {
  title: "Features/Suppliers/SupplierStatistics",
  component: SupplierStatistics,
  args: { supplierId: 31n },
  parameters: { signedIn: true, docs: { description: { component: description } } },
  beforeEach: asTeam(MELATI.id),
} satisfies Meta<typeof SupplierStatistics>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("statistics-summary-restocked-value")).not.toHaveTextContent("—"), {
    timeout: 3000,
  });
  return canvas;
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

export const OneTeamPicked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickTeam(canvas.getByTestId("statistics-team"), MELATI.teamCode);
  },
};

export const Monthly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("statistics-grain-month"));
  },
};

// Another team keeps it — Toko Kenanga's UD Makmur Jaya, as read from Discover.
export const AnotherTeamsSupplier: Story = { args: { supplierId: 34n } };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// The headline is the WHOLE window — every team's restocks by default (every-selling-team-sees-every-teams-figures) —
// never the page of periods under it, and never the accept 40 days back.
export const TheHeadlineIsTheWholeWindow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("statistics-summary-restocked-value")).toHaveTextContent(rp(4_400_000n));
    await expect(canvas.getByTestId("statistics-summary-restocked-units")).toHaveTextContent("130 units");
    await expect(canvas.getByTestId("statistics-summary-lost-value")).toHaveTextContent(rp(50_000n));
    await expect(canvas.getByTestId("statistics-summary-broken-value")).toHaveTextContent(rp(195_000n));
    // 6 broken of 137 received — broken beside restocked, never inside it.
    await expect(canvas.getByTestId("statistics-summary-rate-value")).toHaveTextContent("4,4%");
  },
};

// Every day of the window is a row, NEWEST first — a quiet day included, or it reads as a day that did not load.
export const EveryDayIsARowNewestFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const table = canvas.getByTestId("statistics-series");
    const rows = within(table).getAllByRole("row").slice(1);
    await expect(rows).toHaveLength(10);
    await expect(rows[0]).toHaveAttribute("data-testid", `statistics-series-row-${dayAgo(0)}`);

    // Today is quiet — a muted 0 per figure, no "Rp 0" under it; two days ago is Toko Melati's 40 Beras.
    await expect(within(rows[0]!).queryByText("Rp 0")).toBeNull();
    await expect(
      within(canvas.getByTestId(`statistics-series-row-${dayAgo(2)}`)).getByText(rp(2_000_000n)),
    ).toBeVisible();
  },
};

// A coarser grain is the same figures rolled up — each month of the window holds its own accepts.
export const TheMonthsAddUpToTheWindow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("statistics-grain-month"));

    // Each fixture accept, filed under its own month.
    const byMonth = new Map<string, bigint>();
    for (const [daysAgo, value] of [
      [2, 2_000_000n],
      [5, 900_000n],
      [12, 1_500_000n],
    ] as const) {
      const month = `${dayAgo(daysAgo).slice(0, 7)}-01`;
      byMonth.set(month, (byMonth.get(month) ?? 0n) + value);
    }

    for (const [month, value] of byMonth) {
      const row = await canvas.findByTestId(`statistics-series-row-${month}`);
      await expect(within(row).getByText(rp(value))).toBeInTheDocument();
    }
  },
};

// Picking a team narrows every number to its restocks (the-team-filter-picks-any-selling-team) — Toko Melati's two
// Beras accepts — and the by-product table drops its Team column, which would say that one name on every row.
export const PickingATeamNarrowsEveryNumber: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("statistics-products")).getByText("Team")).toBeInTheDocument();

    await pickTeam(canvas.getByTestId("statistics-team"), MELATI.teamCode);

    await waitFor(() =>
      expect(canvas.getByTestId("statistics-summary-restocked-value")).toHaveTextContent(rp(3_500_000n)),
    );
    await expect(within(canvas.getByTestId("statistics-products")).queryByText("Team")).not.toBeInTheDocument();
  },
};

// Product Grouped: the restocking team's product, the largest value first, each row naming its team
// (every-accepted-line-links-its-own-product) — Toko Melati's Beras, then Toko Kenanga's Gula.
export const EachProductNamesItsTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await canvas.findByTestId("statistics-products");

    await waitFor(() => expect(within(table).getByText("Beras Pandan Wangi 5kg")).toBeVisible());

    const rows = within(table).getAllByRole("row").slice(1);
    await expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "statistics-product-row-12|74",
      "statistics-product-row-13|73",
    ]);
    await expect(
      within(table)
        .getAllByTestId("statistics-product-team")
        .map((cell) => cell.textContent),
    ).toEqual(["Toko Melati", "Toko Kenanga"]);
  },
};

// A supplier nothing was restocked from in the window says so once — no headline of zeroes over a table of zeroes.
export const NothingRestockedSaysSo: Story = {
  args: { supplierId: 33n },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("statistics-empty", {}, { timeout: 3000 })).toHaveTextContent(
      "Nothing was restocked from this supplier in this period.",
    );
  },
};
