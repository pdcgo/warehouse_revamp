import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, marker, pickTeam, routedPage } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { teams } from "../../../.storybook/fixtures";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { formatRupiah } from "../../lib/money";
import { SupplierReportPage } from "./index";

// THE SUPPLIER REPORT (the-figures-are-a-statistics-tab-and-a-supplier-report, the-figures-screens-are-accepted) —
// suppliers ranked by what was restocked from them, or by how much of it arrived broken, over a period. The stub serves
// supplier_service's figures from supplierFigureFixtures.ts. The last 30 days hold:
//
//   supplier                     units  restocked     broken  rate
//   31 PT Sumber Makmur   Melati   137   Rp 4.400.000    6     4,4%
//   34 UD Makmur Jaya     Kenanga  212   Rp 3.000.000   10     4,7%
//   36 PT Tekstil Nusantara        25   Rp 1.250.000    0     0%    — under the 50-unit minimum
//   38 CV Lama Tutup  (DELETED)    20   Rp 1.000.000    0     0%    — under the minimum, figures kept
//   37 Linen House                  5   Rp    30.000    2     40%   — under the minimum
//   ──────────────────────────────────────────────────────────────
//   the window — 378 good, Rp 9.680.000 restocked, 3 short (Rp 80.000), 18 broken (Rp 365.000)

const MELATI = teams.find((t) => t.id === 12n)!;
const KENANGA = teams.find((t) => t.id === 13n)!;

const rp = (amount: bigint) => formatRupiah(amount).replace(/\s/g, " ");

const Routed = routedPage(
  [
    { path: "/inventories/suppliers/report", element: <SupplierReportPage /> },
    marker("/inventories/suppliers/:supplierId", "at-own-supplier"),
    marker("/inventories/suppliers/discover/:supplierId", "at-discover-supplier"),
  ],
  "/inventories/suppliers/report",
);

const meta = {
  title: "Pages/Suppliers/SupplierReport",
  component: Routed,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    asTeam(MELATI.id)();
    asRole(Role.SELLING_OWNER)();
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("supplier-report-table", {}, { timeout: 4000 });
  return canvas;
}

/** The supplier ids down the table, top to bottom. */
function order(canvas: ReturnType<typeof within>): string[] {
  return within(canvas.getByTestId("supplier-report-table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.getAttribute("data-testid")!.replace("supplier-report-row-", ""));
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const Default: Story = {};

// A PHONE reads each supplier as a block (a-phone-reads-each-line-as-a-block) — named Mobile, right after Default
// (every-page-has-a-mobile-story). A block that opens a supplier lights up while pressed.
export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(within(canvas.getByTestId("supplier-report-table")).queryAllByRole("columnheader")).toHaveLength(0);
  },
};

export const ByBrokenRate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));
  },
};

export const OneTeamPicked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickTeam(canvas.getByTestId("supplier-report-team"), KENANGA.teamCode);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// By restocked value, the largest first — another team's supplier beside ours (every-selling-team-sees-every-teams-figures),
// and a DELETED one ranked with its figures kept, marked (a-deleted-supplier-is-kept-for-its-figures).
export const RankedByRestockedValue: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(order(canvas)).toEqual(["31", "34", "36", "38", "37"]);
    await expect(canvas.getAllByTestId("supplier-report-rank").map((cell) => cell.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
    await expect(within(canvas.getByTestId("supplier-report-row-38")).getByTestId("supplier-report-deleted")).toBeVisible();
  },
};

// The headline is every ranked supplier together — the window, not the page.
export const TheHeadlineIsEverySupplier: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(9_680_000n));
    await expect(canvas.getByTestId("supplier-report-summary-lost-value")).toHaveTextContent(rp(80_000n));
    await expect(canvas.getByTestId("supplier-report-summary-broken-value")).toHaveTextContent(rp(365_000n));
  },
};

// By broken rate, a supplier needs 50 units to be rated against the others (rate-ranking-needs-50-units): Linen House's
// 40% on five units does not top UD Makmur Jaya's 4,7% on 212. It follows, its rate muted — and the page says why.
export const RankedByRateNeedsFiftyUnits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));

    await waitFor(() => expect(order(canvas)).toEqual(["34", "31", "37", "36", "38"]));

    const rateOf = (id: string) => within(canvas.getByTestId(`supplier-report-row-${id}`)).getByTestId("figure-broken-rate");
    await expect(rateOf("37")).toHaveAttribute("data-muted", "true");
    await expect(rateOf("34")).not.toHaveAttribute("data-muted");
    await expect(canvas.getByTestId("supplier-report-rate-note")).toHaveTextContent("fewer than 50 units");
  },
};

// The search finds suppliers as Discover does (the-supplier-report-searches-like-discover), and the headline is what it
// found: "makmur" is PT Sumber Makmur and UD Makmur Jaya — Rp 7.400.000.
export const TheSearchNarrowsTheRankingAndTheHeadline: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await userEvent.type(canvas.getByTestId("supplier-report-search"), "makmur", { delay: 40 });

    await waitFor(() => expect(order(canvas)).toEqual(["31", "34"]), { timeout: 3000 });
    await expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(7_400_000n));
  },
};

// Picking a team counts only its restocks (the-team-filter-picks-any-selling-team): Toko Kenanga bought from UD Makmur
// Jaya and from PT Sumber Makmur — Rp 3.000.000 + Rp 900.000.
export const PickingATeamNarrowsTheRanking: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await pickTeam(canvas.getByTestId("supplier-report-team"), KENANGA.teamCode);

    await waitFor(() => expect(order(canvas)).toEqual(["34", "31"]));
    await expect(canvas.getByTestId("supplier-report-summary-restocked-value")).toHaveTextContent(rp(3_900_000n));
  },
};

