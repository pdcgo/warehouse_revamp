import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { RESTOCK_ID } from "../../../.storybook/inventoryMetricsFixtures";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { asPlatformOnly } from "../../../.storybook/sessionScenario";
import { INVENTORY_METRICS, METRICS, catalogueMetrics, metricById, showPrototypeMetrics } from "../../features/analytic/catalogue";
import { ROOT_TEAM_ID } from "../../features/team/TeamContext";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { AnalyticPage } from "./index";

// ⚠ PROTOTYPE (backlog #85) — RESTOCK BEFORE THE ACCEPT on the Analytic composer, for the owner's design accept.
// Storybook only: the meta's beforeEach shows the prototypes and its cleanup hides them; while shown, the prototype takes
// the live Restock's place (same id, same filters and groups), and the live screen keeps the accepted four
// (TheLiveRestockIsUntouched). Answered from sample.ts until the folds are built.
//
// What the checklist asks (acceptances/inventory/restock.md, 12 rows): a restock recorded at create, adjusted at every edit
// — warehouse, shipping cost, lines, ongoing and arrived —, lost recorded at mark lost, the COD recorded at accept
// (the-inventory-metrics-prototype-is-accepted, its 2026-11-18 🔄 line). Drawn as Restock with five more fields:
//   Units / Value ordered — on the create day; an edit's DIFFERENCE on the edit day, a warehouse change −/+ under the two
//     warehouses that day (past days never change — an-expense-correction-counts-on-the-day-it-is-made, the owner's
//     correction pick); the value is the restock's total, goods + shipping (the-couriers-charge-stays-out-of-total),
//     spread over the units as the landed price is (restock.md §Calculating Price Unit);
//   Units / Value lost on the way — on the lost day;
//   the accepted four, as served — on the accept day;
//   Courier COD — on the accept day, Terima's final figure (the-courier-charge-is-noted-at-tiba-and-final-at-terima).
// A warehouse reads the units and the COD it paid (the-warehouse-sees-the-cod-it-paid), never a value
// (a-warehouse-sees-no-seller-money). ⚠ Two readings are the build's defaults, asked at the accept: a CANCEL takes the
// ordered back on its day, and a lost box that TURNS UP takes the lost back on its day.
//
// THE WORKED RESTOCKS (sample.ts SAMPLE_RESTOCKS_OCTOBER — Toko Melati's, Gudang Pusat unless named; nothing else
// restocks 1–20 Oct):
//   R6  1 Oct ordered 5 × Kemeja Flanel, ongkir 15.000 · lost 5 Oct · turns up 18 Oct · accepted 19 Oct, COD 5.000
//   R7  2 Oct ordered 6 × Sepatu Kanvas, ongkir 12.000 · arrived 7 Oct · edited while arrived 9 Oct: + 2 × Tas Selempang
//       · accepted 12 Oct
//   R1  6 Oct ordered 20 × Kaos Polos Hitam + 10 × Kemeja Flanel, ongkir 30.000 · edited 8 Oct: Kaos 20 → 30 ·
//       accepted 10 Oct: 1 broken, 2 missing, COD 20.000
//   R5  7 Oct ordered 10 × Kaos Polos Hitam, ongkir 10.000 · cancelled 11 Oct
//   R2 12 Oct ordered 10 × Sepatu Kanvas to Gudang Cabang, ongkir 20.000 · edited 13 Oct: to Gudang Pusat · accepted 16 Oct
//   R3 14 Oct ordered 4 × Tas Selempang, ongkir 20.000 · lost 17 Oct
//   R4 15 Oct ordered 50 × Botol Minum + 50 × Kotak Makan, ongkir 20.000 · edited 16 Oct: ongkir → 35.000 · accepted
//       20 Oct: 3 missing, COD 10.000

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const OCTOBER = "r=2026-10-01..2026-10-20";

