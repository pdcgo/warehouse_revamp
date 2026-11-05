import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { receiptUpdateScenario } from "../../../../.storybook/sessionScenario";
import { AtCancelled, FULL, ORDER_DETAIL_META, WAREHOUSE } from "./kit";

// ONE ORDER — the header's actions — no Cancel on a cancelled order, and Edit Resi.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/Actions",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A CANCELLED ORDER CANNOT BE CANCELLED AGAIN.
 *
 * Cancel is offered only while the goods are still in the building (PLACED or CONFIRMED). On a
 * terminal order the button is ABSENT rather than disabled — there is no action left to explain.
 */
export const CancelledOrderHasNoCancelButton: Story = {
  name: "Cancelled, no Cancel",
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());

    // An end state offers NOTHING: no cancel, and no action bar drawn empty or disabled.
    await expect(canvas.queryByTestId("order-action-cancel")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("order-action-bar")).not.toBeInTheDocument();
  },
};

// EDIT RESI IS REAL (the-seller-edits-the-resi-until-handover): the seller's button opens the dialog on the order's own
// number and file, and Save sends only what changed — here the number, so the file is left as it is.
export const EditResiSendsOnlyTheNumber: Story = {
  name: "Edit resi",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-action-editReceipt"));

    const dialog = await screen.findByTestId("edit-receipt-dialog");
    const code = await within(dialog).findByTestId("edit-receipt-code");
    await expect(code).toHaveValue(FULL.receiptCode);
    await expect(within(dialog).getByTestId("order-receipt-attached")).toHaveTextContent(FULL.receipt!.filename);
    // Nothing changed yet, so there is nothing to save.
    await expect(within(dialog).getByTestId("edit-receipt-save")).toBeDisabled();

    await userEvent.clear(code);
    await userEvent.type(code, "JNE-NEW-01", { delay: 40 });
    await userEvent.click(within(dialog).getByTestId("edit-receipt-save"));

    await waitFor(() => expect(screen.queryByTestId("edit-receipt-dialog")).not.toBeInTheDocument());
    await expect(receiptUpdateScenario.last).toEqual({ orderId: FULL.id, receiptCode: "JNE-NEW-01", documentId: undefined });
  },
};

// The warehouse reads the same pending order and is offered no Edit Resi: the number is on the seller's label.
export const TheWarehouseHasNoEditResi: Story = {
  name: "Warehouse, no Edit resi",
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-action-editReceipt")).not.toBeInTheDocument();
  },
};
