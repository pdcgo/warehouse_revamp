import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockStatusBadge, description } from "./RestockStatusBadge";

const meta = {
  title: "Components/Badges/RestockStatusBadge",
  component: RestockStatusBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { status: RestockRequestStatus.ONGOING },
} satisfies Meta<typeof RestockStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ongoing: Story = {};

export const Arrived: Story = { args: { status: RestockRequestStatus.ARRIVED } };

export const Accepted: Story = { args: { status: RestockRequestStatus.ACCEPTED } };

export const Lost: Story = { args: { status: RestockRequestStatus.LOST } };

export const Cancelled: Story = { args: { status: RestockRequestStatus.CANCELLED } };

const JOURNEY = [
  RestockRequestStatus.ONGOING,
  RestockRequestStatus.ARRIVED,
  RestockRequestStatus.ACCEPTED,
  RestockRequestStatus.LOST,
  RestockRequestStatus.CANCELLED,
];

// The five steps side by side, in the order a restock lives them — reviewing them together is what keeps the colours a
// set rather than five separate choices.
export const AllStatuses: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {JOURNEY.map((s) => (
        <RestockStatusBadge key={s} status={s} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Real words, not keys — a missing catalogue entry renders "restock.status.…", which this catches.
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ONGOING}`)).toHaveTextContent(/ongoing/i);
    await expect(canvas.getByTestId(`restock-status-${RestockRequestStatus.ARRIVED}`)).toHaveTextContent(/arrived/i);

    for (const s of JOURNEY) {
      await expect(canvas.getByTestId(`restock-status-${s}`)).not.toHaveTextContent("restock.status");
    }
  },
};