const Nothing = at(`?g=product&${OCTOBER}`);
const ShopGroup = at(`?g=shop&${OCTOBER}`);
const RestockDaily = at(`?g=daily&m=${RESTOCK_ID}&${OCTOBER}`);
const TheMoveDay = at(`?g=warehouse&m=${RESTOCK_ID}&r=2026-10-13..2026-10-13`);
const TheEditDay = at(`?g=product&m=${RESTOCK_ID}&r=2026-10-08..2026-10-08`);
const RestockBySeller = at(`?g=team&m=${RESTOCK_ID}&${OCTOBER}`);
const RestockByProduct = at(`?g=product&m=${RESTOCK_ID}&${OCTOBER}`);
const RestockByProductByValue = at(`?g=product&m=${RESTOCK_ID}&${OCTOBER}&s=${RESTOCK_ID}:ordered_value:desc`);
const CabangsTwoDays = at(`?g=daily&m=${RESTOCK_ID}&r=2026-10-12..2026-10-13`);
const RestockMonthlyGraph = at(`?g=monthly&m=${RESTOCK_ID}&r=2026-08-01..2026-10-31&v=graph`);
const RestockDailyGraph = at(`?g=daily&m=${RESTOCK_ID}&${OCTOBER}&v=graph`);
const RestockMonthly = at(`?g=monthly&m=${RESTOCK_ID}&r=2026-08-01..2026-10-31`);

const meta = {
  title: "Pages/Analytic/Restock before the accept (prototype)",
  component: RestockDaily,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [
    asTeam(12n),
    () => {
      showPrototypeMetrics(true);

      return () => showPrototypeMetrics(false);
    },
  ],
} satisfies Meta<typeof RestockDaily>;

export default meta;
type Story = StoryObj<typeof meta>;

type Canvas = ReturnType<typeof within>;

const FIELDS = [
  "ordered_count",
  "ordered_value",
  "lost_count",
  "lost_value",
  "accepted_count",
  "accepted_value",
  "broken_count",
  "missing_count",
  "cod_amount",
] as const;
type Field = (typeof FIELDS)[number];

/** What a warehouse is not given — the seller's money. */
const VALUES: Field[] = ["ordered_value", "lost_value", "accepted_value"];

/** Each worked day's figures, as root and Toko Melati read them; a day not named, and a field not named, is 0. */
const OCTOBER_DAYS: Record<string, Partial<Record<Field, number>>> = {
  "2026-10-01": { ordered_count: 5, ordered_value: 615_000 }, // R6 created: 5 × 120.000 + 15.000
  "2026-10-02": { ordered_count: 6, ordered_value: 1_092_000 }, // R7 created
  "2026-10-05": { lost_count: 5, lost_value: 615_000 }, // R6 lost — its whole ordered value
  "2026-10-06": { ordered_count: 30, ordered_value: 2_130_000 }, // R1 created: 900.000 + 1.200.000 + 30.000
  "2026-10-07": { ordered_count: 10, ordered_value: 460_000 }, // R5 created
  "2026-10-08": { ordered_count: 10, ordered_value: 450_000 }, // R1 edited: + 10 × 45.000, the ongkir unchanged
  "2026-10-09": { ordered_count: 2, ordered_value: 190_000 }, // R7 edited while arrived: + 2 × 95.000
  // R1 accepted: 37 good at the landed price ((30.000 + 20.000) / 40 = 1.250 a unit), 1 broken, 2 missing, COD 20.000.
  "2026-10-10": { accepted_count: 37, accepted_value: 2_386_250, broken_count: 1, missing_count: 2, cod_amount: 20_000 },
  "2026-10-11": { ordered_count: -10, ordered_value: -460_000 }, // R5 cancelled — ⚠ the build's default
  "2026-10-12": { ordered_count: 10, ordered_value: 1_820_000, accepted_count: 8, accepted_value: 1_282_000 }, // R2 created; R7 accepted
  "2026-10-13": {}, // R2 moved Cabang → Pusat: −10 and +10, the day nets 0
  "2026-10-14": { ordered_count: 4, ordered_value: 400_000 }, // R3 created
  "2026-10-15": { ordered_count: 100, ordered_value: 695_000 }, // R4 created
  "2026-10-16": { ordered_value: 15_000, accepted_count: 10, accepted_value: 1_820_000 }, // R4's ongkir 20.000 → 35.000; R2 accepted
  "2026-10-17": { lost_count: 4, lost_value: 400_000 }, // R3 lost
  "2026-10-18": { lost_count: -5, lost_value: -615_000 }, // R6 turns up — ⚠ the build's default
  "2026-10-19": { accepted_count: 5, accepted_value: 620_000, cod_amount: 5_000 }, // R6 accepted
  "2026-10-20": { accepted_count: 97, accepted_value: 697_650, missing_count: 3, cod_amount: 10_000 }, // R4 accepted
};

const TOTALS: Record<Field, number> = {
  ordered_count: 167,
  ordered_value: 7_407_000,
  lost_count: 4,
  lost_value: 400_000,
  accepted_count: 157,
  accepted_value: 6_805_900,
  broken_count: 1,
  missing_count: 5,
  cod_amount: 35_000,
};

