import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { asTeam, routedPage } from "../../../.storybook/pageStory";
import { AnalyticPage } from "./index";

// WAREHOUSE FEE on the Analytic composer — the accepted design (the-warehouse-fee-prototype-is-accepted), now SERVED: the
// live catalogue lists it (catalogue.ts WAREHOUSE_FEE_METRIC), and these stories read it over the stub transport's
// OrderAnalyticService (orderAnalyticStub.ts), whose figures are the sample's.
//
// Expense › Warehouse Fee, filtered by team, shop, warehouse, user and date range, with `transaction_count` and `amount`,
// grouped like the order metrics (warehouse-fee-groups-like-the-order-metrics). A fee has two teams, and each is its own
// group (the-warehouse-is-its-own-group): Seller is the selling team charged, Warehouse the warehouse that charged — the
// same two names for every reader. A warehouse reads its own fee's amount (a-warehouse-sees-its-own-fee-amount).

const at = (search: string) => routedPage([{ path: "/analytic", element: <AnalyticPage /> }], `/analytic${search}`);

const FEE = "metrics/warehouse_fee";
const CREATED = "metrics/orders/created";
const OCTOBER = "r=2026-10-01..2026-10-31";

const OrdersByShop = at(`?g=shop&m=${CREATED}&${OCTOBER}`);
const FeeByWarehouse = at(`?g=warehouse&m=${FEE}&${OCTOBER}`);
const FeeBySeller = at(`?g=team&m=${FEE}&${OCTOBER}`);
const FeeAndOrdersBySeller = at(`?g=team&m=${FEE},${CREATED}&${OCTOBER}`);
const OrdersAndFeeForSatria = at(`?g=daily&m=${CREATED},${FEE}&shop=13&r=2026-10-01..2026-10-07`);
const FeeByShop = at(`?g=shop&m=${FEE}&${OCTOBER}&s=${FEE}:amount:desc`);

const meta = {
  title: "Pages/Analytic/Warehouse Fee",
  component: FeeByWarehouse,
  parameters: { dataRouter: true, signedIn: true },
  beforeEach: asTeam(12n),
} satisfies Meta<typeof FeeByWarehouse>;

export default meta;
type Story = StoryObj<typeof meta>;

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("analytic-table")).toBeVisible(), { timeout: 4000 });

  return canvas;
}

/** "Rp 1.240.000" or "1.240" → 1240000 / 1240 — a figure as id-ID writes it. */
const amount = (text: string | null) => Number((text ?? "").replace(/[^\d-]/g, ""));

// THE PICKER — Warehouse Fee sits in Expense beside Ads expense, as the owner's tree draws it, and ticking it adds its
// two fields as columns.
export const WarehouseFeeIsUnderExpense: Story = {
  render: () => <OrdersByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await userEvent.click(canvas.getByTestId("analytic-add-metric"));
    const menu = within(await canvas.findByTestId("analytic-metric-menu"));
    await userEvent.click(menu.getByTestId("analytic-category-expense"));

    const fee = menu.getByTestId("analytic-metric-metrics-warehouse_fee");
    await expect(fee).toHaveTextContent("Warehouse fee");
    await expect(menu.getByTestId("analytic-metric-metrics-ads")).toBeVisible();
    await expect(fee).not.toHaveAttribute("data-disabled");
    await userEvent.click(fee);

    await waitFor(() => expect(canvas.getByTestId("analytic-chip-metrics-warehouse_fee")).toBeVisible());
    await waitFor(() => expect(canvas.getByTestId("analytic-sort-transaction_count")).toBeVisible());
    await expect(canvas.getByTestId("analytic-sort-amount")).toHaveTextContent("Fee amount");
  },
};

