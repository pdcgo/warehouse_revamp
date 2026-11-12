import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { inventoryMetricCalls } from "../../../.storybook/inventoryAnalyticStub";
import { READY_ID, RESTOCK_ID, RETURN_ID, TRANSFER_ID, readyOn } from "../../../.storybook/inventoryMetricsFixtures";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { INVENTORY_METRICS, metricById } from "../../features/analytic/catalogue";
import { GroupType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { AnalyticPage } from "./index";

// INVENTORY › RESTOCK, TRANSFER, RETURNED STOCK AND READY STOCK on the Analytic composer — LIVE: served by
// inventory_service (the-inventory-metrics-prototype-is-accepted) and drawn as the accepted prototype was. The Storybook
// stub (inventoryAnalyticStub.ts) answers over the real wire path from inventoryMetricsFixtures.ts, read as the server
// reads: Lost stock's filters and groups (the-four-inventory-metrics-filter-like-lost-stock); a transfer's sides each on
// their own day (a-transfer-counts-each-side-on-its-own-day); in transit and on hand are POSITIONS — a period reads its
// last day, the headline the window's, never a sum over days (a-position-is-its-own-stat-type), drawn in their own
// *Positions (units)* graph (ready-stock-is-folded-in-the-stock-changes-own-step); a warehouse reads units only on Restock,
// Transfer and Returned stock — no value column, tile or sort — and Ready's value too
// (a-warehouse-sees-ready-value-but-a-shelf-only-units).
//
// The sample: Toko Melati's (12) stock in Gudang Pusat (11 — orders ship from it, returns land in it) and Gudang Cabang
// (14 — a reserve that sends 204 / 205 on to Pusat); every figure comes from one day-by-day simulation, so they agree.

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const QUARTER = "r=2026-08-01..2026-10-31";
const LAST_WEEK = "r=2026-10-25..2026-10-31";

const Nothing = at(`?g=product&${QUARTER}`);
const ShopGroup = at(`?g=shop&${QUARTER}`);
const RestockByProduct = at(`?g=product&m=${RESTOCK_ID}&${QUARTER}&s=${RESTOCK_ID}:accepted_value:desc`);
const RestockMonthly = at(`?g=monthly&m=${RESTOCK_ID}&${QUARTER}`);
const RestockByWarehouse = at(`?g=warehouse&m=${RESTOCK_ID}&${QUARTER}`);
const TransferByWarehouse = at(`?g=warehouse&m=${TRANSFER_ID}&${QUARTER}`);
const TransferByProduct = at(`?g=product&m=${TRANSFER_ID}&${QUARTER}`);
const TransferAtCabang = at(`?g=product&m=${TRANSFER_ID}&warehouse=14&${QUARTER}`);
const TransferDaily = at(`?g=daily&m=${TRANSFER_ID}&r=2026-10-01..2026-10-31`);
const ReturnByProduct = at(`?g=product&m=${RETURN_ID}&${QUARTER}`);
const ReturnByWarehouse = at(`?g=warehouse&m=${RETURN_ID}&${QUARTER}`);
const ReadyDaily = at(`?g=daily&m=${READY_ID}&${LAST_WEEK}`);
const ReadyMonthly = at(`?g=monthly&m=${READY_ID}&r=2026-05-01..2026-10-31`);
const ReadyByWarehouse = at(`?g=warehouse&m=${READY_ID}&${QUARTER}`);
const ReadyByProduct = at(`?g=product&m=${READY_ID}&${QUARTER}&s=${READY_ID}:on_hand_value:desc`);
const ThreeInOneLink = at(`?g=product&m=${RESTOCK_ID},metrics/inventory/lost,${READY_ID}&${QUARTER}`);

const meta = {
  title: "Pages/Analytic/Inventory metrics",
  component: RestockByProduct,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [
    asTeam(12n),
    () => {
      inventoryMetricCalls.length = 0;
    },
  ],
} satisfies Meta<typeof RestockByProduct>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 6000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 6000 });

  return canvas;
}

/** "Rp 1.240.000" or "1.240" → 1240000 / 1240 — a figure as id-ID writes it (the sample's figures are whole). */
const num = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

const column = (canvas: Canvas, field: string): number[] =>
  canvas.getAllByTestId(new RegExp(`^analytic-cell-[\\d-]+-${field}$`)).map((c: HTMLElement) => num(c.textContent));

const cell = (canvas: Canvas, key: string, field: string) => num(canvas.getByTestId(`analytic-cell-${key}-${field}`).textContent);

