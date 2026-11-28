import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { transferWire } from "../../../.storybook/warehouseTransferStub";
import { WarehouseTransferActions } from "./WarehouseTransferActions";
import { storyTransfer } from "./storyTransfer";

// WHAT A WAREHOUSE MAY DO, by status AND by which end it is (the-team-opens-the-sender-ships-the-receiver-accepts):
// A processes and ships; B signs and accepts. The same transfer offers different acts to its two warehouses.
const meta = {
  title: "Features/WarehouseTransfer/WarehouseTransferActions",
  component: WarehouseTransferActions,
  parameters: { signedIn: true },
  args: { teamId: 11n, variant: "buttons", transfer: storyTransfer(601n) },
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

// THE ARRIVAL IS SET ARRIVED (an-arrival-is-set-arrived): B's button, the dialog's title and its confirm say Set Arrived,
// and the toast says the box was set arrived — never "sign for".
export const SetArrivedIsTheArrivalsName: Story = {
  args: { teamId: 14n, transfer: storyTransfer(603n) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTestId("transfer-action-arrive-603")).toHaveTextContent("Set Arrived");
    await userEvent.click(canvas.getByTestId("transfer-action-arrive-603"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByRole("alertdialog")).toHaveTextContent("Set Arrived — Transfer #603");
    await expect(confirm).toHaveTextContent("Set Arrived");
    await userEvent.click(confirm);

    await waitFor(() => expect(transferWire(603n).status).toBe(WarehouseTransferStatus.ARRIVED));
    await waitFor(() => expect(screen.getByText("Box set arrived")).toBeVisible(), { timeout: 5000 });
  },
};

// …and in Indonesian it is TANDAI TIBA — the transfer's old *Terima Paket* read as the accept (*Terima*): the button, the
// lost box's dialog and its message all say *tandai tiba*.
export const TandaiTibaInIndonesian: Story = {
  args: { teamId: 14n, transfer: storyTransfer(607n) },
  globals: { locale: "id" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("transfer-action-arrive-607")).toHaveTextContent("Tandai Tiba"));
    await userEvent.click(canvas.getByTestId("transfer-action-arrive-607"));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    const dialog = screen.getByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Tandai Tiba Transfer #607");
    await expect(dialog).toHaveTextContent("Menandainya tiba mencatat bahwa paket ternyata sampai.");
    await expect(dialog).not.toHaveTextContent(/Terima Paket/);
    await expect(confirm).toHaveTextContent("Tandai Tiba");
  },
};

export const AsARow: Story = { args: { variant: "row", transfer: storyTransfer(602n) } };

// Shipping records the label (the-sender-enters-the-courier-at-ship) and moves the transfer on.
export const ShipRecordsTheLabel: Story = {
  args: { transfer: storyTransfer(602n) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("transfer-action-ship-602"));
    await userEvent.type(await screen.findByTestId("transfer-ship-tracking"), "JNE5566", { delay: 20 });
    // The label photo uploads (ReceiptUpload) and is saved as the transfer's receipt_file — no pending mark.
    await expect(screen.getByTestId("transfer-ship-label")).toBeInTheDocument();
    await expect(screen.queryByTestId("not-implemented-labelPhoto")).toBeNull();
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(transferWire(602n).status).toBe(WarehouseTransferStatus.SHIPPED));
    await expect(transferWire(602n).receipt).toBe("JNE5566");
  },
};
