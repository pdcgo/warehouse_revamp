import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { LocationProbe, asTeam, routedPage } from "../../../.storybook/pageStory";
import { closeShopForStory } from "../../../.storybook/shopStub";
import { METRICS, catalogueMetrics, metricById, tableGroups, TABLE_GROUPS } from "../../features/analytic/catalogue";
import { AnalyticPage } from "./index";

// The Analytic composer (docs/business/analytic/rpc_provide.md). The five ORDER metrics and the two SETTLEMENT metrics
// are SERVED: the page asks OrderAnalyticService and SettlementAnalyticService over the stub transport — the orders
// answered from the analytic samples (orderAnalyticStub.ts), settlement folded from the settlement book in fixtures.ts
// (settlementAnalyticStub.ts) — so the real wire path runs. Every other metric is a sample read in the page. Each story
// opens the page at a URL, because the URL is the report's whole state (the-report-lives-in-the-url). It reads as Toko
// Melati (12), a seller; Gudang Pusat (11), a warehouse, gets counts only.
//
// Two shaped shops, from the owner's own example:
//   Toko Satria (13)       many orders, NO settlement          — a sample shop
//   Melati Official (21)   NO orders, settlement arriving       — the settlement book's
// so the service that ranks visibly decides the rows (the-rows-are-the-keys-step-one-sends).
//
// The screen details decided at this screen (the-analytic-screen-is-accepted), each pinned by a story here:
//   the rows line             SortedByProfit               (the-rows-line-says-what-the-rows-are)
//   a group change            SwitchGroupToProduct         (a-group-change-drops-the-columns-that-cannot-follow)
//   the graph                 GraphsSplitByKindOfNumber    (the-graph-draws-the-table)
//   one view at a time        GraphsSplitByKindOfNumber, TheViewIsInTheLink   (the-table-and-the-graph-are-tabs)
//   a time graph's order      ByDayGraphRunsOldestFirst    (a-time-graph-runs-oldest-first)
//   the cap on lines          — still open, decided with the chart on screen (the-chart-waits-for-a-chart-component)

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const CREATED = "metrics/orders/created";

const ByShop = at(`?g=shop&m=${CREATED},metrics/settlement&s=${CREATED}:created_count:desc`);
const OrdersAndAdsByShop = at(`?g=shop&m=${CREATED},metrics/ads&s=${CREATED}:created_count:desc`);
const OrdersAndLostBySeller = at(`?g=team&m=${CREATED},metrics/inventory/lost&s=${CREATED}:created_count:desc`);
const OrdersByDayForSatria = at(`?g=daily&m=${CREATED}&shop=13&r=2026-10-01..2026-10-07`);
const OrdersByShopAllRows = at(`?g=shop&m=${CREATED}&n=50`);
const OrdersBySeller = at(`?g=team&m=${CREATED}`);
const StockLostByDay = at("?g=daily&m=metrics/inventory/lost&r=2026-10-01..2026-10-07");
const ByShopAsGraph = at(`?g=shop&m=${CREATED},metrics/settlement&s=${CREATED}:created_count:desc&v=graph`);
const Nothing = at("?g=shop");
const OrdersAndSettlementByDay = at(`?g=daily&m=${CREATED},metrics/settlement&r=2026-10-01..2026-10-07`);
const SettlementByDay = at("?g=daily&m=metrics/settlement&r=2026-10-01..2026-10-07");

const meta = {
  title: "Pages/Analytic/Composer",
  component: ByShop,
  // Signed in, as a team: the served metrics are read in its scope (a-warehouse-reads-the-orders-it-ships).
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: asTeam(12n),
} satisfies Meta<typeof ByShop>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 4000 });

  return canvas;
}