const headline = (canvas: Canvas, field: string) => num(canvas.getByTestId(`analytic-headline-${field}-value`).textContent);

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

/** A movement's headline is the sum of its rows (the-headline-is-the-sum-of-its-rows); a position's adds across keys. */
async function sumsToHeadline(canvas: Canvas, fields: string[]) {
  for (const field of fields) await expect(headline(canvas, field)).toBe(sum(column(canvas, field)));
}

/** Lost stock's filters, exactly: the range, seller, warehouse, product, supplier — never shop, user or account. */
async function hasLostStocksFilters(canvas: Canvas) {
  await expect(canvas.getByTestId("analytic-range")).toBeVisible();
  for (const f of ["team", "warehouse", "product", "supplier"]) {
    await waitFor(() => expect(canvas.getByTestId(`analytic-filter-${f}`)).toBeVisible());
  }
  for (const f of ["shop", "user", "account"]) await expect(canvas.queryByTestId(`analytic-filter-${f}`)).toBeNull();
}

/** A warehouse's screen: none of `fields` as a tile, a column (sort heading) or a cell. */
async function showsNoValue(canvas: Canvas, fields: string[]) {
  for (const f of fields) {
    await expect(canvas.queryByTestId(`analytic-headline-${f}`)).toBeNull();
    await expect(canvas.queryByTestId(`analytic-sort-${f}`)).toBeNull();
    await expect(canvas.queryAllByTestId(new RegExp(`^analytic-cell-[\\d-]+-${f}$`))).toHaveLength(0);
  }
}

async function openInventory(canvas: Canvas) {
  await userEvent.click(canvas.getByTestId("analytic-add-metric"));
  const menu = within(await canvas.findByTestId("analytic-metric-menu"));
  await userEvent.click(menu.getByTestId("analytic-category-inventory"));

  return menu;
}

async function pickGroup(canvas: Canvas, group: string) {
  await userEvent.click(canvas.getByTestId("analytic-group"));
  await waitFor(() => expect(canvas.getByTestId(`analytic-group-option-${group}`)).toBeVisible());
  await userEvent.click(canvas.getByTestId(`analytic-group-option-${group}`));
}

const slug = (id: string) => id.replaceAll("/", "-");

// ── the catalogue ────────────────────────────────────────────────────────────────────────────────

// THE PICKER — Inventory holds Lost stock and the four, in the tree's order, each SERVED (read off its descriptor);
// ticking one puts it on the table.
export const TheFourAreUnderInventory: Story = {
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });

    const menu = await openInventory(canvas);
    const column = within(menu.getByTestId("analytic-category-inventory-metrics"));
    const labels = [
      ["metrics/inventory/lost", "Lost stock"],
      [RESTOCK_ID, "Restock"],
      [TRANSFER_ID, "Transfer"],
      [RETURN_ID, "Returned stock"],
      [READY_ID, "Ready stock"],
    ] as const;
    for (const [id, label] of labels) {
      await expect(column.getByTestId(`analytic-metric-${slug(id)}`)).toHaveTextContent(new RegExp(`^${label}$`));
      await expect(column.getByTestId(`analytic-metric-${slug(id)}`)).not.toHaveAttribute("data-disabled");
      await expect(metricById(id)?.schema).toBeDefined();
    }
    // The units positions are their own kind; the values a warehouse is not given are marked by the contract.
    await expect(metricById(READY_ID)?.fields.map((f) => [f.name, f.kind, f.warehouseHidden])).toEqual([
      ["on_hand_count", "unitsPosition", false],
      ["on_hand_value", "position", false],
    ]);
    await expect(INVENTORY_METRICS.flatMap((d) => d.fields.filter((f) => f.warehouseHidden).map((f) => f.name))).toEqual([
      "accepted_value",
      "sent_value",
      "received_value",
      "in_transit_value",
      "back_value",
    ]);

    await userEvent.click(column.getByTestId(`analytic-metric-${slug(RESTOCK_ID)}`));
    await waitFor(() => expect(canvas.getByTestId(`analytic-chip-${slug(RESTOCK_ID)}`)).toHaveTextContent("Restock"));
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(1), { timeout: 6000 });
  },
};

