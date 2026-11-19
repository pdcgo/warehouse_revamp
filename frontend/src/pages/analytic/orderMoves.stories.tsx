import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { asPlatformOnly } from "../../../.storybook/sessionScenario";
import {
  METRICS,
  ORDER_METRICS,
  ORDER_MOVE_FIELDS,
  ORDER_MOVES_METRIC,
  PROTOTYPE_METRICS,
  catalogueMetrics,
  metricById,
} from "../../features/analytic/catalogue";
import { sampleFacts } from "../../features/analytic/sample";
import { ROOT_TEAM_ID } from "../../features/team/TeamContext";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { OrderMovesMetricSchema } from "../../gen/warehouse/selling/v1/order_analytic_pb";
import { AnalyticPage } from "./index";

// ORDER STATUS MOVES on the Analytic composer — LIVE (the-order-status-moves-prototype-is-accepted, backlog #84): SERVED
// by selling_service (order_analytic.proto `OrderMovesMetric`, folded from OrderStatusChanged into order_daily_reports),
// read off its descriptor like the five; the Storybook stub (.storybook/orderAnalyticStub.ts) answers it over the wire
// from sample.ts, scoped by the caller as the server is. Drawn as the accepted prototype was (12 stories, the same pins).
//
// What the checklist asks (acceptances/inventory/order.md): confirm, back to pending, pick, hand over, shipped, problem,
// complete and resolve "recorded in analytic metric" — and completed is counted as a STATUS MOVE, a count, no money
// (lost-is-a-metric-and-completed-is-not, its 2026-11-18 🔄 line). ONE metric, *Order status moves*, with one count per
// status an order moved to (the-order-metric-ids-name-what-moved): a resolve (problem → completed) is a Completed, a
// picked order handed back is a Back to pending. Each move on its own day (a-fact-counts-on-the-day-it-happened), with
// the five's filters and groups (the-four-group-by-team-shop-warehouse-user-and-time), Created by the order's creator
// (a-metrics-user-is-the-orders-creator), a warehouse reading the orders it ships and every count of them
// (a-warehouse-reads-the-orders-it-ships, a-warehouse-sees-no-seller-money).
//
// The sample: Toko Melati's (12) orders, shipped by Gudang Pusat (11), created by Ani, Budi and Eko — each placed order
// confirmed that day, one in twenty handed back to pending and confirmed the next, picked, handed over, shipped, then
// completed or a problem (most resolved to completed).

const MOVES = ORDER_MOVES_METRIC.metricId;
const slug = (id: string) => id.replaceAll("/", "-");

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const OCTOBER = "r=2026-10-01..2026-10-20";

const Nothing = at(`?g=shop&${OCTOBER}`);
const ProductGroup = at(`?g=product&${OCTOBER}`);
const MovesDaily = at(`?g=daily&m=${MOVES}&${OCTOBER}`);
const MovesByShop = at(`?g=shop&m=${MOVES}&${OCTOBER}`);
const MovesByCreator = at(`?g=user&m=${MOVES}&${OCTOBER}`);
const MovesBySeller = at(`?g=team&m=${MOVES}&${OCTOBER}`);
const MovesDailyGraph = at(`?g=daily&m=${MOVES}&${OCTOBER}&v=graph`);
// The sample's first days, beside the served Orders created: nothing placed earlier can be completed yet.
const FirstDays = at(`?g=daily&m=metrics/orders/created,${MOVES}&r=2025-01-01..2025-01-03&s=key:asc`);

const meta = {
  title: "Pages/Analytic/Order status moves",
  component: MovesDaily,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [asTeam(12n)],
} satisfies Meta<typeof MovesDaily>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 6000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 6000 });

  return canvas;
}

/** "1.240" → 1240 — a count as id-ID writes it. */
const num = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

const column = (canvas: Canvas, field: string): number[] =>
  canvas.getAllByTestId(new RegExp(`^analytic-cell-[\\d-]+-${field}$`)).map((c: HTMLElement) => num(c.textContent));

