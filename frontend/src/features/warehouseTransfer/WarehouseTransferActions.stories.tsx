import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { WarehouseTransferActions } from "./WarehouseTransferActions";
import { STORY_PENDING, storyTransfer } from "./storyTransfer";

// WHAT A WAREHOUSE MAY DO, by status AND by which end it is (the-team-opens-the-sender-ships-the-receiver-accepts):
// A processes and ships; B signs and accepts. The same transfer offers different acts to its two warehouses.
const meta = {
  title: "Features/WarehouseTransfer/WarehouseTransferActions",
  component: WarehouseTransferActions,
  parameters: { signedIn: true },
  args: { teamId: 11n, variant: "buttons", pending: STORY_PENDING, transfer: storyTransfer(601n) },
} satisfies Meta<typeof WarehouseTransferActions>;

export default meta;
type Story = StoryObj<typeof meta>;

// Gudang Pusat is A for 601: it may process it.
export const SenderProcesses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-process-601")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-action-accept-601")).toBeNull();
  },
};

// …and Gudang Cabang, B for the same transfer, may do nothing until it ships.
export const ReceiverWaitsUntilShipped: Story = {
  args: { teamId: 14n },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId(/transfer-action-/)).toBeNull();
  },
};

export const SenderShips: Story = {
  args: { transfer: storyTransfer(602n) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("transfer-action-ship-602")).toBeInTheDocument();
  },
};

// Shipped: B may sign for the box, or open it and count it at once.
export const ReceiverSignsOrAccepts: Story = {
  args: { teamId: 14n, transfer: storyTransfer(603n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-arrive-603")).toBeInTheDocument();
    await expect(canvas.getByTestId("transfer-action-accept-603")).toBeInTheDocument();
  },
};

// A lost box that turns up is signed for — never accepted straight from lost.
export const ALostBoxIsSignedFor: Story = {
  args: { teamId: 14n, transfer: storyTransfer(607n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-arrive-607")).toBeInTheDocument();
    await expect(canvas.queryByTestId("transfer-action-accept-607")).toBeNull();
  },
};

export const AsARow: Story = { args: { variant: "row", transfer: storyTransfer(602n) } };

// Shipping records the label (the-sender-enters-the-courier-at-ship) and moves the transfer on.
export const ShipRecordsTheLabel: Story = {
  args: { transfer: storyTransfer(602n) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("transfer-action-ship-602"));
    await userEvent.type(await screen.findByTestId("transfer-ship-tracking"), "JNE5566", { delay: 20 });
    // The label photo is uploaded nowhere until its type is designed — the field says so.
    await expect(screen.getByTestId("not-implemented-labelPhoto")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(transferWire(602n).status).toBe(WarehouseTransferStatus.SHIPPED));
    await expect(transferWire(602n).receipt).toBe("JNE5566");
  },
};