// NO SHOP AND NO USER GROUP — Lost stock's groups: under By shop each of the four is greyed, with why.
export const NoneCanGroupByShop: Story = {
  render: () => <ShopGroup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });

    const menu = await openInventory(canvas);
    for (const id of [RESTOCK_ID, TRANSFER_ID, RETURN_ID, READY_ID]) {
      await expect(menu.getByTestId(`analytic-metric-${slug(id)}`)).toHaveAttribute("data-disabled");
      await expect(menu.getByTestId(`analytic-metric-${slug(id)}-reason`)).toHaveTextContent("shops");
      await expect(metricById(id)?.supportedGroupBy).toEqual([
        "summary",
        "daily",
        "weekly",
        "monthly",
        "yearly",
        "product",
        "supplier",
        "team",
        "warehouse",
      ]);
    }
  },
};

// EACH OF THE FOUR TAKES LOST STOCK'S FILTERS — swapped one for the next on the same table, the bar stays the range,
// seller, warehouse, product and supplier.
export const EachTakesLostStocksFilters: Story = {
  render: () => <RestockByProduct />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await hasLostStocksFilters(canvas);

    const order = [RESTOCK_ID, TRANSFER_ID, RETURN_ID, READY_ID];
    for (let i = 1; i < order.length; i++) {
      const menu = await openInventory(canvas);
      await userEvent.click(menu.getByTestId(`analytic-metric-${slug(order[i]!)}`));
      await userEvent.click(menu.getByTestId("analytic-metric-done"));
      await userEvent.click(canvas.getByTestId(`analytic-chip-${slug(order[i - 1]!)}-remove`));

      await waitFor(() => expect(canvas.queryByTestId(`analytic-chip-${slug(order[i - 1]!)}`)).toBeNull());
      await expect(canvas.getByTestId(`analytic-chip-${slug(order[i]!)}`)).toBeVisible();
      await hasLostStocksFilters(canvas);
    }
  },
};

// ONE CALL ANSWERS THEM TOGETHER (one-call-answers-every-asked-metric) — a link naming Restock, Lost stock and Ready
// stock opens all three on one table, each answered in its own oneof case by the same MetricData.
export const ThreeOnOneTable: Story = {
  render: () => <ThreeInOneLink />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const id of [RESTOCK_ID, "metrics/inventory/lost", READY_ID]) {
      await expect(canvas.getByTestId(`analytic-chip-${slug(id)}`)).toBeVisible();
    }
    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await expect(cell(canvas, "205", "accepted_count")).toBeGreaterThan(0);
    await expect(cell(canvas, "205", "on_hand_count")).toBe(readyOn("2026-10-31", { product: "205" }).units);
    await expect(canvas.getByTestId("analytic-cell-205-lost_count")).toBeVisible();
    await expect(
      inventoryMetricCalls.some((c) => c.rpc === "metricData" && c.metricIds.join(",") === `${RESTOCK_ID},${READY_ID}`),
    ).toBe(true);
  },
};

// ── Restock ──────────────────────────────────────────────────────────────────────────────────────

// BY PRODUCT — units and value accepted onto the racks, and what the door found broken or missing; a quarter, the most
// value first, each product named by ProductByIds; the headline the sum of the rows.
export const RestockByProductStory: Story = {
  name: "Restock by product",
  render: () => <RestockByProduct />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(6);
    for (const f of ["accepted_count", "accepted_value", "broken_count", "missing_count"]) {
      await expect(canvas.getByTestId(`analytic-sort-${f}`)).toBeVisible();
      await expect(canvas.getByTestId(`analytic-headline-${f}`)).toBeVisible();
    }
    const values = column(canvas, "accepted_value");
    await expect([...values].sort((a, b) => b - a)).toEqual(values);
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: products with restock in this period");
    await sumsToHeadline(canvas, ["accepted_count", "accepted_value", "broken_count", "missing_count"]);
    await expect(inventoryMetricCalls.find((c) => c.rpc === "metricSearch")?.sortField).toBe("accepted_value");
  },
};