const cell = (canvas: Canvas, key: string, field: string) => num(canvas.getByTestId(`analytic-cell-${key}-${field}`).textContent);

const headline = (canvas: Canvas, field: string) => num(canvas.getByTestId(`analytic-headline-${field}-value`).textContent);

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

const rowKeys = (canvas: Canvas) => canvas.getAllByTestId(/^analytic-row-/).map((r: HTMLElement) => r.dataset.testid!.replace("analytic-row-", ""));

/** Every move's count is the sum of its rows (the-headline-is-the-sum-of-its-rows). */
async function sumsToHeadline(canvas: Canvas) {
  for (const field of ORDER_MOVE_FIELDS) await expect(headline(canvas, field)).toBe(sum(column(canvas, field)));
}

/** The sample's count of one move in a window — what the fold wrote for the reader's orders (the stub serves it). */
function sampleCount(field: string, from: string, to: string): number {
  return sum(sampleFacts(MOVES).filter((f) => f.day >= from && f.day <= to).map((f) => f.values[field] ?? 0));
}

/** No figure on the page is money — the metric is counts only. */
async function noMoney(canvasElement: HTMLElement) {
  await expect(within(canvasElement).getByTestId("analytic-table").textContent).not.toMatch(/Rp/);
  await expect(within(canvasElement).getByTestId("analytic-headline").textContent).not.toMatch(/Rp/);
}

async function openOrder(canvas: Canvas) {
  await userEvent.click(canvas.getByTestId("analytic-add-metric"));
  const menu = within(await canvas.findByTestId("analytic-metric-menu"));
  await userEvent.click(menu.getByTestId("analytic-category-order"));

  return menu;
}

// ── the picker ───────────────────────────────────────────────────────────────────────────────────

// ORDER › ORDER STATUS MOVES — after the five served order metrics, one SERVED metric of seven counts, in the order an
// order moves; none is money and none is held from a warehouse. Ticked, it goes on the table.
export const TheMovesAreUnderOrder: Story = {
  name: "Picker: Order › Order status moves",
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });

    const menu = await openOrder(canvas);
    const column = within(menu.getByTestId("analytic-category-order-metrics"));
    const rows = column.getAllByTestId(/^analytic-metric-metrics-[^-]+(-[^-]+)*$/).filter((el) => !el.dataset.testid!.endsWith("-reason"));
    await expect(rows.map((r) => r.dataset.testid)).toEqual([
      ...ORDER_METRICS.map((d) => `analytic-metric-${slug(d.metricId)}`),
      `analytic-metric-${slug(MOVES)}`,
    ]);
    await expect(column.getByTestId(`analytic-metric-${slug(MOVES)}`)).toHaveTextContent(/^Order status moves$/);

    const def = metricById(MOVES)!;
    // Compared as booleans: a failing match would print the whole generated descriptor graph. Read off the served
    // descriptor — the live catalogue's own entry, never a sample's.
    await expect(def === ORDER_MOVES_METRIC).toBe(true);
    await expect(def.schema === OrderMovesMetricSchema).toBe(true);
    await expect(def.fields.map((f) => [f.name, f.kind, f.warehouseHidden])).toEqual([
      ["confirmed_count", "count", false],
      ["back_to_pending_count", "count", false],
      ["picked_count", "count", false],
      ["handed_over_count", "count", false],
      ["shipped_count", "count", false],
      ["problem_count", "count", false],
      ["completed_count", "count", false],
    ]);

    await userEvent.click(column.getByTestId(`analytic-metric-${slug(MOVES)}`));
    await waitFor(() => expect(canvas.getByTestId(`analytic-chip-${slug(MOVES)}`)).toHaveTextContent("Order status moves"));
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(1), { timeout: 6000 });
  },
};

