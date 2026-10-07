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
  parameters: { signedIn: true, dataRouter: true, layout: "padded" },
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

// A phone reads each supplier as a block (a-phone-reads-each-line-as-a-block).
// ⚠ No `play()`: the `viewport` global resizes the WORKBENCH canvas only.
export const Phone: Story = {
  globals: { viewport: { value: "mobile2" } },
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

    const rateOf = (id: string) => within(canvas.getByTestId(`supplier-report-row-${id}`)).getByText(/%$/);
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