// THE GROUP SWITCH — the same Restock read by month, then by warehouse (where it was received: Gudang Pusat and Gudang
// Cabang), then by product, and back to months (an id group to a time group, #43); the metric stays on the table under
// every group, and the headline never moves.
export const RestockSwitchesGroup: Story = {
  render: () => <RestockMonthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(3);
    await expect(canvas.getAllByTestId(/^analytic-row-/)[0]).toHaveAttribute("data-testid", "analytic-row-2026-10-01");
    await sumsToHeadline(canvas, ["accepted_count", "accepted_value"]);
    const accepted = headline(canvas, "accepted_count");

    await pickGroup(canvas, "warehouse");
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(2));
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(canvas.getByTestId("analytic-row-14")).toHaveTextContent("Gudang Cabang");
    await expect(canvas.getByTestId(`analytic-chip-${slug(RESTOCK_ID)}`)).toBeVisible();
    await sumsToHeadline(canvas, ["accepted_count", "accepted_value"]);
    await expect(headline(canvas, "accepted_count")).toBe(accepted);

    await pickGroup(canvas, "product");
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(6));
    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await sumsToHeadline(canvas, ["accepted_count", "accepted_value"]);
    await expect(headline(canvas, "accepted_count")).toBe(accepted);

    await pickGroup(canvas, "monthly");
    await waitFor(() => expect(canvas.getByTestId("analytic-row-2026-10-01")).toHaveTextContent("Oct 2026"));
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(3);
    await expect(headline(canvas, "accepted_count")).toBe(accepted);
  },
};

// A WAREHOUSE READS ITS OWN, IN UNITS — Gudang Pusat sees what it accepted and what its door found, never what the goods
// cost the seller: no value tile, column or sort (the value comes back unset).
export const RestockAWarehouseReadsUnits: Story = {
  render: () => <RestockByWarehouse />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(cell(canvas, "11", "accepted_count")).toBeGreaterThan(0);
    await expect(headline(canvas, "accepted_count")).toBe(cell(canvas, "11", "accepted_count"));
    for (const f of ["accepted_count", "broken_count", "missing_count"]) await expect(canvas.getByTestId(`analytic-sort-${f}`)).toBeVisible();
    await showsNoValue(canvas, ["accepted_value"]);
  },
};

// A LINK SORTED BY VALUE, OPENED BY A WAREHOUSE — the seller's link ranks products by value accepted; Gudang Pusat opens
// it on its default (units accepted) instead of the server's refusal, and never asks to rank by a value.
export const RestockAWarehouseOpensAValueSortedLink: Story = {
  render: () => <RestockByProduct />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("analytic-error")).toBeNull();
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: products with restock in this period");
    const units = column(canvas, "accepted_count");
    await expect([...units].sort((a, b) => b - a)).toEqual(units);
    await showsNoValue(canvas, ["accepted_value"]);
    const searches = inventoryMetricCalls.filter((c) => c.rpc === "metricSearch");
    await expect(searches.length).toBeGreaterThan(0);
    await expect(searches.every((c) => c.sortField === "accepted_count")).toBe(true);
  },
};

// ON A PHONE — each product a block of its four figures.
export const RestockOnAPhone: Story = {
  render: () => <RestockByProduct />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Value accepted");
    await expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Missing at the door");
  },
};

// ── Transfer ─────────────────────────────────────────────────────────────────────────────────────

// BY WAREHOUSE — each warehouse shows what it SENT and what it RECEIVED: Gudang Cabang sends its reserve on to Gudang
// Pusat, Pusat sends 201 back now and then. What is on the road at the window's end sits under the warehouse it is going
// to. The movements sum to the headline, and so do the in-transit positions — a position adds up across warehouses.
export const TransferByWarehouseStory: Story = {
  name: "Transfer by warehouse",
  render: () => <TransferByWarehouse />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(2);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    for (const w of ["11", "14"]) {
      await expect(cell(canvas, w, "sent_count")).toBeGreaterThan(0);
      await expect(cell(canvas, w, "received_count")).toBeGreaterThan(0);
    }
    // Cabang sends far more than it gets back; Pusat the other way round.
    await expect(cell(canvas, "14", "sent_count")).toBeGreaterThan(cell(canvas, "14", "received_count"));
    await expect(cell(canvas, "11", "received_count")).toBeGreaterThan(cell(canvas, "11", "sent_count"));
    await sumsToHeadline(canvas, ["sent_count", "sent_value", "received_count", "received_value", "in_transit_count", "in_transit_value"]);
  },
};

// THE WAREHOUSE FILTER MATCHES EITHER SIDE — Gudang Cabang picked: what it sent AND what it received, product by product.
export const TransferEitherSide: Story = {
  render: () => <TransferAtCabang />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-201")).toHaveTextContent("Kaos Polos Hitam"));
    // 201 only ever comes IN to Cabang; 204 and 205 only go OUT.
    await expect(cell(canvas, "201", "received_count")).toBeGreaterThan(0);
    await expect(cell(canvas, "201", "sent_count")).toBe(0);
    await expect(cell(canvas, "205", "sent_count")).toBeGreaterThan(0);
    await expect(cell(canvas, "205", "received_count")).toBe(0);
    await expect(headline(canvas, "sent_count")).toBeGreaterThan(0);
    await expect(headline(canvas, "received_count")).toBeGreaterThan(0);
  },
};