// THE LIVE PICKER SERVES IT — with no prototype shown (as the app always runs), the catalogue is METRICS, the moves are in
// it right after the five, and the prototype gate no longer holds them (only #85's restock waits there).
export const TheLivePickerServesTheMoves: Story = {
  name: "Live picker: the moves are served",
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    // Compared as booleans: a failing match on a MetricDef would print its whole generated descriptor graph.
    await expect(catalogueMetrics() === METRICS).toBe(true);
    await expect(METRICS.indexOf(ORDER_MOVES_METRIC) === ORDER_METRICS.length).toBe(true);
    await expect(PROTOTYPE_METRICS.some((m) => m.metricId === MOVES)).toBe(false);

    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });
    const menu = await openOrder(canvas);
    await expect(menu.getByTestId(`analytic-metric-${slug(MOVES)}`)).toHaveTextContent(/^Order status moves$/);
    await expect(menu.getByTestId("analytic-metric-metrics-orders-lost_created")).toBeVisible();
  },
};

// THE FIVE'S GROUPS AND FILTERS — seller, shop, warehouse, created by and time; never product, so under By product it is
// greyed with why; on the table the bar is the range, the seller, the shop, the warehouse and the person.
export const GroupsAndFiltersAsTheFive: Story = {
  name: "Groups and filters as the five",
  render: () => <ProductGroup />,
  play: async ({ canvasElement }) => {
    await expect(ORDER_MOVES_METRIC.supportedGroupBy).toEqual(ORDER_METRICS[0]!.supportedGroupBy);
    await expect(ORDER_MOVES_METRIC.supportedFilters).toEqual(ORDER_METRICS[0]!.supportedFilters);
    await expect(ORDER_MOVES_METRIC.requiredFilters).toEqual(["dateRange"]);

    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });
    const menu = await openOrder(canvas);
    await expect(menu.getByTestId(`analytic-metric-${slug(MOVES)}`)).toHaveAttribute("data-disabled");
    await expect(menu.getByTestId(`analytic-metric-${slug(MOVES)}-reason`)).toHaveTextContent("products");
  },
};

// ── the figures ──────────────────────────────────────────────────────────────────────────────────

// BY DAY — each day's moves, every count the sum of its days; no money anywhere.
export const MovesByDay: Story = {
  name: "By day",
  render: () => <MovesDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(20);
    await expect(canvas.getAllByTestId(/^analytic-row-/)[0]).toHaveAttribute("data-testid", "analytic-row-2026-10-20");
    for (const field of ORDER_MOVE_FIELDS) {
      await expect(canvas.getByTestId(`analytic-headline-${field}`)).toBeVisible();
      await expect(headline(canvas, field)).toBe(sampleCount(field, "2026-10-01", "2026-10-20"));
    }
    await expect(canvas.getByTestId("analytic-sort-completed_count")).toHaveTextContent("Completed");
    await expect(canvas.getByTestId("analytic-sort-handed_over_count")).toHaveTextContent("Handed over");
    await expect(headline(canvas, "completed_count")).toBeGreaterThan(0);
    await expect(headline(canvas, "back_to_pending_count")).toBeGreaterThan(0);
    await sumsToHeadline(canvas);
    await noMoney(canvasElement);
  },
};

// EACH MOVE ON ITS OWN DAY — the sample's first three days beside the served Orders created: every order placed on the
// 1st is confirmed that day, but none is picked, shipped or completed yet — those count on the days they happen.
export const EachMoveOnItsOwnDay: Story = {
  name: "Each move on its own day",
  render: () => <FirstDays />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2025-01-01", "2025-01-02", "2025-01-03"]);
    await waitFor(() => expect(cell(canvas, "2025-01-01", "created_count")).toBeGreaterThan(0));
    await expect(cell(canvas, "2025-01-01", "confirmed_count")).toBe(cell(canvas, "2025-01-01", "created_count"));
    for (const field of ["picked_count", "handed_over_count", "shipped_count"]) await expect(cell(canvas, "2025-01-01", field)).toBe(0);
    await expect(cell(canvas, "2025-01-02", "picked_count")).toBeGreaterThan(0);
    await expect(headline(canvas, "completed_count")).toBe(0);
    await expect(headline(canvas, "problem_count")).toBe(0);
  },
};

