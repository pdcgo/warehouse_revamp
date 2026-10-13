import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { SupplierWarehouseFilter, description } from "./SupplierWarehouseFilter";

// THE WAREHOUSE FILTER — on the supplier list and on Discover alike (the-warehouse-filters-before-the-team).

function Controlled() {
  const [warehouseId, setWarehouseId] = useState(0n);
  return <SupplierWarehouseFilter value={warehouseId} onChange={setWarehouseId} />;
}

const meta = {
  title: "Features/Suppliers/SupplierWarehouseFilter",
  component: Controlled,
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The warehouse search select, "All warehouses" when none is picked, its ⚠ mark beside it inside the slot. */
export const MarkedNotWired: Story = {
  play: async ({ canvasElement }) => {
    const slot = within(canvasElement).getByTestId("supplier-warehouse-filter");
    await expect(within(slot).getByRole("combobox")).toHaveAttribute("placeholder", "All warehouses");
    await expect(within(slot).getByTestId("not-implemented-warehouse")).toHaveTextContent("5");
  },
};
