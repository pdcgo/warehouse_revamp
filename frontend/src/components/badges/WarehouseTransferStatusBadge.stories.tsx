import type { Meta, StoryObj } from "@storybook/react-vite";
import { HStack } from "@chakra-ui/react";
import { expect, within } from "storybook/test";

import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferStatusBadge, description } from "./WarehouseTransferStatusBadge";

const meta = {
  title: "Components/Badges/WarehouseTransferStatusBadge",
  component: WarehouseTransferStatusBadge,
  parameters: {
    docs: { description: { component: description } },
  },
  args: { status: WarehouseTransferStatus.CREATED },
} satisfies Meta<typeof WarehouseTransferStatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Created: Story = {};

export const Process: Story = { args: { status: WarehouseTransferStatus.PROCESS } };

export const Shipped: Story = { args: { status: WarehouseTransferStatus.SHIPPED } };

export const Arrived: Story = { args: { status: WarehouseTransferStatus.ARRIVED } };

export const Accepted: Story = { args: { status: WarehouseTransferStatus.ACCEPTED } };

export const Lost: Story = { args: { status: WarehouseTransferStatus.LOST } };

export const Cancelled: Story = { args: { status: WarehouseTransferStatus.CANCELLED } };

const JOURNEY = [
  WarehouseTransferStatus.CREATED,
  WarehouseTransferStatus.PROCESS,
  WarehouseTransferStatus.SHIPPED,
  WarehouseTransferStatus.ARRIVED,
  WarehouseTransferStatus.ACCEPTED,
  WarehouseTransferStatus.LOST,
  WarehouseTransferStatus.CANCELLED,
];

// The seven steps side by side, in the order a transfer lives them — reviewing them together keeps the colours a set.
export const AllStatuses: Story = {
  render: () => (
    <HStack gap="2" wrap="wrap">
      {JOURNEY.map((s) => (
        <WarehouseTransferStatusBadge key={s} status={s} />
      ))}
    </HStack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId(`transfer-status-${WarehouseTransferStatus.PROCESS}`)).toHaveTextContent(
      /process/i,
    );
    await expect(canvas.getByTestId(`transfer-status-${WarehouseTransferStatus.SHIPPED}`)).toHaveTextContent(
      /shipped/i,
    );

    // Real words, not keys — a missing catalogue entry renders "warehouseTransfer.status.…".
    for (const s of JOURNEY) {
      await expect(canvas.getByTestId(`transfer-status-${s}`)).not.toHaveTextContent("warehouseTransfer.status");
    }
  },
};
