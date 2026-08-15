import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { Marketplace } from "../gen/warehouse/marketplace/v1/marketplace_pb";
import { MarketplaceBadge, description } from "./MarketplaceBadge";

const meta = {
  title: "Components/MarketplaceBadge",
  component: MarketplaceBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { marketplace: Marketplace.SHOPEE },
} satisfies Meta<typeof MarketplaceBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shopee: Story = {};

export const Tokopedia: Story = { args: { marketplace: Marketplace.TOKOPEDIA } };

export const Compact: Story = { args: { marketplace: Marketplace.LAZADA, size: "sm" } };

// The whole point of the component: ONE place owns marketplace → colour, so a marketplace looks the
// same in every table, dropdown and detail panel. Seeing them together is how that mapping stays a
// decision rather than six independent guesses.
export const EveryMarketplace: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {[
        Marketplace.SHOPEE,
        Marketplace.TOKOPEDIA,
        Marketplace.LAZADA,
        Marketplace.TIKTOK,
        Marketplace.BLIBLI,
        Marketplace.BUKALAPAK,
      ].map((m) => (
        <MarketplaceBadge key={m} marketplace={m} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`marketplace-badge-${Marketplace.SHOPEE}`)).toHaveTextContent("Shopee");
    await expect(canvas.getByTestId(`marketplace-badge-${Marketplace.TIKTOK}`)).toHaveTextContent("TikTok");
  },
};

// An unrecognised marketplace must still render — gray and labelled, never a crash and never a
// borrowed colour that would read as a different storefront.
export const Unknown: Story = {
  args: { marketplace: Marketplace.UNSPECIFIED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`marketplace-badge-${Marketplace.UNSPECIFIED}`)).toBeInTheDocument();
  },
};
