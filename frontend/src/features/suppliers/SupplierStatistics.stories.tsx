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

// The By Product view — its own page within the tab (the-statistics-tab-is-two-views).
async function openByProduct(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("statistics-view-product"));
  await waitFor(() => expect(canvas.getByTestId("statistics-view-product")).toHaveAttribute("aria-selected", "true"));
  return canvas.findByTestId("statistics-products", {}, { timeout: 3000 });
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
    // 6 broken of 137 received — broken beside restocked, never inside it — and 1 lost of 137. Each rate sits in its own
    // card, beside its figure, in its tone (the-loss-rates-sit-in-their-cards).
    await expect(canvas.getByTestId("statistics-summary-broken-rate")).toHaveTextContent("4,4%");
    await expect(canvas.getByTestId("statistics-summary-lost-rate")).toHaveTextContent("0,7%");
    await expect(canvas.queryByTestId("statistics-summary-rate")).toBeNull();
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
    await expect(within(await openByProduct(canvas)).getByText("Team")).toBeInTheDocument();

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
    const table = await openByProduct(canvas);

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

// ── Two views (`the-statistics-tab-is-two-views`) ────────────────────────────────────────────────────────────

// OVER TIME AND BY PRODUCT ARE TWO VIEWS — one open at a time, Over Time first. The grain belongs to Over Time only.
export const TwoViewsOverTimeFirst: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("statistics-view-time")).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByTestId("statistics-series")).toBeVisible();
    await expect(canvas.queryByTestId("statistics-products")).toBeNull();
    await expect(canvas.getByTestId("statistics-grain")).toBeVisible();

    await openByProduct(canvas);
    await expect(canvas.queryByTestId("statistics-series")).toBeNull();
    await expect(canvas.queryByTestId("statistics-grain")).toBeNull();
    // The headline is the window, on both views.
    await expect(canvas.getByTestId("statistics-summary")).toBeVisible();
  },
};

// SWITCHING VIEW KEEPS THE QUESTION — the team picked on Over Time still narrows By Product.
export const SwitchingViewKeepsTheTeam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pickTeam(canvas.getByTestId("statistics-team"), MELATI.teamCode);
    await waitFor(() =>
      expect(canvas.getByTestId("statistics-summary-restocked-value")).toHaveTextContent(rp(3_500_000n)),
    );

    const table = await openByProduct(canvas);
    await waitFor(() => expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1));
    await expect(within(table).queryByText("Team")).not.toBeInTheDocument();
  },
};

// ── The total, the rates, the grain, the hover (`the-total-leads-the-figures`, `a-figures-row-lights-up`) ─────────────

// A RATE IS IN ITS FIGURE'S TONE — broken red, lost amber, the same colour as the number beside it.
export const ARateWearsItsFiguresTone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const brokenValue = canvas.getByTestId("statistics-summary-broken-value").querySelector("span")!;
    const brokenRate = canvas.getByTestId("statistics-summary-broken-rate");
    await expect(getComputedStyle(brokenRate).color).toBe(getComputedStyle(brokenValue).color);

    const lostValue = canvas.getByTestId("statistics-summary-lost-value").querySelector("span")!;
    const lostRate = canvas.getByTestId("statistics-summary-lost-rate");
    await expect(getComputedStyle(lostRate).color).toBe(getComputedStyle(lostValue).color);
    await expect(getComputedStyle(lostRate).color).not.toBe(getComputedStyle(brokenRate).color);
  },
};

// THE TOTAL LEADS — every unit received, good, short and broken, and its value — so a percentage has its whole on
// screen, and says so: "1 unit · 0,7% of total" (the-total-leads-the-figures).
export const TheTotalLeads: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const total = canvas.getByTestId("statistics-summary-total");
    await expect(total).toHaveAttribute("data-emphasis");
    await expect(canvas.getByTestId("statistics-summary").firstElementChild).toBe(total);
    // 130 + 1 + 6 units; Rp 4.400.000 + 50.000 + 195.000.
    await expect(canvas.getByTestId("statistics-summary-total-value")).toHaveTextContent(rp(4_645_000n));
    await expect(canvas.getByTestId("statistics-summary-total-units")).toHaveTextContent("137 units");

    await expect(canvas.getByTestId("statistics-summary-lost")).toHaveTextContent("1 unit · 0,7% of total");
    await expect(canvas.getByTestId("statistics-summary-broken")).toHaveTextContent("6 units · 4,4% of total");
  },
};