/** Pick an option in one of the page's inline selects — the list animates in before it takes a click. */
async function pick(canvas: ReturnType<typeof within>, testId: string, value: string) {
  await userEvent.click(canvas.getByTestId(testId));
  const option = await canvas.findByTestId(`${testId}-option-${value}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** Open Add Metric, then a category in it — the popup animates in before it takes a click. */
async function openMetricMenu(canvas: ReturnType<typeof within>, category?: string) {
  await userEvent.click(canvas.getByTestId("analytic-add-metric"));
  const menu = await canvas.findByTestId("analytic-metric-menu");
  await waitFor(() => expect(menu).toBeVisible());
  if (category) await userEvent.click(within(menu).getByTestId(`analytic-category-${category}`));

  return within(menu);
}

/** "1.240" → 1240 — a count as id-ID writes it. */
const count = (text: string | null) => Number((text ?? "").replace(/\./g, ""));

// DEFAULT — your example: Group by Shop, Orders and Settlement side by side, ranked by order count. The order service
// picks the rows, so Toko Satria (orders, no settlement) is a row and Melati Official (no orders) is not.
export const Default: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("analytic-row-13")).toBeVisible();
    await expect(canvas.queryByTestId("analytic-row-21")).toBeNull();
    // Satria has no settlement — its row is filled with zero, never left blank (one key, every column)…
    await expect(canvas.getByTestId("analytic-cell-13-sales")).toHaveTextContent("Rp 0");
    // …except a rate with no sale to divide by, which the service leaves unset: not 0%.
    await expect(canvas.getByTestId("analytic-cell-13-take_rate")).toHaveTextContent("—");
    // The headline: a card per figure, the sorted one leading.
    await expect(canvas.getByTestId("analytic-headline-created_count")).toBeVisible();
    await expect(canvas.getByTestId("analytic-headline-position_to_date")).toBeVisible();
    // The settlement book's window: 300.000 sold, 60.000 of it never received — a 20% take rate.
    await expect(canvas.getByTestId("analytic-headline-take_rate-value")).toHaveTextContent("20%");
    // A metric chip's icon sits on its label's centre line, not ~4px under it (theme.ts, the tag recipe).
    const chip = canvas.getByTestId("analytic-chip-metrics-orders-created");
    const middle = (el: Element) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    await expect(Math.abs(middle(chip.querySelector("svg")!) - middle(chip))).toBeLessThanOrEqual(1);
  },
};

// MOBILE (`a-phone-reads-each-line-as-a-block`, `a-phone-filters-from-a-sheet`) — each shop a block of its figures, the
// filters and the sort behind one button, since a phone has no headings to tap.
export const Mobile: Story = {
  render: () => <ByShop />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getByTestId("analytic-filters-open")).toBeVisible();
  },
};

// SORTED BY A SETTLEMENT FIGURE (the-rows-line-says-what-the-rows-are) — the sort moves to Position to date, so
// settlement ranks the shops. Toko Satria (no settlement) leaves; Melati Official (settlement, no orders) arrives,
// first, with the larger position. Nothing is lost — the rows are the keys the ranking service sends — and the line above
// the table says so, before and after.
export const SortedBySettlement: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-row-13")).toBeVisible();
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: shops with orders created in this period");

    await userEvent.click(canvas.getByTestId("analytic-sort-position_to_date"));

    await waitFor(() => expect(canvas.queryByTestId("analytic-row-13")).toBeNull());
    await expect(canvas.getByTestId("analytic-row-21")).toBeVisible();
    await expect(canvas.getByTestId("analytic-cell-21-created_count")).toHaveTextContent("0");
    await waitFor(() => expect(canvas.getByTestId("analytic-row-21")).toHaveTextContent("Melati Official"));
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: shops with settlement in this period");
  },
};

// ADD METRIC IS PICKED LIKE A CATEGORY (owner: *"add metric is popup like selecting category"*) — the categories on the
// left, the chosen one's metrics beside it, ticked when on the table. It opens on Order, and the categories are the
// owner's tree: Ads Expense is inside Expense, with no Ads of its own (the-picker-follows-the-metric-tree).
export const AddMetricDrillsIntoACategory: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const menu = await openMetricMenu(canvas);

    await expect(menu.getByTestId("analytic-category-order")).toHaveAttribute("aria-pressed", "true");
    await expect(menu.getByTestId("analytic-metric-metrics-orders-created")).toHaveAttribute("data-state", "checked");

    await expect(menu.queryByTestId("analytic-category-ads")).toBeNull();
    await userEvent.click(menu.getByTestId("analytic-category-expense"));
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-ads"));

    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-ads")).toBeVisible());
    // It stays open, so a second metric goes on in the same visit.
    await expect(menu.getByTestId("analytic-metric-metrics-ads")).toHaveAttribute("data-state", "checked");
  },
};

// THE LIVE PICKER — no prototype is drawn now (PROTOTYPE_METRICS is empty since Finance and Lost stock went live,
// 2026-11-05), so the live catalogue is the whole picker: the owner's four categories and Finance last, Inventory's leaf
// the served Lost stock, Finance's two metrics, and the financial-account groups offered.
export const TheLivePickerShowsNoPrototype: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    await expect(catalogueMetrics()).toBe(METRICS);
    await expect(tableGroups()).toBe(TABLE_GROUPS);

    const canvas = await loaded(canvasElement);
    const menu = await openMetricMenu(canvas, "inventory");

    for (const c of ["order", "settlement", "inventory", "expense", "finance"]) {
      await expect(menu.getByTestId(`analytic-category-${c}`)).toBeVisible();
    }
    await expect(menu.getByTestId("analytic-metric-metrics-inventory-lost")).toHaveTextContent("Lost stock");

    // Expense holds Warehouse fee and the served Ads expense and Expenses (the-expense-prototype-is-accepted).
    await userEvent.click(menu.getByTestId("analytic-category-expense"));
    for (const [id, label] of [
      ["warehouse_fee", "Warehouse fee"],
      ["ads", "Ads expense"],
      ["expenses", "Expenses"],
    ] as const) {
      await expect(menu.getByTestId(`analytic-metric-metrics-${id}`)).toHaveTextContent(label);
      await expect(metricById(`metrics/${id}`)?.schema).toBeDefined();
    }

    await userEvent.click(menu.getByTestId("analytic-category-finance"));
    await expect(menu.getByTestId("analytic-metric-metrics-financial_accounts")).toHaveTextContent("Account changes");
    await expect(menu.getByTestId("analytic-metric-metrics-financial_accounts-types")).toHaveTextContent("Change types");

    await userEvent.click(menu.getByTestId("analytic-metric-done"));
    await userEvent.click(canvas.getByTestId("analytic-group"));
    await waitFor(() => expect(canvas.getByTestId("analytic-group-option-shop")).toBeVisible());
    await expect(canvas.getByTestId("analytic-group-option-account")).toBeVisible();
    await expect(canvas.getByTestId("analytic-group-option-change_type")).toBeVisible();
  },
};

// SEARCH FINDS A METRIC IN ANY CATEGORY — each match named by its path, greyed the same way when it cannot follow the group.
export const AddMetricSearchesEveryCategory: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const menu = await openMetricMenu(canvas);

    await userEvent.type(menu.getByTestId("analytic-metric-search"), "lost", { delay: 40 });

    const results = await menu.findByTestId("analytic-metric-search-results");
    const stockLost = within(results).getByTestId("analytic-metric-metrics-inventory-lost");
    await expect(stockLost).toHaveTextContent("Inventory › Lost stock");
    await expect(stockLost).toHaveAttribute("data-disabled");
  },
};

// INVENTORY IS GREYED WHILE GROUPED BY SHOP (a-metric-that-cannot-group-is-greyed) — stock is lost in the warehouse and has
// no shop, so Lost stock is shown, cannot be ticked, and says why.
export const InventoryGreyedByShop: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const menu = await openMetricMenu(canvas, "inventory");

    const stockLost = menu.getByTestId("analytic-metric-metrics-inventory-lost");
    await expect(stockLost).toHaveAttribute("data-disabled");
    await expect(menu.getByTestId("analytic-metric-metrics-inventory-lost-reason")).toHaveTextContent("Cannot be grouped by shops");
    // One that can be read by shop is tickable.
    await userEvent.click(menu.getByTestId("analytic-category-expense"));
    await expect(menu.getByTestId("analytic-metric-metrics-ads")).not.toHaveAttribute("data-disabled");
  },
};

// A GROUP CHANGE REMOVES THE COLUMNS THAT CANNOT FOLLOW (a-group-change-drops-the-columns-that-cannot-follow).
// Lost stock has no shop group (lost stock belongs to no shop), so switching to Shop takes it off the table and a toast
// says why; Orders created stays, its rows the shops.
export const SwitchGroupToShop: Story = {
  render: () => <OrdersAndLostBySeller />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-chip-metrics-inventory-lost")).toBeVisible();

    await pick(canvas, "analytic-group", "shop");

    await waitFor(() => expect(canvas.queryByTestId("analytic-chip-metrics-inventory-lost")).toBeNull());
    await expect(canvas.getByTestId("analytic-chip-metrics-orders-created")).toBeVisible();
    const toast = await screen.findByText("Lost stock removed");
    await waitFor(() => expect(toast).toBeVisible());
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0));
  },
};

// ADS EXPENSE FOLLOWS A SWITCH TO SELLER — served with the Seller group (expense-has-ads-and-expenses), it stays on the
// table beside Orders created, and the seller row is named by TeamByIds (the-team-group-is-the-seller).
export const AdsFollowsASwitchToSeller: Story = {
  render: () => <OrdersAndAdsByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pick(canvas, "analytic-group", "team");

    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    await expect(canvas.getByTestId("analytic-chip-metrics-ads")).toBeVisible();
    await expect(canvas.getByTestId("analytic-chip-metrics-orders-created")).toBeVisible();
  },
};

// GROUPED BY SELLER, the row is a TEAM named by TeamByIds — a real id, a real name, not a sample's.
export const GroupedBySellerNamesTheTeam: Story = {
  render: () => <OrdersBySeller />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
  },
};

// A WAREHOUSE GETS COUNTS ONLY (a-warehouse-sees-no-seller-money) — the service leaves every money field UNSET, and the
// screen drops those columns rather than reading 0: the headline and the table keep Orders created and nothing else.
export const AWarehouseSeesCountsOnly: Story = {
  render: () => <OrdersByShopAllRows />,
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.queryByTestId("analytic-headline-created_total")).toBeNull());
    await expect(canvas.getByTestId("analytic-headline-created_count")).toBeVisible();
    await expect(canvas.queryByTestId("analytic-headline-mp_total")).toBeNull();
    await expect(canvas.queryByTestId("analytic-sort-created_total")).toBeNull();
    await expect(canvas.getByTestId("analytic-sort-created_count")).toBeVisible();
  },
};

// ADDING A METRIC REMOVES THE FILTERS IT CANNOT USE, AND SAYS SO (a-new-metric-removes-the-filters-it-cannot-use,
// a-removed-filter-is-announced). Orders created by day for Toko Satria; Stock lost has no shop, so adding it drops the
// shop filter — and every column now answers the same question: every shop.
export const AddingStockLostRemovesTheShopFilter: Story = {
  render: () => <OrdersByDayForSatria />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-filter-shop")).toBeVisible();

    const menu = await openMetricMenu(canvas, "inventory");
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-inventory-lost"));

    await waitFor(() => expect(canvas.queryByTestId("analytic-filter-shop")).toBeNull());
    const toast = await screen.findByText("Shop filter removed");
    await waitFor(() => expect(toast).toBeVisible());
    await expect(canvas.getByTestId("analytic-chip-metrics-inventory-lost")).toBeVisible();
  },
};

// A CLOSED SHOP STAYS A FILTER (report-filters-offer-closed-shops): Melati Store (22), closed, is offered after the
// team's open shops, badged Closed — picked, it is the report's `shop=` and the field keeps the badge, so a closed
// shop's history stays one pick away.
const OrdersByShopProbed = routedPage(
  [
    {
      path: "/analytic",
      element: (
        <>
          <AnalyticPage />
          <LocationProbe />
        </>
      ),
    },
  ],
  `/analytic?g=shop&m=${CREATED}`,
);

export const TheShopFilterOffersAClosedShopLastBadged: Story = {
  beforeEach: () => {
    closeShopForStory(22n);
  },
  render: () => <OrdersByShopProbed />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const field = canvas.getByTestId("analytic-filter-shop");

    await userEvent.click(within(field).getByTestId("shop-select"));
    const option = await within(field).findByTestId("shop-select-option-22");
    await waitFor(() => expect(option).toBeVisible());
    await expect(within(option).getByTestId("shop-select-closed-22")).toHaveTextContent("Closed");
    const listed = within(option.closest('[role="listbox"]') as HTMLElement)
      .getAllByRole("option")
      .map((o) => o.getAttribute("data-testid"));
    await expect(listed.length).toBeGreaterThan(1);
    await expect(listed[listed.length - 1]).toBe("shop-select-option-22");

    await userEvent.click(option);
    await waitFor(() => expect(canvas.getByTestId("location-search")).toHaveTextContent("shop=22"));
    await expect(within(field).getByTestId("shop-select")).toHaveValue("Melati Store");
    await expect(within(field).getByTestId("shop-select-value-closed")).toBeVisible();
  },
};

/** Open the "created by" field and wait for its options — they are portalled, so read off `screen`. */
async function openPeople(canvas: ReturnType<typeof within>) {
  const field = await canvas.findByTestId("analytic-filter-user", {}, { timeout: 4000 });
  await userEvent.click(within(field).getByRole("combobox"));
  await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0), { timeout: 4000 });
}

// a-who-filter-lists-the-people-on-its-rows: the "created by" field offers the people on the chosen metrics' own rows —
// selling's order creators (Eko 65, Budi 62, Citra 63) and settlement's people (Ani 61, Budi 62), UNIONED: Budi once.
// Never the system-wide user search, which only Root may call — the field was dead for a seller before.
export const CreatedByOffersThePeopleOnTheRows: Story = {
  render: () => <OrdersAndSettlementByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openPeople(canvas);

    for (const id of [65, 62, 63, 61]) {
      await waitFor(() => expect(screen.getAllByTestId(`person-filter-option-${id}`)).toHaveLength(1));
    }
    await expect(screen.getAllByRole("option")).toHaveLength(4);
  },
};

// A settlement metric alone offers settlement's people only: Eko typed orders in, but no settlement row counts for him.
export const CreatedByForSettlementIsSettlementsPeople: Story = {
  render: () => <SettlementByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await openPeople(canvas);

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    await expect(screen.getByTestId("person-filter-option-61")).toBeVisible();
    await expect(screen.getByTestId("person-filter-option-62")).toBeVisible();
    await expect(screen.queryByTestId("person-filter-option-65")).toBeNull();
  },
};

// THE HEADLINE IS THE SUM OF ITS ROWS (the-headline-is-the-sum-of-its-rows) — by construction: the same metric, grouped by
// SUMMARY. Every shop on one page, added up, is the headline.
export const HeadlineIsTheSumOfItsRows: Story = {
  render: () => <OrdersByShopAllRows />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const cells = canvas.getAllByTestId(/^analytic-cell-\d+-created_count$/);
    const rows = cells.reduce((sum, cell) => sum + count(cell.textContent), 0);

    await expect(count(canvas.getByTestId("analytic-headline-created_count-value").textContent)).toBe(rows);
    await expect(rows).toBeGreaterThan(0);
  },
};

// A TIME GROUP LISTS EVERY BUCKET — a quiet day included, so a missing row never reads as one that did not load. Seven
// days, newest first, without asking any service which days exist.
export const ByDayIncludesQuietDays: Story = {
  render: () => <StockLostByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const rows = canvas.getAllByTestId(/^analytic-row-/);
    await expect(rows).toHaveLength(7);
    await expect(rows[0]).toHaveAttribute("data-testid", "analytic-row-2026-10-07");
    await expect(rows[6]).toHaveAttribute("data-testid", "analytic-row-2026-10-01");
  },
};

const ticks = (el: HTMLElement, axis: "x" | "y") =>
  [...el.querySelectorAll(`.recharts-${axis}Axis-tick-labels .recharts-cartesian-axis-tick-value`)].map((t) => t.textContent ?? "");

/**
 * The graph draws after it has measured its box, and its axes a render later: wait for its lines and both axes' ticks,
 * then hand back the graph to look inside.
 */
async function graph(canvas: ReturnType<typeof within>, kind: "count" | "money", lines: number) {
  const el = await canvas.findByTestId(`analytic-graph-${kind}`, {}, { timeout: 4000 });
  await waitFor(
    () => {
      expect(el.querySelectorAll(".recharts-line-curve")).toHaveLength(lines);
      expect(ticks(el, "x").length).toBeGreaterThan(0);
      expect(ticks(el, "y").length).toBeGreaterThan(0);
    },
    { timeout: 4000 },
  );

  return el;
}

/** Each row's label, top to bottom — read off the Table tab before it is left, since leaving unmounts it. */
const rowLabels = (canvas: ReturnType<typeof within>) =>
  canvas.getAllByTestId(/^analytic-row-/).map((row: HTMLElement) => row.querySelector("td")?.textContent ?? "");

/** Open the Graph tab — the table goes, the headline stays (the-table-and-the-graph-are-tabs). */
async function openGraphTab(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByTestId("analytic-view-graph"));
  await waitFor(() => expect(canvas.queryByTestId("analytic-table")).toBeNull());
}

// THE TABLE AS GRAPHS (the-graph-draws-the-table), ONE VIEW AT A TIME (the-table-and-the-graph-are-tabs) — the report
// opens on its table; the Graph tab swaps it for one graph per kind of number among the columns. Orders created and
// Settlement by shop: the counts get one graph (Orders created), the money another, where Created total, Created MP
// total and Settlement's four amounts share an axis; the take rate and the position get a graph each. The shops run
// along the bottom in the table's ranking, and the headline stays above them.
export const GraphsSplitByKindOfNumber: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("analytic-graphs")).toBeNull();
    const labels = rowLabels(canvas);

    await openGraphTab(canvas);
    const counts = await graph(canvas, "count", 1);
    const money = await graph(canvas, "money", 6);

    await expect(within(counts).getByText("Orders created")).toBeVisible();
    for (const label of ["Created total", "Created MP total", "Selling price", "Received", "Withdrawn", "Gap"]) {
      await expect(within(money).getByText(label)).toBeVisible();
    }
    // The money axis is short, the magnitude first.
    await expect(ticks(money, "y").some((v) => v.startsWith("Rp ") && /(rb|jt)$/.test(v))).toBe(true);
    // The first shop along the bottom is the table's first row.
    await expect(ticks(counts, "x")[0]).toBe(labels[0]);
    // What stays: the headline, the rows line, the pager.
    await expect(canvas.getByTestId("analytic-headline-created_count")).toBeVisible();
    await expect(canvas.getByTestId("analytic-rows-line")).toBeVisible();
    await expect(canvas.getByTestId("analytic-pager")).toBeVisible();
  },
};

// THE VIEW IS IN THE LINK (the-table-and-the-graph-are-tabs, the-report-lives-in-the-url) — `v=graph` opens the report on
// its graphs, so a refresh or a sent link keeps the view. The Table tab brings the rows back.
export const TheViewIsInTheLink: Story = {
  render: () => <ByShopAsGraph />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await graph(canvas, "money", 6);
    await expect(canvas.queryByTestId("analytic-table")).toBeNull();
    await expect(canvas.getByTestId("analytic-view-graph")).toHaveAttribute("aria-selected", "true");

    await userEvent.click(canvas.getByTestId("analytic-view-table"));
    await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible());
    // The graph tab unmounts as its exit animation ends, not on the click.
    await waitFor(() => expect(canvas.queryByTestId("analytic-graphs")).toBeNull());
  },
};

// A TIME GRAPH RUNS OLDEST FIRST (a-time-graph-runs-oldest-first). The
// table lists the week newest first; the graph still reads left to right, 1 October to 7 October, so the line's slope
// is the trend and not its mirror.
export const ByDayGraphRunsOldestFirst: Story = {
  render: () => <StockLostByDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const rows = canvas.getAllByTestId(/^analytic-row-/);
    await expect(rows[0]).toHaveAttribute("data-testid", "analytic-row-2026-10-07");
    const labels = rowLabels(canvas);

    await openGraphTab(canvas);
    const counts = await graph(canvas, "count", 1);
    // At most 3 units a day: the count axis still steps by whole units, never 0,75 or 1,5.
    await expect(ticks(counts, "y").every((v) => !v.includes(","))).toBe(true);
    const x = ticks(counts, "x");
    await expect(x[0]).toBe(labels[6]);
    await expect(x[x.length - 1]).toBe(labels[0]);
  },
};

// NOTHING PICKED YET — the page says how to start.
export const Empty: Story = {
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("analytic-empty")).toHaveTextContent("Add a metric to start");
  },
};

const MoreThanAYear = at(`?g=shop&m=${CREATED}&r=2024-01-01..2025-01-01`);

// A YEAR AT MOST (a-metric-reads-at-most-a-year): a range of 367 days is never sent — the server would refuse it — and
// the line under the filters says how long it is and what the most is, rather than showing a refusal.
export const ARangeOverAYearIsNotSent: Story = {
  render: () => <MoreThanAYear />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("analytic-range-invalid")).toHaveTextContent("That range covers 367 days");
    await expect(canvas.getByTestId("analytic-range-invalid")).toHaveTextContent("at most 366");
  },
};

// AS OF WHEN (a-money-metric-says-as-of-when): orders and settlement are two folds, so the table says the OLDER of their
// two times — everything up to it is in every figure.
export const SaysAsOfWhen: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(await canvas.findByTestId("analytic-as-of")).toHaveTextContent("14:04 WIB");
  },
};