const OCTOBER_1_TO_20 = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 6000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 6000 });

  return canvas;
}

/** "−Rp 460.000" / "-10" / "1.240" → −460000 / −10 / 1240 — a whole figure as id-ID writes it, its sign kept. */
const num = (text: string | null) => (/[-−]/.test(text ?? "") ? -1 : 1) * Number((text ?? "").replace(/[^\d]/g, ""));

const column = (canvas: Canvas, field: string): number[] =>
  canvas.getAllByTestId(new RegExp(`^analytic-cell-[\\d-]+-${field}$`)).map((c: HTMLElement) => num(c.textContent));

const cell = (canvas: Canvas, key: string, field: string) => num(canvas.getByTestId(`analytic-cell-${key}-${field}`).textContent);

const headline = (canvas: Canvas, field: string) => num(canvas.getByTestId(`analytic-headline-${field}-value`).textContent);

const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);

const rowKeys = (canvas: Canvas) => canvas.getAllByTestId(/^analytic-row-/).map((r: HTMLElement) => r.dataset.testid!.replace("analytic-row-", ""));

async function sumsToHeadline(canvas: Canvas, fields: readonly string[]) {
  for (const field of fields) await expect(headline(canvas, field)).toBe(sum(column(canvas, field)));
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

const slug = (id: string) => id.replaceAll("/", "-");

// ── the picker ───────────────────────────────────────────────────────────────────────────────────

// INVENTORY › RESTOCK, WIDENED — the same leaf, the same place; its fields now run ordered → lost → the accepted four →
// the COD, and a warehouse is not given the three values.
export const RestockGainsItsFields: Story = {
  name: "Picker: Inventory › Restock",
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });

    const menu = await openInventory(canvas);
    const column = within(menu.getByTestId("analytic-category-inventory-metrics"));
    await expect(column.getByTestId(`analytic-metric-${slug(RESTOCK_ID)}`)).toHaveTextContent(/^Restock$/);

    const def = metricById(RESTOCK_ID)!;
    // Compared as a boolean: a failing match would print the whole generated descriptor graph.
    await expect(def.schema === undefined).toBe(true);
    await expect(def.fields.map((f) => f.name)).toEqual([...FIELDS]);
    await expect(def.fields.filter((f) => f.warehouseHidden).map((f) => f.name)).toEqual(VALUES);
    await expect(def.fields.find((f) => f.name === "cod_amount")).toMatchObject({ kind: "money", warehouseHidden: false });
    await expect(def.supportedGroupBy).toEqual(INVENTORY_METRICS[0]!.supportedGroupBy);
    await expect(def.supportedFilters).toEqual(INVENTORY_METRICS[0]!.supportedFilters);

    await userEvent.click(column.getByTestId(`analytic-metric-${slug(RESTOCK_ID)}`));
    await waitFor(() => expect(canvas.getByTestId(`analytic-chip-${slug(RESTOCK_ID)}`)).toHaveTextContent("Restock"));
    await waitFor(() => expect(canvas.getByTestId("analytic-sort-ordered_count")).toHaveTextContent("Units ordered"));
    await expect(canvas.getByTestId("analytic-sort-cod_amount")).toHaveTextContent("Courier COD");
  },
};

// TODAY — the same October days on the live Restock (prototypes hidden): the served accepted four alone, nothing before the
// accept. The accept's BEFORE picture.
export const TodaysRestockByDay: Story = {
  name: "Today: the live Restock by day",
  render: () => <RestockDaily />,
  beforeEach: [() => showPrototypeMetrics(false)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    for (const f of ["accepted_count", "accepted_value", "broken_count", "missing_count"]) await expect(canvas.getByTestId(`analytic-sort-${f}`)).toBeVisible();
    for (const f of ["ordered_count", "ordered_value", "lost_count", "lost_value", "cod_amount"]) {
      await expect(canvas.queryByTestId(`analytic-sort-${f}`)).toBeNull();
    }
  },
};