// DAILY — sent counts on the day the units leave the sender (the create), received on the receiver's accept day; IN
// TRANSIT is a position: the headline is the month's LAST day on the road, never the month's days added up. On the graph
// the units on the road are drawn in their own Positions (units) graph, apart from the day's movements.
export const TransferDailyInTransitIsAPosition: Story = {
  render: () => <TransferDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(20);
    await expect(canvas.getAllByTestId(/^analytic-row-/)[0]).toHaveAttribute("data-testid", "analytic-row-2026-10-31");
    await expect(headline(canvas, "in_transit_count")).toBe(cell(canvas, "2026-10-31", "in_transit_count"));
    await expect(sum(column(canvas, "in_transit_count"))).toBeGreaterThan(headline(canvas, "in_transit_count"));

    await userEvent.click(canvas.getByTestId("analytic-view-graph"));
    await waitFor(() => expect(canvas.getByTestId("analytic-graph-unitsPosition")).toBeVisible());
    await expect(canvas.getByTestId("analytic-graph-unitsPosition")).toHaveTextContent("Positions (units)");
    await expect(canvas.getByTestId("analytic-graph-count")).toHaveTextContent("Counts");
    await expect(canvas.getByTestId("analytic-graph-money")).toBeVisible();
    await expect(canvas.getByTestId("analytic-graph-position")).toBeVisible();
  },
};

// A WAREHOUSE READS ITS OWN SIDE, IN UNITS — Gudang Pusat: what it sent and received and what is coming to it; no value.
export const TransferAWarehouseReadsUnits: Story = {
  render: () => <TransferByWarehouse />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
    await expect(cell(canvas, "11", "received_count")).toBeGreaterThan(0);
    await expect(canvas.getByTestId("analytic-headline-in_transit_count")).toBeVisible();
    await showsNoValue(canvas, ["sent_value", "received_value", "in_transit_value"]);
  },
};

// A WAREHOUSE ON A PHONE — Gudang Pusat's products as blocks: units sent, received and on the road, no value line.
export const TransferAWarehouseOnAPhone: Story = {
  render: () => <TransferByProduct />,
  beforeEach: [asTeam(11n)],
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    const first = canvas.getAllByTestId(/^analytic-row-/)[0]!;
    await expect(first).toHaveTextContent("Units sent");
    await expect(first).toHaveTextContent("Units in transit");
    await expect(first).not.toHaveTextContent("Value");
    await showsNoValue(canvas, ["sent_value", "received_value", "in_transit_value"]);
  },
};

// ── Returned stock ───────────────────────────────────────────────────────────────────────────────

// BY PRODUCT — what came back onto the shelf, its value at the batches the order took, and what the door threw away or
// never got; the headline the sum of the rows.
export const ReturnByProductStory: Story = {
  name: "Returned stock by product",
  render: () => <ReturnByProduct />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(3));
    for (const f of ["back_count", "back_value", "broken_count", "missing_count"]) {
      await expect(canvas.getByTestId(`analytic-sort-${f}`)).toBeVisible();
    }
    await expect(sum(column(canvas, "broken_count"))).toBeGreaterThan(0);
    await sumsToHeadline(canvas, ["back_count", "back_value", "broken_count", "missing_count"]);
  },
};

// ONE RETURN WAREHOUSE — every return lands where the seller's returns go (only-the-return-warehouse-accepts-a-return).
export const ReturnLandsAtTheReturnWarehouse: Story = {
  render: () => <ReturnByWarehouse />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await sumsToHeadline(canvas, ["back_count", "back_value"]);
  },
};

// THE RETURN WAREHOUSE READS UNITS — back on the shelf, broken and missing; never the value the order took them at.
export const ReturnAWarehouseReadsUnits: Story = {
  render: () => <ReturnByWarehouse />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(cell(canvas, "11", "back_count")).toBeGreaterThan(0);
    await expect(headline(canvas, "back_count")).toBe(cell(canvas, "11", "back_count"));
    await showsNoValue(canvas, ["back_value"]);
  },
};

// ON A PHONE — each product a block.
export const ReturnOnAPhone: Story = {
  render: () => <ReturnByProduct />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await expect(canvas.getAllByTestId(/^analytic-row-/)[0]).toHaveTextContent("Units back on the shelf");
  },
};

// ── Ready stock ──────────────────────────────────────────────────────────────────────────────────

