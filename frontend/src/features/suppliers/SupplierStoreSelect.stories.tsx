import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { SupplierChannelRecord } from "./adapt";
import { SupplierStoreSelect, description } from "./SupplierStoreSelect";

// The Produk tab's store filter — one of a supplier's stores, searched by name or type.

const store = (id: number, channelType: Marketplace, name: string): SupplierChannelRecord => ({
  id: BigInt(id),
  supplierId: 1n,
  channelType,
  name,
  uri: "",
  description: "",
});

const STORES = [
  store(1, Marketplace.SHOPEE, "Sumber Makmur Official"),
  store(2, Marketplace.TOKOPEDIA, "Sumber Makmur Store"),
  store(3, Marketplace.OTHER, "sumbermakmur.co.id"),
];

// Real state, so a pick shows in the field and a clear empties it.
function Controlled({ stores }: { stores: SupplierChannelRecord[] }) {
  const [value, setValue] = useState(0n);

  return (
    <>
      <SupplierStoreSelect stores={stores} value={value} onChange={setValue} placeholder="Every store" />
      <output data-testid="picked">{value.toString()}</output>
    </>
  );
}

const meta = {
  title: "Features/Suppliers/SupplierStoreSelect",
  component: Controlled,
  args: { stores: STORES },
  parameters: { docs: { description: { component: description } } },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// Each option is the store as it reads in the tables — its name, its type's badge UNDER it.
export const AnOptionIsANameThenItsBadge: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-store-select"));

    const option = await canvas.findByTestId("supplier-store-select-option-2");
    await waitFor(() => expect(option).toBeVisible());
    const badge = within(option).getByTestId(/^marketplace-badge-/);
    await expect(badge).toHaveTextContent("Tokopedia");
    await expect(badge.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      within(option).getByText("Sumber Makmur Store").getBoundingClientRect().bottom,
    );
  },
};

// Typed by its TYPE — "the Shopee one" finds the Shopee store.
export const SearchesByType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByTestId("supplier-store-select"), "shopee", { delay: 30 });

    await waitFor(() => expect(canvas.getAllByRole("option")).toHaveLength(1));
    await expect(canvas.getByRole("option")).toHaveTextContent("Sumber Makmur Official");
  },
};

// A pick emits the store's id; clearing emits 0n — every store — never nothing (#131).
export const ClearingEmitsNone: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("supplier-store-select"));
    const option = await canvas.findByTestId("supplier-store-select-option-3");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("3"));

    await userEvent.click(canvas.getByRole("button", { name: /clear/i }));
    await waitFor(() => expect(canvas.getByTestId("picked")).toHaveTextContent("0"));
  },
};
