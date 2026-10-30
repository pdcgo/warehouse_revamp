import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SupplierWarehouseFilter, description } from "./SupplierWarehouseFilter";

// THE WAREHOUSE FILTER — on the supplier list and on Discover alike (the-warehouse-filters-before-the-team).

function Controlled({ initial = 0n }: { initial?: bigint }) {
  const [warehouseId, setWarehouseId] = useState(initial);
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

/** A picked warehouse reads as its name alone — every option is a warehouse, so a [Warehouse] badge says nothing
 * (the-warehouse-filter-shows-its-name-alone); its × clears it back to every warehouse. */
export const ThePickIsItsNameAlone: Story = {
  args: { initial: 11n },
  play: async ({ canvasElement }) => {
    const slot = within(canvasElement).getByTestId("supplier-warehouse-filter");
    const shown = await within(slot).findByTestId("team-select-selected");
    await expect(shown).toHaveTextContent(/^Gudang Pusat$/);
    await expect(within(shown).queryByText("Warehouse")).toBeNull();

    await userEvent.click(within(slot).getByRole("button", { name: /clear/i }));
    await waitFor(() => expect(within(slot).queryByTestId("team-select-selected")).toBeNull());
    await expect(within(slot).getByRole("combobox")).toHaveAttribute("placeholder", "All warehouses");
  },
};
