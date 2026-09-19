import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ShopText, description } from "./ShopText";

const meta = {
  title: "Legacy/Components/Text/ShopText",
  component: ShopText,
  parameters: { docs: { description: { component: description } } },
  args: { name: "Toko Jaya Abadi", marketplace: Marketplace.SHOPEE },
} satisfies Meta<typeof ShopText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("shop-text")).toHaveTextContent("Toko Jaya Abadi");
  },
};

export const WithDescription: Story = { args: { desc: "acct 88213 · active since Mar 2026" } };

// THE case the component exists for: one team, two storefronts, the same name. Name alone is
// ambiguous exactly where it matters — an order row, a settlement line, a payout — and the badge is
// what makes the pair unique.
export const SameNameDifferentMarketplace: Story = {
  render: () => (
    <Stack gap="3">
      <ShopText name="Toko Jaya Abadi" marketplace={Marketplace.SHOPEE} />
      <ShopText name="Toko Jaya Abadi" marketplace={Marketplace.TOKOPEDIA} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`marketplace-badge-${Marketplace.SHOPEE}`)).toBeVisible();
    await expect(canvas.getByTestId(`marketplace-badge-${Marketplace.TOKOPEDIA}`)).toBeVisible();
  },
};

// No marketplace: the badge is omitted rather than rendered as "Unspecified", which would read as a
// storefront called Unspecified.
export const NoMarketplace: Story = {
  args: { marketplace: Marketplace.UNSPECIFIED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId(`marketplace-badge-${Marketplace.UNSPECIFIED}`)).toBeNull();
  },
};

export const NoName: Story = { args: { name: undefined } };
