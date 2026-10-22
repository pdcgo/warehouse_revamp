import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { HStack } from "@chakra-ui/react";

import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { ORDER_STATUSES, OrderStatusBadge, description } from "./OrderStatusBadge";

const meta = {
  title: "Components/Badges/OrderStatusBadge",
  component: OrderStatusBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { status: OrderStatus.PENDING },
} satisfies Meta<typeof OrderStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};

export const Processed: Story = { args: { status: OrderStatus.PROCESSED } };

export const Cancel: Story = { args: { status: OrderStatus.CANCEL } };

// Every status side by side, in the status diagram's order — the view that makes the palette decision
// reviewable. Processed and picked SHARE sky on purpose (both inside the building) and shipping is cyan
// (handed over), and problem and lost share purple — all the owner's calls, which only read as deliberate
// when you can see them next to each other.
export const AllStatuses: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {ORDER_STATUSES.map((meta) => (
        <OrderStatusBadge key={meta.status} status={meta.status} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The badge is keyed by status, so this also proves each status renders a DISTINCT node rather
    // than eleven copies of the default branch.
    await expect(canvas.getByTestId(`order-status-${OrderStatus.PENDING}`)).toHaveTextContent("Pending");
    await expect(canvas.getByTestId(`order-status-${OrderStatus.SHIPPING}`)).toHaveTextContent("Handed over");
    await expect(canvas.getByTestId(`order-status-${OrderStatus.RETURN_COMPLETED}`)).toHaveTextContent("Return received");
    await expect(canvas.getByTestId(`order-status-${OrderStatus.CANCEL}`)).toHaveTextContent("Cancelled");
  },
};

/**
 * A SCREEN'S OWN NAME, THE STATUS'S COLOUR — the warehouse calls PENDING "To confirm" because its tab does;
 * the badge must say the same word as the tab above the row, and still be amber.
 */
export const ALabelReplacesTheNameNotTheColour: Story = {
  args: { status: OrderStatus.PENDING, label: "To confirm" },
  play: async ({ canvasElement }) => {
    const badge = canvasElement.querySelector(`[data-testid="order-status-${OrderStatus.PENDING}"]`) as HTMLElement;

    await expect(badge).toHaveTextContent("To confirm");
    await expect(badge).not.toHaveTextContent("Pending");
  },
};