// THE LIVE RESTOCK IS UNTOUCHED — with the prototypes hidden (as the app always runs), Restock is the served metric with
// the accepted four alone.
export const TheLiveRestockIsUntouched: Story = {
  name: "Live: the accepted four",
  render: () => <Nothing />,
  beforeEach: [() => showPrototypeMetrics(false)],
  play: async () => {
    // Compared as booleans: a failing match on a MetricDef would print its whole generated descriptor graph.
    await expect(catalogueMetrics() === METRICS).toBe(true);
    await expect(metricById(RESTOCK_ID)?.schema !== undefined).toBe(true);
    await expect(metricById(RESTOCK_ID)?.fields.map((f) => f.name)).toEqual(["accepted_count", "accepted_value", "broken_count", "missing_count"]);
  },
};

// STILL NO SHOP GROUP — Lost stock's groups, as the live Restock.
export const StillNoShopGroup: Story = {
  name: "No shop group",
  render: () => <ShopGroup />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 6000 });
    const menu = await openInventory(canvas);
    await expect(menu.getByTestId(`analytic-metric-${slug(RESTOCK_ID)}`)).toHaveAttribute("data-disabled");
    await expect(menu.getByTestId(`analytic-metric-${slug(RESTOCK_ID)}-reason`)).toHaveTextContent("shops");
  },
};

// ── the days ─────────────────────────────────────────────────────────────────────────────────────

// BY DAY — every worked restock's step on its own day: ordered at create, an edit's difference at the edit (a line, a
// line while arrived, the ongkir), the cancel and the turned-up box taking back on their days, lost on the lost day, the
// accepted four and the COD on the accept day. The headline is the sum of the days.
export const RestockByDay: Story = {
  name: "By day — the worked restocks",
  render: () => <RestockDaily />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual([...OCTOBER_1_TO_20].reverse());
    for (const day of OCTOBER_1_TO_20) {
      for (const field of FIELDS) await expect({ day, field, value: cell(canvas, day, field) }).toEqual({ day, field, value: OCTOBER_DAYS[day]?.[field] ?? 0 });
    }
    for (const field of FIELDS) await expect({ field, value: headline(canvas, field) }).toEqual({ field, value: TOTALS[field] });
    await sumsToHeadline(canvas, FIELDS);
    await expect(canvas.getByTestId("analytic-cell-2026-10-11-ordered_value")).toHaveTextContent("−Rp 460.000");
  },
};

// A WAREHOUSE CHANGE — on the edit day R2's ten pairs of Sepatu Kanvas leave Gudang Cabang and arrive under Gudang Pusat;
// the day nets nothing.
export const AWarehouseChangeMovesItOnTheEditDay: Story = {
  name: "A warehouse change, by warehouse",
  render: () => <TheMoveDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["11", "14"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-14")).toHaveTextContent("Gudang Cabang"));
    await expect(cell(canvas, "11", "ordered_count")).toBe(10);
    await expect(cell(canvas, "11", "ordered_value")).toBe(1_820_000);
    await expect(cell(canvas, "14", "ordered_count")).toBe(-10);
    await expect(cell(canvas, "14", "ordered_value")).toBe(-1_820_000);
    await expect(headline(canvas, "ordered_count")).toBe(0);
    await expect(headline(canvas, "ordered_value")).toBe(0);
  },
};

// AN EDIT BY PRODUCT — R1's Kaos Polos Hitam goes 20 → 30 on 8 Oct: +10 units and their goods, and the unchanged ongkir
// spread over 40 units instead of 30 moves 2.500 from Kemeja Flanel to Kaos; the restock's difference is +450.000.
export const AnEditByProduct: Story = {
  name: "An edit's difference, by product",
  render: () => <TheEditDay />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["201", "202"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-201")).toHaveTextContent("Kaos Polos Hitam"));
    await expect(cell(canvas, "201", "ordered_count")).toBe(10);
    await expect(cell(canvas, "201", "ordered_value")).toBe(452_500);
    await expect(cell(canvas, "202", "ordered_count")).toBe(0);
    await expect(cell(canvas, "202", "ordered_value")).toBe(-2_500);
    await expect(headline(canvas, "ordered_value")).toBe(450_000);
  },
};

// BY SELLER, AS ROOT — the team that raised the restocks; root reads every team's.
export const RestockBySellerAsRoot: Story = {
  name: "By seller, as root",
  render: () => <RestockBySeller />,
  beforeEach: [asTeam(ROOT_TEAM_ID), asPlatformOnly(Role.ROOT)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["12"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    for (const field of FIELDS) await expect(cell(canvas, "12", field)).toBe(TOTALS[field]);
  },
};

// BY PRODUCT — the window's products, each named; the rows add up to the headline.
export const RestockByProductStory: Story = {
  name: "By product",
  render: () => <RestockByProduct />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect([...rowKeys(canvas)].sort()).toEqual(["201", "202", "203", "204", "205", "206"]);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await sumsToHeadline(canvas, FIELDS);
    for (const field of FIELDS) await expect(headline(canvas, field)).toBe(TOTALS[field]);
  },
};

