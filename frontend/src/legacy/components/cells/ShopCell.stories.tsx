import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ShopCell, description } from "./ShopCell";

const meta = {
  title: "Legacy/Components/Cells/ShopCell",
  component: ShopCell,
  parameters: { docs: { description: { component: description } } },
  args: {
    shop: { id: 44n, name: "Toko Jaya Abadi", username: "jayaabadi", marketplace: Marketplace.SHOPEE },
  },
} satisfies Meta<typeof ShopCell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("entity-cell-name")).toHaveTextContent("Toko Jaya Abadi");
    await expect(canvas.queryByTestId("shop-deleted")).toBeNull();
  },
};

// ⚠ THE CASE THIS CELL EXISTS FOR. Shops are removed on the marketplace side while their orders,
// settlements and payouts stay in this system forever. Without the marker the row looks live, and
// somebody spends ten minutes trying to reconcile against a storefront that has not existed for
// months.
export const DeletedShopIsMarked: Story = {
  args: {
    shop: {
      id: 44n,
      name: "Toko Lama",
      username: "tokolama",
      marketplace: Marketplace.TOKOPEDIA,
      deletedAt: 1_760_000_000n,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("shop-deleted")).toBeVisible();
  },
};

export const Unresolved: Story = { args: { shop: undefined, shopId: 44n } };
