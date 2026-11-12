import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { inventoryAnalyticLatency } from "../../../.storybook/inventoryAnalyticStub";
import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { AnalyticPage } from "./index";

// INVENTORY › LOST STOCK on the Analytic composer (inventory-lost-groups-and-sits-under-inventory,
// the-inventory-lost-prototype-is-accepted) — LIVE: served by inventory_service; the Storybook stub
// (inventoryAnalyticStub.ts) answers from the sample's lost facts, scoped as the server scopes the reader
// (a-warehouse-sees-its-lost-amount).
//
// The warehouse's custody losses — stock-count shortages and Stock Adjust *lost*, at batch price
// (inventory-lost-counts-the-warehouses-custody-losses), gross (inventory-lost-is-gross): `lost_count`, `lost_amount`.
// Grouped by product, supplier, seller (the team owning the stock), warehouse and time; no shop — so no shop filter.
// The sample: Toko Melati's (12) stock, held at Gudang Pusat (11) and Gudang Cabang (14).

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const LOST = "metrics/inventory/lost";
const QUARTER = "r=2026-08-01..2026-10-31";

const Nothing = at(`?g=product&${QUARTER}`);
const ByProduct = at(`?g=product&m=${LOST}&${QUARTER}&s=${LOST}:lost_amount:desc`);
const BySupplier = at(`?g=supplier&m=${LOST}&${QUARTER}&s=${LOST}:lost_amount:desc`);
const ByWarehouse = at(`?g=warehouse&m=${LOST}&${QUARTER}&s=${LOST}:lost_amount:desc`);
const Monthly = at(`?g=monthly&m=${LOST}&r=2026-01-01..2026-10-31`);
const OrdersForSatria = at("?g=daily&m=metrics/orders/created&shop=13&r=2026-10-01..2026-10-07");

const meta = {
  title: "Pages/Analytic/Lost stock",
  component: ByProduct,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: [asTeam(12n)],
} satisfies Meta<typeof ByProduct>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 4000 });
  await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(0), { timeout: 4000 });

  return canvas;
}

/** "Rp 1.240.000" or "1.240" → 1240000 / 1240 — a figure as id-ID writes it. */
const num = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

const column = (canvas: ReturnType<typeof within>, field: string): number[] =>
  canvas.getAllByTestId(new RegExp(`^analytic-cell-[\\d-]+-${field}$`)).map((c: HTMLElement) => num(c.textContent));

/** Every row of a lost table: amounts ranked, a loss in each, and the headline the sum of the rows (a movement). */
async function sumsToHeadline(canvas: ReturnType<typeof within>) {
  const amounts = column(canvas, "lost_amount");
  await expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  await expect(amounts.every((a) => a > 0)).toBe(true);
  await expect(num(canvas.getByTestId("analytic-headline-lost_amount-value").textContent)).toBe(amounts.reduce((s, a) => s + a, 0));
  await expect(num(canvas.getByTestId("analytic-headline-lost_count-value").textContent)).toBe(
    column(canvas, "lost_count").reduce((s, a) => s + a, 0),
  );
}

// THE PICKER — Lost stock is a leaf of Inventory, its two fields Lost units and Lost amount.
export const LostIsUnderInventory: Story = {
  render: () => <Nothing />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-empty")).toBeVisible(), { timeout: 4000 });

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-inventory"));

    const lost = within(menu.getByTestId("analytic-category-inventory-metrics")).getByTestId("analytic-metric-metrics-inventory-lost");
    await expect(lost).toHaveTextContent(/^Lost stock$/);
    await expect(lost).not.toHaveAttribute("data-disabled");
    await userEvent.click(lost);

    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-inventory-lost")).toHaveTextContent("Lost stock"));
    await expect(lost).toHaveAttribute("data-state", "checked");
    await waitFor(() => expect(canvas.getByTestId("analytic-sort-lost_count")).toHaveTextContent("Lost units"));
    await expect(canvas.getByTestId("analytic-sort-lost_amount")).toHaveTextContent("Lost amount");
    await waitFor(() => expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(1));
  },
};

// BY PRODUCT — the products that lost the most value first, each named by ProductByIds (a served row is never named by
// the sample: without the lookup it would read "#205").
export const LostByProduct: Story = {
  render: () => <ByProduct />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-205")).toHaveTextContent("Sepatu Kanvas"));
    await expect(canvas.getByTestId("analytic-row-201")).toHaveTextContent("Kaos Polos Hitam");
    await expect(canvas.getByTestId("analytic-row-205")).not.toHaveTextContent("#205");
    await expect(canvas.getAllByTestId(/^analytic-row-/).length).toBeGreaterThan(3);
    await sumsToHeadline(canvas);
  },
};

// BY SUPPLIER — whose goods go missing, the product's supplier, named by SupplierByIds.
export const LostBySupplier: Story = {
  render: () => <BySupplier />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(3);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-31")).toHaveTextContent("PT Sumber Makmur"));
    await expect(canvas.getByTestId("analytic-row-32")).toHaveTextContent("CV Cahaya Abadi");
    await expect(canvas.getByTestId("analytic-row-33")).toHaveTextContent("Toko Grosir Sinar");
    // The accepted rows line (the-inventory-lost-prototype-is-accepted).
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("Rows: suppliers with lost stock in this period");
    await sumsToHeadline(canvas);
  },
};