// ── who reads ────────────────────────────────────────────────────────────────────────────────────

// A WAREHOUSE READS UNITS AND ITS COD — Gudang Pusat, by day: what is ordered to it, lost on the way, accepted and found
// at its door, and the COD it paid — never a value. R2 reaches it on the 13th, the day it was moved there.
export const AWarehouseReadsUnitsAndCod: Story = {
  name: "A warehouse: units and COD",
  render: () => <RestockDaily />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await showsNoValue(canvas, VALUES);
    for (const f of ["ordered_count", "lost_count", "accepted_count", "broken_count", "missing_count", "cod_amount"]) {
      await expect(canvas.getByTestId(`analytic-sort-${f}`)).toBeVisible();
    }
    await expect(cell(canvas, "2026-10-12", "ordered_count")).toBe(0);
    await expect(cell(canvas, "2026-10-13", "ordered_count")).toBe(10);
    await expect(cell(canvas, "2026-10-10", "cod_amount")).toBe(20_000);
    await expect(headline(canvas, "ordered_count")).toBe(TOTALS.ordered_count);
    await expect(headline(canvas, "cod_amount")).toBe(TOTALS.cod_amount);
    await sumsToHeadline(canvas, ["ordered_count", "lost_count", "accepted_count", "cod_amount"]);
  },
};

// THE OLD WAREHOUSE SEES IT LEAVE — Gudang Cabang: R2 ordered to it on the 12th, taken away on the 13th.
export const TheOldWarehouseSeesItLeave: Story = {
  name: "The old warehouse sees it leave",
  render: () => <CabangsTwoDays />,
  beforeEach: [asTeam(14n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(cell(canvas, "2026-10-12", "ordered_count")).toBe(10);
    await expect(cell(canvas, "2026-10-13", "ordered_count")).toBe(-10);
    await expect(headline(canvas, "ordered_count")).toBe(0);
    await showsNoValue(canvas, VALUES);
  },
};

// A LINK RANKED BY A VALUE, OPENED BY A WAREHOUSE — it opens on its default (units ordered) instead of a refusal.
export const AWarehouseOpensAValueSortedLink: Story = {
  name: "A warehouse opens a value-sorted link",
  render: () => <RestockByProductByValue />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.queryByTestId("analytic-error")).toBeNull();
    const units = column(canvas, "ordered_count");
    await expect([...units].sort((a, b) => b - a)).toEqual(units);
    await showsNoValue(canvas, VALUES);
  },
};

// ── the graph and the phone ──────────────────────────────────────────────────────────────────────

// BY MONTH — August to October, the counts and the money each in its graph; the headline the sum of the months.
export const RestockMonthlyStory: Story = {
  name: "By month",
  render: () => <RestockMonthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(rowKeys(canvas)).toEqual(["2026-10-01", "2026-09-01", "2026-08-01"]);
    await expect(cell(canvas, "2026-09-01", "ordered_count")).toBeGreaterThan(0);
    await sumsToHeadline(canvas, FIELDS);
  },
};

// BY DAY AS A GRAPH — the units in one graph, the money in another: the ordered spikes on the create days, the edits'
// and the take-backs as small steps, the accepts and their COD.
export const RestockDailyGraphStory: Story = {
  name: "Graph by day",
  render: () => <RestockDailyGraph />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-graph-count")).toBeVisible(), { timeout: 6000 });
    await expect(canvas.getByTestId("analytic-graph-count")).toHaveTextContent("Units lost on the way");
    await expect(canvas.getByTestId("analytic-graph-money")).toHaveTextContent("Value ordered");
  },
};

export const RestockGraph: Story = {
  name: "Graph by month",
  render: () => <RestockMonthlyGraph />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-graph-count")).toBeVisible(), { timeout: 6000 });
    await expect(canvas.getByTestId("analytic-graph-count")).toHaveTextContent("Units ordered");
    await expect(canvas.getByTestId("analytic-graph-money")).toHaveTextContent("Courier COD");
  },
};

// ON A PHONE — each product a block of its figures.
export const RestockOnAPhone: Story = {
  name: "Phone",
  render: () => <RestockByProduct />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Units ordered");
    await expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Courier COD");
  },
};