// BY SHOP — the shops with moves in the window, the most confirmed first, each named; Toko Lama sold nothing, so it is no
// row. The rows add up to the headline.
export const MovesByShopStory: Story = {
  name: "By shop",
  render: () => <MovesByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(5);
    await expect(canvas.queryByTestId("analytic-row-14")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("analytic-row-13")).toHaveTextContent("Toko Satria"));
    const confirmed = column(canvas, "confirmed_count");
    await expect([...confirmed].sort((a, b) => b - a)).toEqual(confirmed);
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: shops with order status moves in this period");
    await sumsToHeadline(canvas);
    await noMoney(canvasElement);
  },
};

// BY CREATED BY — the order's creator, as on the five: a pick or a handover counts under whoever created the order, never
// the crew member who moved it (who did it stays on the order's timeline).
export const MovesByCreatedBy: Story = {
  name: "By created by",
  render: () => <MovesByCreator />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect([...rowKeys(canvas)].sort()).toEqual(["61", "62", "65"]);
    await sumsToHeadline(canvas);
  },
};

// THE WAREHOUSE READS THE ORDERS IT SHIPS — Gudang Pusat, by seller: Toko Melati's moves, every count (nothing is money),
// the same figures the seller reads.
export const TheWarehouseReadsEveryCount: Story = {
  name: "A warehouse reads every count",
  render: () => <MovesBySeller />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["12"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    for (const field of ORDER_MOVE_FIELDS) {
      await expect(canvas.getByTestId(`analytic-headline-${field}`)).toBeVisible();
      await expect(canvas.getByTestId(`analytic-sort-${field}`)).toBeVisible();
      await expect(headline(canvas, field)).toBe(sampleCount(field, "2026-10-01", "2026-10-20"));
    }
    await noMoney(canvasElement);
  },
};

// ROOT READS EVERY TEAM'S — by seller; another selling team reads none of Toko Melati's moves.
export const RootReadsEveryTeamsMoves: Story = {
  name: "Root reads every team's",
  render: () => <MovesBySeller />,
  beforeEach: [asTeam(ROOT_TEAM_ID), asPlatformOnly(Role.ROOT)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["12"]);
    await expect(headline(canvas, "confirmed_count")).toBe(sampleCount("confirmed_count", "2026-10-01", "2026-10-20"));
  },
};

export const AnotherSellerReadsNone: Story = {
  name: "Another seller reads none",
  render: () => <MovesBySeller />,
  beforeEach: [asTeam(13n)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-table-empty")).toBeVisible(), { timeout: 6000 });
    await waitFor(() => expect(headline(canvas, "confirmed_count")).toBe(0));
  },
};

// THE GRAPH — counts only, so one Counts graph and no money graph.
export const MovesGraphIsCounts: Story = {
  name: "Graph: counts only",
  render: () => <MovesDailyGraph />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-graph-count")).toBeVisible(), { timeout: 6000 });
    await expect(canvas.getByTestId("analytic-graph-count")).toHaveTextContent("Counts");
    await expect(canvas.queryByTestId("analytic-graph-money")).toBeNull();
    await expect(canvas.getByTestId("analytic-graph-count")).toHaveTextContent("Handed over");
  },
};

// ON A PHONE — each shop a block of its seven counts.
export const MovesOnAPhone: Story = {
  name: "Phone",
  render: () => <MovesByShop />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-13")).toHaveTextContent("Toko Satria"));
    await expect(canvas.getByTestId("analytic-row-13")).toHaveTextContent("Back to pending");
    await expect(canvas.getByTestId("analytic-row-13")).toHaveTextContent("Completed");
  },
};