// A SELLER READS ITS FEES BY WAREHOUSE — "which warehouse charges me what". The row is the warehouse team, named by
// TeamByIds, and the headline is the row, since this seller ships from one warehouse.
export const ASellerReadsItsFeesByWarehouse: Story = {
  render: () => <FeeByWarehouse />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(1);
    const cell = amount(canvas.getByTestId("analytic-cell-11-amount").textContent);
    await expect(cell).toBeGreaterThan(0);
    await expect(amount(canvas.getByTestId("analytic-headline-amount-value").textContent)).toBe(cell);
    await expect(canvas.getByTestId("analytic-rows-line")).toHaveTextContent("warehouses");
  },
};

// A WAREHOUSE READS THE FEES IT CHARGED, BY SELLER — the same metric from the other side. The fee is the warehouse's own
// money, so its amount is shown to it (a-warehouse-sees-its-own-fee-amount) — a-warehouse-sees-no-seller-money hides only
// the SELLER's money.
export const AWarehouseReadsItsFeesBySeller: Story = {
  render: () => <FeeBySeller />,
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    await expect(canvas.getByTestId("analytic-headline-amount")).toBeVisible();
    await expect(canvas.getByTestId("analytic-headline-transaction_count")).toBeVisible();
    // The amount came back SET for the warehouse — a figure, not a dropped column.
    await waitFor(() => expect(amount(canvas.getByTestId("analytic-cell-12-amount").textContent)).toBeGreaterThan(0));
  },
};

// BESIDE ORDERS CREATED, AS THE WAREHOUSE — the two rules side by side: the fee's amount is the warehouse's own and is
// shown (a-warehouse-sees-its-own-fee-amount); the orders' totals are the seller's and their columns are dropped
// (a-warehouse-sees-no-seller-money).
export const AWarehouseSeesItsFeeButNotTheSellersMoney: Story = {
  render: () => <FeeAndOrdersBySeller />,
  beforeEach: asTeam(11n),
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("analytic-row-12")).toHaveTextContent("Toko Melati"));
    await waitFor(() => expect(canvas.getByTestId("analytic-cell-12-amount")).toBeVisible());
    await expect(canvas.getByTestId("analytic-cell-12-created_count")).toBeVisible();
    await expect(canvas.queryByTestId("analytic-cell-12-created_total")).toBeNull();
  },
};

// BESIDE THE ORDERS, FOR ONE SHOP — the fee lists every filter Orders created does, so adding it removes none: Toko
// Satria's days keep their shop filter, and each day's fees sit beside that day's orders.
export const BesideOrdersItKeepsTheShopFilter: Story = {
  render: () => <OrdersAndFeeForSatria />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("analytic-filter-shop")).toBeVisible();
    await expect(canvas.getAllByTestId(/^analytic-row-/)).toHaveLength(7);
    // A day's fee transactions are its orders: one fee per placed order.
    for (const row of canvas.getAllByTestId(/^analytic-cell-.*-created_count$/)) {
      const day = row.getAttribute("data-testid")!.replace("analytic-cell-", "").replace("-created_count", "");
      await expect(amount(canvas.getByTestId(`analytic-cell-${day}-transaction_count`).textContent)).toBe(
        amount(row.textContent),
      );
    }
  },
};

// RANKED BY AMOUNT — the shops that cost the most in fees first; the headline is the sum of the rows.
export const RankedByAmount: Story = {
  render: () => <FeeByShop />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const cells = canvas.getAllByTestId(/^analytic-cell-\d+-amount$/).map((c) => amount(c.textContent));
    await expect(cells.length).toBeGreaterThan(1);
    await expect([...cells].sort((a, b) => b - a)).toEqual(cells);
    await expect(amount(canvas.getByTestId("analytic-headline-amount-value").textContent)).toBe(
      cells.reduce((s, c) => s + c, 0),
    );
  },
};

// ON A PHONE — each warehouse a block of its two figures.
export const Mobile: Story = {
  render: () => <FeeByWarehouse />,
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("analytic-table")).queryAllByRole("columnheader")).toHaveLength(0);
    await waitFor(() => expect(canvas.getByTestId("analytic-row-11")).toHaveTextContent("Gudang Pusat"));
  },
};
