import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { HStack } from "@chakra-ui/react";

import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge, description } from "./OrderStatusBadge";

const meta = {
  title: "Components/OrderStatusBadge",
  component: OrderStatusBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { status: OrderStatus.PLACED },
} satisfies Meta<typeof OrderStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placed: Story = {};

export const Confirmed: Story = { args: { status: OrderStatus.CONFIRMED } };

export const Cancelled: Story = { args: { status: OrderStatus.CANCELLED } };

// Every status side by side — the view that makes the palette decision reviewable. Picking and
// Packed SHARE orange on purpose (they are consecutive steps of one journey through the building),
// which only reads as deliberate when you can see them next to each other.
export const AllStatuses: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {[
        OrderStatus.PLACED,
        OrderStatus.CONFIRMED,
        OrderStatus.PICKING,
        OrderStatus.PACKED,
        OrderStatus.SHIPPED,
        OrderStatus.CANCELLED,
      ].map((status) => (
        <OrderStatusBadge key={status} status={status} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The badge is keyed by status, so this also proves each status renders a DISTINCT node rather
    // than six copies of the default branch.
    await expect(canvas.getByTestId(`order-status-${OrderStatus.PLACED}`)).toHaveTextContent("Placed");
    await expect(canvas.getByTestId(`order-status-${OrderStatus.SHIPPED}`)).toHaveTextContent("Shipped");
    await expect(canvas.getByTestId(`order-status-${OrderStatus.CANCELLED}`)).toHaveTextContent("Cancelled");
  },
};