// DAILY — each day's row is what the shelves held at its end; the headline is the LAST day's, never the week added up
// (a-position-is-its-own-stat-type).
export const ReadyDailyIsAPosition: Story = {
  render: () => <ReadyDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(7);
    const last = readyOn("2026-10-31");
    await expect(cell(canvas, "2026-10-31", "on_hand_count")).toBe(last.units);
    await expect(headline(canvas, "on_hand_count")).toBe(last.units);
    await expect(headline(canvas, "on_hand_value")).toBe(last.value);
    await expect(cell(canvas, "2026-10-25", "on_hand_count")).toBe(readyOn("2026-10-25").units);
    // Seven positions added would be about seven times the headline — the screen never shows that.
    await expect(sum(column(canvas, "on_hand_count"))).toBeGreaterThan(headline(canvas, "on_hand_count") * 5);
  },
};

// MONTHLY — each month reads its own last day; the graph draws the units on hand in Positions (units) and the stock value
// in Positions (Rp) — no Counts graph, since nothing here moved.
export const ReadyMonthlyReadsEachMonthsEnd: Story = {
  render: () => <ReadyMonthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const ends: Record<string, string> = {
      "2026-05-01": "2026-05-31",
      "2026-06-01": "2026-06-30",
      "2026-07-01": "2026-07-31",
      "2026-08-01": "2026-08-31",
      "2026-09-01": "2026-09-30",
      "2026-10-01": "2026-10-31",
    };
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(6);
    for (const [month, end] of Object.entries(ends)) {
      await expect(cell(canvas, month, "on_hand_count")).toBe(readyOn(end).units);
      await expect(cell(canvas, month, "on_hand_value")).toBe(readyOn(end).value);
    }
    await expect(headline(canvas, "on_hand_value")).toBe(readyOn("2026-10-31").value);

    await userEvent.click(canvas.getByTestId("analytic-view-graph"));
    await waitFor(() => expect(canvas.getByTestId("analytic-graph-unitsPosition")).toBeVisible());
    await expect(canvas.getByTestId("analytic-graph-unitsPosition")).toHaveTextContent("Positions (units)");
    await expect(canvas.getByTestId("analytic-graph-position")).toHaveTextContent("Positions (Rp)");
    await expect(canvas.queryByTestId("analytic-graph-count")).toBeNull();
  },
};

// BY WAREHOUSE — a position adds up across keys: the two warehouses' stock on the window's last day is the headline.
export const ReadyByWarehouseAddsUp: Story = {
  render: () => <ReadyByWarehouse />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(2);
    await expect(cell(canvas, "11", "on_hand_count")).toBe(readyOn("2026-10-31", { warehouse: "11" }).units);
    await expect(cell(canvas, "14", "on_hand_count")).toBe(readyOn("2026-10-31", { warehouse: "14" }).units);
    await sumsToHeadline(canvas, ["on_hand_count", "on_hand_value"]);
  },
};

// A WAREHOUSE READS ITS OWN SHELVES — with the stock value (a-warehouse-sees-ready-value-but-a-shelf-only-units), and may
// rank by it.
export const ReadyAWarehouseReadsItsOwn: Story = {
  render: () => <ReadyByWarehouse />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
    await expect(cell(canvas, "11", "on_hand_value")).toBe(readyOn("2026-10-31", { warehouse: "11" }).value);
    await expect(headline(canvas, "on_hand_value")).toBe(cell(canvas, "11", "on_hand_value"));
    await expect(canvas.getByTestId("analytic-sort-on_hand_value")).toBeVisible();
  },
};

// ON A PHONE — by product, the most value first.
export const ReadyOnAPhone: Story = {
  render: () => <ReadyByProduct />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Stock value");
    await expect(cell(canvas, "205", "on_hand_count")).toBe(readyOn("2026-10-31", { product: "205" }).units);
    await expect(headline(canvas, "on_hand_count")).toBe(readyOn("2026-10-31").units);
  },
};

// THE WIRE — Ready's headline is asked of the service (group SUMMARY), never added up on the screen.
export const ReadyHeadlineIsTheServicesSummary: Story = {
  render: () => <ReadyDaily />,
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);

    await expect(inventoryMetricCalls.some((c) => c.rpc === "metricData" && c.groupBy === GroupType.SUMMARY)).toBe(true);
    await expect(inventoryMetricCalls.some((c) => c.rpc === "metricData" && c.groupBy === GroupType.DAILY)).toBe(true);
  },
};
