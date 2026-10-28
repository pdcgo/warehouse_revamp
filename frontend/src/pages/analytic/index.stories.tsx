import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { routedPage } from "../../../.storybook/pageStory";
import { AnalyticPage } from "./index";

// The Analytic composer (docs/business/analytic/rpc_provide.md) — on SAMPLE figures (features/analytic/sample.ts), built
// ahead of its backend. Each story opens the page at a URL, because the URL is the report's whole state
// (the-report-lives-in-the-url).
//
// The sample's two shaped shops, from the owner's own example:
//   Toko Satria (13)  many orders, NO settlement     Toko Lama (14)  NO orders, settlement arriving
// so the service that ranks visibly decides the rows (the-rows-are-the-keys-step-one-sends).
//
// The screen details decided at this screen (the-analytic-screen-is-accepted), each pinned by a story here:
//   the rows line             SortedByProfit               (the-rows-line-says-what-the-rows-are)
//   a group change            SwitchGroupToProduct         (a-group-change-drops-the-columns-that-cannot-follow)
//   the graph                 GraphsSplitByKindOfNumber    (the-graph-draws-the-table)
//   one view at a time        GraphsSplitByKindOfNumber, TheViewIsInTheLink   (the-table-and-the-graph-are-tabs)
//   a time graph's order      ByDayGraphRunsOldestFirst    ⚠ proposed (rpc_provide_clarify.md#a-time-graph-runs-oldest-first)
//   the cap on lines          — still open, decided with the chart on screen (the-chart-waits-for-a-chart-component)

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const ByShop = at("?g=shop&m=metrics/orders,metrics/settlement&s=metrics/orders:order_count:desc");
const OrdersByProductForSatria = at("?g=product&m=metrics/orders&shop=13");
const OrdersByShopAllRows = at("?g=shop&m=metrics/orders&n=50");
const StockLostByDay = at("?g=daily&m=metrics/inventory/lost&r=2026-10-01..2026-10-07");
const ByShopAsGraph = at("?g=shop&m=metrics/orders,metrics/settlement&s=metrics/orders:order_count:desc&v=graph");
const Nothing = at("?g=shop");

const meta = {
  title: "Pages/Analytic/Composer",
  component: ByShop,
  parameters: { dataRouter: true },
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
// picks the rows, so Toko Satria (orders, no settlement) is a row and Toko Lama (no orders) is not.
export const Default: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("analytic-row-13")).toBeVisible();
    await expect(canvas.queryByTestId("analytic-row-14")).toBeNull();
    // Satria has no settlement — its row is filled with zero, never left blank (one key, every column).
    await expect(canvas.getByTestId("analytic-cell-13-settlement_amount")).toHaveTextContent("Rp 0");
    // The headline: a card per figure, the sorted one leading.
    await expect(canvas.getByTestId("analytic-headline-order_count")).toBeVisible();
    await expect(canvas.getByTestId("analytic-headline-profit")).toBeVisible();
    // A metric chip's icon sits on its label's centre line, not ~4px under it (theme.ts, the tag recipe).
    const chip = canvas.getByTestId("analytic-chip-metrics-orders");
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

// SORTED BY PROFIT (the-rows-line-says-what-the-rows-are) — the sort moves to a SETTLEMENT figure, so settlement ranks
// the shops. Toko Satria (no settlement yet) leaves; Toko Lama (settlement, no orders) arrives. Nothing is lost — the
// rows are the keys the ranking service sends — and the line above the table says so, before and after.
export const SortedByProfit: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-row-13")).toBeVisible();
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: shops with orders in this period");

    await userEvent.click(canvas.getByTestId("analytic-sort-profit"));

    await waitFor(() => expect(canvas.queryByTestId("analytic-row-13")).toBeNull());
    await expect(canvas.getByTestId("analytic-row-14")).toBeVisible();
    await expect(canvas.getByTestId("analytic-cell-14-order_count")).toHaveTextContent("0");
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: shops with settlement in this period");
  },
};

// ADD METRIC IS PICKED LIKE A CATEGORY (owner: *"add metric is popup like selecting category"*) — the categories on the
// left, the chosen one's metrics beside it, ticked when on the table. It opens on Order.
export const AddMetricDrillsIntoACategory: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const menu = await openMetricMenu(canvas);

    await expect(menu.getByTestId("analytic-category-order")).toHaveAttribute("aria-pressed", "true");
    await expect(menu.getByTestId("analytic-metric-metrics-orders")).toHaveAttribute("data-state", "checked");

    await userEvent.click(menu.getByTestId("analytic-category-ads"));
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-ads"));

    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-ads")).toBeVisible());
    // It stays open, so a second metric goes on in the same visit.
    await expect(menu.getByTestId("analytic-metric-metrics-ads")).toHaveAttribute("data-state", "checked");
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
    await expect(stockLost).toHaveTextContent("Inventory › Stock lost");
    await expect(stockLost).toHaveAttribute("data-disabled");
  },
};

