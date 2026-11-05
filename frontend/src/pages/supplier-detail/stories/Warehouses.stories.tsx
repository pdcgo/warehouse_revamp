import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

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
// scope, not one tab's); Semua first; under them, before the tabs, the summary of the chosen one or of all. Marked 4
// (sample) and 5 (the pick only switches the summary).
export const TheWarehousesScopeThePage: Story = {
  name: "Chips and summary",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    const row = canvas.getByTestId("supplier-warehouses");
    await expect(within(row).getByTestId("not-implemented-warehouses")).toHaveTextContent("4");
    await expect(within(row).getByTestId("not-implemented-warehouseFilter")).toHaveTextContent("5");
    await expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      canvas.getByTestId("supplier-tabs").getBoundingClientRect().top,
    );

    // Each chip is a warehouse's name, nothing more (a-warehouse-chip-is-its-name-and-the-summary-follows-it)…
    const chips = within(within(row).getByTestId("supplier-warehouses-chips")).getAllByRole("button");
    await expect(chips[0]).toHaveTextContent("All");
    await expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    await expect(chips[1]).toHaveTextContent(/^Gudang \S+$/);

    // …and under them what this supplier's goods did there: units sold, from how many orders and the last; units ready,
    // from how many restocks and the last (the-summary-is-sold-and-ready-with-their-counts).
    const summary = within(row).getByTestId("supplier-warehouse-summary");
    await expect(within(summary).getAllByText(/^(Sold|Ready)$/)).toHaveLength(2);
    await expect(within(summary).getByTestId("supplier-warehouse-summary-sold")).toHaveTextContent(/from [\d.]+ orders · last /);
    await expect(within(summary).getByTestId("supplier-warehouse-summary-ready")).toHaveTextContent(/[\d.]+ restocks · last /);
    await userEvent.click(chips[1]!);
    await expect(chips[1]).toHaveAttribute("aria-pressed", "true");
  },
};

// …and a supplier with no store was never restocked — said in words.
export const NoStoresMeansNoWarehouses: Story = {
  name: "No stores, none",
  render: () => <AtSinar />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(await canvas.findByTestId("supplier-warehouses-none")).toBeVisible();
  },
};