// The grain sits RIGHT of the window it cuts.
export const TheGrainIsRightOfTheWindow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const range = canvas.getByTestId("statistics-range").getBoundingClientRect();
    const grain = canvas.getByTestId("statistics-grain").getBoundingClientRect();
    await expect(grain.left).toBeGreaterThan(range.left);
  },
};

// A ROW LIGHTS UP under the pointer, every cell of it — driven by `data-hover`, which Chakra's `_hover` honours; a
// synthetic pointer sets no CSS `:hover`.
export const AFiguresRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId(`statistics-series-row-${dayAgo(2)}`);
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// The view is picked FIRST — its tab row sits over the filters, since it decides which filters there are.
export const TheViewIsOverTheFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const views = canvas.getByTestId("statistics-views").getBoundingClientRect();
    const team = canvas.getByTestId("statistics-team").getBoundingClientRect();
    await expect(views.bottom).toBeLessThanOrEqual(team.top);
  },
};

// EACH RATE IS ITS OWN COLUMN, right after its figure — Hilang · Tingkat hilang · Rusak · Tingkat rusak — in the figure's
// tone once there is any (the-loss-rates-are-their-own-columns).
export const EachRateFollowsItsFigure: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const headers = within(canvas.getByTestId("statistics-series"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    await expect(headers).toEqual(["Period", "Restocked", "Lost in shipping", "Lost rate", "Broken in shipping", "Broken rate"]);

    // 2 broken of 43 received on that day; 1 lost.
    const row = canvas.getByTestId(`statistics-series-row-${dayAgo(2)}`);
    const broken = within(row).getByTestId("figure-broken-rate");
    await expect(broken).toHaveTextContent("4,7%");
    await expect(within(row).getByTestId("figure-lost-rate")).toHaveTextContent("2,3%");
    await expect(getComputedStyle(broken).color).not.toBe(getComputedStyle(within(row).getByTestId("figure-lost-rate")).color);
  },
};

// ── On a phone ────────────────────────────────────────────────────────────────────────────────────

// A PHONE: a period is a block that reads the desktop's columns — restocked, then lost and broken each with its rate
// beside it (a-phone-figures-block-reads-the-columns); a quiet period is one thin line (a-quiet-period-is-one-line-on-a-phone);
// the cards carry no note (a-phone-card-shows-no-note).
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const busy = canvas.getByTestId(`statistics-series-row-${dayAgo(2)}`);
    await expect(busy).toHaveTextContent("Restocked 40");
    await expect(within(busy).getByTestId(`statistics-series-row-${dayAgo(2)}-lost`)).toHaveTextContent("Lost 1 · 2,3%");
    await expect(within(busy).getByTestId(`statistics-series-row-${dayAgo(2)}-broken`)).toHaveTextContent("Broken 2 · 4,7%");
    await expect(busy).not.toHaveTextContent("% broken");

    const quiet = canvas.getByTestId(`statistics-series-row-${dayAgo(0)}`);
    await expect(quiet).toHaveAttribute("data-quiet", "true");
    await expect(quiet).toHaveTextContent("nothing restocked");

    await expect(canvas.queryByTestId("statistics-summary-total-note")).toBeNull();
  },
};

// A PRODUCT SHOWS ITS PICTURE — the app's product item: the picture, the name, the SKU under it; a product with no
// picture shows the placeholder (a-figures-product-shows-its-picture). Beras has a picture in the fixtures, Gula none.
export const AProductShowsItsPicture: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const table = await openByProduct(canvas);

    const beras = within(table).getByTestId("statistics-product-row-12|74");
    await waitFor(() => expect(within(beras).getByRole("img")).toBeInTheDocument());
    await expect(beras).toHaveTextContent("SKU-BERAS-5K");

    const gula = within(table).getByTestId("statistics-product-row-13|73");
    await expect(within(gula).queryByRole("img")).toBeNull();
  },
};