// INVENTORY IS GREYED WHILE GROUPED BY SHOP (a-metric-that-cannot-group-is-greyed) — stock is lost in the warehouse and has
// no shop, so Stock lost is shown, cannot be ticked, and says why.
export const InventoryGreyedByShop: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const menu = await openMetricMenu(canvas, "inventory");

    const stockLost = menu.getByTestId("analytic-metric-metrics-inventory-lost");
    await expect(stockLost).toHaveAttribute("data-disabled");
    await expect(menu.getByTestId("analytic-metric-metrics-inventory-lost-reason")).toHaveTextContent("Cannot be grouped by shops");
    // One that can be read by shop is tickable.
    await userEvent.click(menu.getByTestId("analytic-category-ads"));
    await expect(menu.getByTestId("analytic-metric-metrics-ads")).not.toHaveAttribute("data-disabled");
  },
};

// A GROUP CHANGE REMOVES THE COLUMNS THAT CANNOT FOLLOW — ⏸ proposed, decided here (screen-details-wait-for-the-screen).
// Settlement has no product, so switching to Product takes it off the table and a toast says why; Orders stays.
export const SwitchGroupToProduct: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await pick(canvas, "analytic-group", "product");

    await waitFor(() => expect(canvas.queryByTestId("analytic-chip-metrics-settlement")).toBeNull());
    await expect(canvas.getByTestId("analytic-chip-metrics-orders")).toBeVisible();
    const toast = await screen.findByText("Settlement removed");
    await waitFor(() => expect(toast).toBeVisible());
    await expect(canvas.getByTestId("analytic-row-203")).toBeVisible();
  },
};

// ADDING A METRIC REMOVES THE FILTERS IT CANNOT USE, AND SAYS SO (a-new-metric-removes-the-filters-it-cannot-use,
// a-removed-filter-is-announced). Orders by product for Toko Satria; Stock lost has no shop, so adding it drops the shop
// filter — and every column now answers the same question: every shop.
export const AddingStockLostRemovesTheShopFilter: Story = {
  render: () => <OrdersByProductForSatria />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-filter-shop")).toBeVisible();
    // Satria sells only the two cheap items.
    await expect(canvas.queryByTestId("analytic-row-205")).toBeNull();

    const menu = await openMetricMenu(canvas, "inventory");
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-inventory-lost"));

    await waitFor(() => expect(canvas.queryByTestId("analytic-filter-shop")).toBeNull());
    const toast = await screen.findByText("Shop filter removed");
    await waitFor(() => expect(toast).toBeVisible());
    await expect(canvas.getByTestId("analytic-chip-metrics-inventory-lost")).toBeVisible();
  },
};

// THE HEADLINE IS THE SUM OF ITS ROWS (the-headline-is-the-sum-of-its-rows) — by construction: the same metric, grouped by
// SUMMARY. Every shop on one page, added up, is the headline.
export const HeadlineIsTheSumOfItsRows: Story = {
  render: () => <OrdersByShopAllRows />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const cells = canvas.getAllByTestId(/^analytic-cell-\d+-order_count$/);
    const rows = cells.reduce((sum, cell) => sum + count(cell.textContent), 0);

    await expect(count(canvas.getByTestId("analytic-headline-order_count-value").textContent)).toBe(rows);
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
// opens on its table; the Graph tab swaps it for one graph per kind of number among the columns. Orders and Settlement
// by shop: the counts get one graph (Order count), the money another, where Order total, Settlement amount and Profit
// share an axis. The shops run along the bottom in the table's ranking, and the headline stays above both.
export const GraphsSplitByKindOfNumber: Story = {
  render: () => <ByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("analytic-graphs")).toBeNull();
    const labels = rowLabels(canvas);

    await openGraphTab(canvas);
    const counts = await graph(canvas, "count", 1);
    const money = await graph(canvas, "money", 3);

    await expect(within(counts).getByText("Order count")).toBeVisible();
    for (const label of ["Order total", "Settlement amount", "Profit"]) await expect(within(money).getByText(label)).toBeVisible();
    // The money axis is short, the magnitude first.
    await expect(ticks(money, "y").some((v) => v.startsWith("Rp ") && /(rb|jt)$/.test(v))).toBe(true);
    // The first shop along the bottom is the table's first row.
    await expect(ticks(counts, "x")[0]).toBe(labels[0]);
    // What stays: the headline, the rows line, the pager.
    await expect(canvas.getByTestId("analytic-headline-order_count")).toBeVisible();
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
    await graph(canvas, "money", 3);
    await expect(canvas.queryByTestId("analytic-table")).toBeNull();
    await expect(canvas.getByTestId("analytic-view-graph")).toHaveAttribute("aria-selected", "true");

    await userEvent.click(canvas.getByTestId("analytic-view-table"));
    await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible());
    await expect(canvas.queryByTestId("analytic-graphs")).toBeNull();
  },
};

// A TIME GRAPH RUNS OLDEST FIRST — ⚠ proposed, not decided (rpc_provide_clarify.md#a-time-graph-runs-oldest-first). The
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
