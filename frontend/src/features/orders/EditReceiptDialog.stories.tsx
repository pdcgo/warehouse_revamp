import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor } from "storybook/test";

import { orderDetailFor } from "../../../.storybook/fixtures";
import { receiptUpdateScenario } from "../../../.storybook/sessionScenario";
import { EditReceiptDialog, description } from "./EditReceiptDialog";

// EDIT RESI (the-seller-edits-the-resi-until-handover) — opened from the order list's kebab and the detail page's
// buttons alike, so its rules are pinned once here.
//
// The rules: it opens on the ORDER's own number and file, read fresh; Save stays off until something differs; and only
// what differs is sent — the number and the file are edited on their own (owner: *"we can edit receipt text or receipt
// file only"*), so replacing one never rewrites the other.

// 101 is Toko Melati's pending order, with a tracking number and a label file.
const ORDER = orderDetailFor(101n)!;

function Open() {
  const [open, setOpen] = useState(true);

  return <EditReceiptDialog open={open} onOpenChange={setOpen} teamId={ORDER.teamId} orderId={ORDER.id} />;
}

const meta = {
  title: "Features/Orders/EditReceiptDialog",
  component: EditReceiptDialog,
  parameters: { docs: { description: { component: description } } },
  render: () => <Open />,
} satisfies Meta<typeof EditReceiptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// The order's own number and file, and nothing to save until one of them changes.
export const OpensOnTheOrdersValues: Story = {
  args: { open: true, onOpenChange: () => {}, teamId: ORDER.teamId, orderId: ORDER.id },
  play: async () => {
    await expect(await screen.findByTestId("edit-receipt-code")).toHaveValue(ORDER.receiptCode);
    await expect(screen.getByTestId("order-receipt-attached")).toHaveTextContent(ORDER.receipt!.filename);
    await expect(screen.getByTestId("edit-receipt-save")).toBeDisabled();
  },
};

// Removing the file sends the file alone — an empty document — and leaves the number out of the request.
export const RemovingTheFileSendsOnlyTheFile: Story = {
  args: OpensOnTheOrdersValues.args,
  play: async () => {
    await userEvent.click(await screen.findByTestId("order-receipt-remove"));
    await userEvent.click(screen.getByTestId("edit-receipt-save"));

    await waitFor(() => expect(screen.queryByTestId("edit-receipt-dialog")).not.toBeInTheDocument());
    await expect(receiptUpdateScenario.last).toEqual({ orderId: ORDER.id, receiptCode: undefined, documentId: "" });
  },
};

// A number typed back to what it was is no change: spaces around it do not count, and Save goes off again.
export const TheSameNumberIsNoChange: Story = {
  args: OpensOnTheOrdersValues.args,
  play: async () => {
    const code = await screen.findByTestId("edit-receipt-code");

    await userEvent.type(code, "X", { delay: 40 });
    await expect(screen.getByTestId("edit-receipt-save")).toBeEnabled();

    await userEvent.clear(code);
    await userEvent.type(code, ` ${ORDER.receiptCode} `, { delay: 20 });
    await expect(screen.getByTestId("edit-receipt-save")).toBeDisabled();
  },
};
