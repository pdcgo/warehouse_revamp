import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { ChannelTypes, description } from "./ChannelTypes";

// A SUPPLIER'S STORES, AS BADGES — on the team's own list and on Discover's, read the same way.

const meta = {
  title: "Features/Suppliers/ChannelTypes",
  component: ChannelTypes,
  parameters: { docs: { description: { component: description } } },
  args: {
    channels: [
      { channelType: Marketplace.SHOPEE },
      { channelType: Marketplace.SHOPEE },
      { channelType: Marketplace.SHOPEE },
      { channelType: Marketplace.TOKOPEDIA },
    ],
  },
} satisfies Meta<typeof ChannelTypes>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One badge per TYPE, its count inside it when there is more than one store of it. */
export const OneBadgePerType: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Shopee")).toHaveLength(1);
    // The count is INSIDE its badge (a-store-count-sits-in-its-badge).
    await expect(canvas.getByTestId(`marketplace-badge-${Marketplace.SHOPEE}`)).toContainElement(canvas.getByText("×3"));
    await expect(canvas.getByText("Tokopedia")).toBeInTheDocument();
    await expect(canvas.queryByText("×1")).toBeNull();
  },
};

/** No live store — a stall-only supplier — reads a dash, not an empty cell. */
export const NoStore: Story = {
  args: { channels: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("—")).toBeInTheDocument();
  },
};