// Our own supplier opens where we manage it — and another team's on Discover (manage-and-discover-are-two-pages).
export const OurSupplierOpensItsManageDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-report-row-31"));
    await expect(await canvas.findByTestId("at-own-supplier")).toBeInTheDocument();
  },
};

export const AnotherTeamsSupplierOpensOnDiscover: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-report-row-34"));
    await expect(await canvas.findByTestId("at-discover-supplier")).toBeInTheDocument();
  },
};

// A deleted supplier opens nothing — neither detail page shows a deleted one.
export const ADeletedSupplierOpensNothing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("supplier-report-row-38"));
    await expect(canvas.queryByTestId("at-own-supplier")).toBeNull();
    await expect(canvas.getByTestId("supplier-report-table")).toBeVisible();
  },
};

// ── The screen rules (a-table-row-lights-up, a-segmented-choice-is-in-the-main-tone, every-list-pages-with-the-growing-pager) ─

// A ROW LIGHTS UP under the pointer, every cell — driven by `data-hover`, which Chakra's `_hover` honours.
export const ARankedRowLightsUp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const row = within(canvas.getByTestId("supplier-report-table")).getAllByRole("row")[1]!;
    const cells = within(row).getAllByRole("cell");
    const resting = getComputedStyle(cells[0]!).backgroundColor;
    row.setAttribute("data-hover", "");
    await waitFor(() => expect(getComputedStyle(cells[0]!).backgroundColor).not.toBe(resting));
    await expect(getComputedStyle(cells[cells.length - 1]!).backgroundColor).toBe(getComputedStyle(cells[0]!).backgroundColor);
  },
};

// THE ORDER IS A SEGMENTED CHOICE — a radio group, Nilai direstok chosen first; choosing the other moves the choice.
export const TheOrderIsASegmentedChoice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const group = canvas.getByTestId("supplier-report-rank-by");
    await expect(group).toHaveAttribute("role", "radiogroup");
    await expect(within(group).getByRole("radio", { name: "Restocked Value" })).toBeChecked();

    await userEvent.click(canvas.getByTestId("supplier-report-rank-by-rate"));
    await waitFor(() => expect(within(group).getByRole("radio", { name: "Broken Rate" })).toBeChecked());
  },
};

// The ranking pages with the growing pager.
export const TheRankingPagesWithTheGrowingPager: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("supplier-report-pager")).toBeVisible();
    await expect(canvas.getByTestId("supplier-report-pager-page-1")).toBeVisible();
  },
};

// THE ORDER READS AS AN ORDER — "Sort" before it, and each segment the sort-down arrow (the-report-order-shows-its-arrow).
export const TheOrderShowsItsArrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const group = canvas.getByTestId("supplier-report-rank-by");
    await expect(group.parentElement).toHaveTextContent(/^Sort/);
    await expect(group.querySelectorAll("svg.lucide-arrow-down-wide-narrow")).toHaveLength(2);
  },
};

// EXPORT IS ON THE TITLE'S ROW, NOT BUILT — its icon, and the ⚠ number pointing at the not-implemented list
// (the-report-export-is-marked).
export const ExportIsMarkedNotBuilt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const exportButton = canvas.getByTestId("supplier-report-export");
    await expect(exportButton).toHaveTextContent("Export");
    await expect(exportButton.querySelector("svg.lucide-download")).not.toBeNull();
    await expect(within(exportButton).getByTestId("not-implemented-export")).toHaveTextContent("1");
    await expect(canvas.getByTestId("not-implemented-summary")).toBeVisible();
  },
};

// SALES SIT BESIDE RESTOCKED, as on the Statistik tab (sales-sit-beside-restocked) — a Penjualan card after Direstok and
// a Penjualan column after Direstok; sample figures, marked 2 in THIS page's list (Ekspor is 1).
export const SalesSitBesideRestocked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const card = canvas.getByTestId("supplier-report-summary-sales");
    await expect(within(card).getByTestId("not-implemented-sales")).toHaveTextContent("2");

    const headers = within(canvas.getByTestId("supplier-report-table")).getAllByRole("columnheader");
    const restocked = headers.findIndex((h) => h.textContent === "Restocked");
    await expect(headers[restocked + 1]).toHaveTextContent(/^Sales/);
    await expect(within(headers[restocked + 1]!).getByTestId("not-implemented-sales")).toHaveTextContent("2");
  },
};

// A PHONE'S HEADER IS ONE ROW (the-report-export-folds-on-a-phone, the-phone-header-is-one-row) — the title and the
// export's ICON with its mark, on the title's row; one action, so no ⋯ (a-phone-header-action-is-an-icon). Wrapped under
// the subtitle, the button stood alone.
export const APhoneFoldsTheExport: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("supplier-report-menu")).toBeNull();
    const exportIcon = canvas.getByRole("button", { name: "Export" });
    await expect(exportIcon).toHaveAttribute("data-testid", "supplier-report-export");
    await expect(exportIcon).not.toHaveTextContent("Export");
    const title = canvas.getByRole("heading", { name: "Supplier Report" });
    await expect(Math.abs(exportIcon.getBoundingClientRect().top - title.getBoundingClientRect().top)).toBeLessThan(12);
    await expect(within(exportIcon.parentElement!).getByTestId("not-implemented-export")).toHaveTextContent("1");
  },
};
