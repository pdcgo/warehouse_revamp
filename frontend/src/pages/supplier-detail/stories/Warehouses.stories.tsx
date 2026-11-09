import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SUPPLIER_DETAIL_META, AtSinar, loaded } from "./kit";

// SUPPLIER DETAIL — Gudang terkait (a-supplier-page-is-scoped-by-its-warehouses) — the chips over the tabs and the
// summary under them. The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Suppliers/SupplierDetail/Warehouses",
  ...SUPPLIER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE WAREHOUSES SCOPE THE PAGE — the warehouses its restocks were received at, as chips over the tabs (the page's
// scope, not one tab's); Semua first, then the most restocked; under them, before the tabs, the summary of the chosen
// one or of all — real (InventoryService.SupplierGoods by warehouse). Marked 4: the pick only switches the summary.
export const TheWarehousesScopeThePage: Story = {
  name: "Chips and summary",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("supplier-warehouses");
    await expect(within(row).queryByTestId("not-implemented-warehouses")).toBeNull();
    await expect(within(row).getByTestId("not-implemented-warehouseFilter")).toHaveTextContent("4");
    await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByTestId("supplier-tabs").getBoundingClientRect().top,
    );

    // Each chip is a warehouse's name, nothing more (a-warehouse-chip-is-its-name-and-the-summary-follows-it)…
    const chips = await waitFor(() => {
      const found = within(within(row).getByTestId("supplier-warehouses-chips")).getAllByRole("button");
      expect(found.map((c) => c.textContent)).toEqual(["All", "Gudang Pusat", "Gudang Cabang"]);
      return found;
    });
    await expect(chips[0]).toHaveAttribute("aria-pressed", "true");

    // …and under them what this supplier's goods did there: units sold, from how many orders and the last; units ready,
    // from how many restocks and the last (the-summary-is-sold-and-ready-with-their-counts).
    const summary = within(row).getByTestId("supplier-warehouse-summary");
    await expect(within(summary).getAllByText(/^(Sold|Ready)$/)).toHaveLength(2);
    // All: 1.204 + 303 + 0 sold on 77 + 21 orders; 86 + 25 + 40 ready from 9 + 2 + 1 restocks.
    await expect(within(summary).getByTestId("supplier-warehouse-summary-sold")).toHaveTextContent(/1\.507 units.*from 98 orders · last /);
    await expect(within(summary).getByTestId("supplier-warehouse-summary-ready")).toHaveTextContent(/151 units.*12 restocks · last /);
    await userEvent.click(chips[2]!);
    await expect(chips[2]).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(within(row).getByTestId("supplier-warehouse-summary-sold")).toHaveTextContent(/303 units.*from 21 orders/),
    );
  },
};

// …and a supplier none of whose goods ever arrived was never restocked — said in words.
export const NoStoresMeansNoWarehouses: Story = {
  name: "No stores, none",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(await canvas.findByTestId("supplier-warehouses-none")).toBeVisible();
  },
};