// BY WAREHOUSE — a seller's stock in two warehouses: which one loses it, named by TeamByIds.
export const LostByWarehouse: Story = {
  render: () => <ByWarehouse />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(2);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(canvas.getByTestId("analytic-row-14")).toHaveTextContent("Gudang Cabang");
    await sumsToHeadline(canvas);
  },
};

// MONTHLY — every month of the window a row, a quiet one included, newest first; the year's headline is the sum.
export const LostMonthly: Story = {
  render: () => <Monthly />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const rows = canvas.getAllByTestId(/^analytic-row-/);
    await expect(rows).toHaveLength(10);
    await expect(rows[0]).toHaveAttribute("data-testid", "analytic-row-2026-10-01");
    const amounts = column(canvas, "lost_amount");
    await expect(amounts.some((a) => a > 0)).toBe(true);
    await expect(num(canvas.getByTestId("analytic-headline-lost_amount-value").textContent)).toBe(amounts.reduce((s, a) => s + a, 0));
  },
};

// NO SHOP FILTER — lost stock belongs to no shop. Lost alone shows the seller, warehouse, product and supplier filters
// but no shop; added beside Orders created for Toko Satria, it takes the shop filter away, and the toast says so.
export const LostHasNoShopFilter: Story = {
  render: () => <OrdersForSatria />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.getByTestId("analytic-filter-shop")).toBeVisible();

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-inventory"));
    await userEvent.click(menu.getByTestId("analytic-metric-metrics-inventory-lost"));

    await waitFor(() => expect(canvas.queryByTestId("analytic-filter-shop")).toBeNull());
    await expect(canvas.getByTestId("analytic-filter-team")).toBeVisible();
    await expect(canvas.getByTestId("analytic-filter-warehouse")).toBeVisible();
    await expect(canvas.getByTestId("analytic-chip-metrics-inventory-lost")).toBeVisible();

    // Orders off — Lost alone still has no shop filter, and gains product and supplier.
    await userEvent.click(canvas.getByTestId("analytic-chip-metrics-orders-created-remove"));
    await waitFor(() => expect(canvas.getByTestId("analytic-filter-product")).toBeVisible());
    await expect(canvas.getByTestId("analytic-filter-supplier")).toBeVisible();
    await expect(canvas.queryByTestId("analytic-filter-shop")).toBeNull();
  },
};

// AN ID GROUP TO A TIME GROUP (#43) — by warehouse, then Monthly. While the months load, the warehouses stay on screen
// behind the overlay (HARD RULE 10), still named as warehouses — never read as dates: the page once fell over here with
// "Invalid time value" (keyLabel formatted the kept rows' ids by the new group). Then the months replace them.
export const SwitchingWarehouseToMonthly: Story = {
  render: () => <ByWarehouse />,
  beforeEach: [
    () => {
      inventoryAnalyticLatency.ms = 600;

      return () => {
        inventoryAnalyticLatency.ms = 0;
      };
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"), { timeout: 6000 });

    await userEvent.click(canvas.getByTestId("analytic-group"));
    await waitFor(() => expect(canvas.getByTestId("analytic-group-option-monthly")).toBeVisible());
    await userEvent.click(canvas.getByTestId("analytic-group-option-monthly"));

    // The months are on their way: the page stands, the warehouses still there and still named.
    await expect(canvas.getByTestId("analytic-page")).toBeVisible();
    await expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat");
    await expect(canvas.getByTestId("analytic-row-14")).toHaveTextContent("Gudang Cabang");

    // Then the months, each named as one.
    await waitFor(() => expect(canvas.queryByTestId("analytic-row-11")).toBeNull(), { timeout: 6000 });
    const months = canvas.getAllByTestId(/^analytic-row-2026-\d{2}-01$/);
    await expect(months.length).toBeGreaterThan(0);
    for (const row of months) await expect(row).toHaveTextContent(/(Aug|Sep|Oct) 2026/);
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(months.length);
  },
};

// ON A PHONE — each warehouse a block of its two figures.
export const Mobile: Story = {
  render: () => <ByWarehouse />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Lost amount");
  },
};

// A WAREHOUSE READS ITS OWN (a-warehouse-sees-its-lost-amount): Gudang Pusat sees only the stock lost in its custody —
// with the amount, what it owes — never Gudang Cabang's.
export const AWarehouseSeesItsLostAmount: Story = {
  render: () => <ByWarehouse />,
  beforeEach: [asTeam(11n)],
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
    await expect(canvas.getByTestId("analytic-row-11")).toBeVisible();
    await expect(num(canvas.getByTestId("analytic-cell-11-lost_amount").textContent)).toBeGreaterThan(0);
    await expect(num(canvas.getByTestId("analytic-headline-lost_amount-value").textContent)).toBe(
      num(canvas.getByTestId("analytic-cell-11-lost_amount").textContent),
    );
  },
};
