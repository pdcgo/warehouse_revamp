import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { reportScenario } from "../../../../.storybook/foundRequestStub";
import { asTeam } from "../../../../.storybook/pageStory";
import { receiptUpdateScenario, withOrderStatus } from "../../../../.storybook/sessionScenario";
import { toaster } from "../../../components/feedback/Toaster";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { AtCancelled, FULL, ORDER_DETAIL_META, Routed, SELLER, WAREHOUSE } from "./kit";

// ONE ORDER — the header's actions — no Cancel on a cancelled order, Edit Resi, and the warehouse's Force Return.
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

/**
 * THE WAREHOUSE FORCES A RETURN FROM ITS ORDER DETAIL (a-return-is-received-by-search-then-forced, A) — 106 read as
 * completed: the buyer sent it back after delivery. Force Return confirms, the order re-reads in `return`, and Accept
 * Return is offered on the same header — opening the accept page.
 */
const AtCompleted = Routed("/orders/106");

export const WarehouseForcesAReturn: Story = {
  name: "Warehouse forces a return",
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    withOrderStatus(106n, OrderStatus.COMPLETED)();
  },
  render: () => <AtCompleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByTestId("order-accept-return")).toBeNull();
    await userEvent.click(await canvas.findByTestId("order-force-return"));

    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await expect(screen.getByText('Order #106 is "Completed". Mark it as returned so you can accept it?')).toBeInTheDocument();
    await userEvent.click(confirm);

    await waitFor(() => expect(canvas.getByTestId("order-accept-return")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-force-return")).toBeNull();

    await userEvent.click(canvas.getByTestId("order-accept-return"));
    await waitFor(() => expect(canvas.getByTestId("at-return-accept")).toBeInTheDocument());
  },
};

/**
 * A LOST ORDER'S PARCEL TURNED UP AT THE WAREHOUSE (a-found-lost-parcel-is-a-found-stock-in). Order #106 (1 Beras) is
 * lost; Gudang Pusat reports its parcel found from the order's page: the product is the order's one line, at most the 1
 * it took, the rack is picked. The request names the order, the order's notes name the request — and the order stays
 * lost. A second report of the same unit is refused by the server (more than the order took), said in the dialog.
 */
export const WarehouseReportsALostOrdersParcelFound: Story = {
  name: "Warehouse reports a lost order's parcel found",
  beforeEach: () => {
    toaster.remove();
    asTeam(WAREHOUSE.id)();
    withOrderStatus(106n, OrderStatus.LOST)();
  },
  render: () => <AtCompleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(await canvas.findByTestId("order-report-found"));
    const box = await screen.findByTestId("report-found-order-dialog");
    await waitFor(() => expect(box).toBeVisible());
    const dialog = within(box);
    await expect(box).toHaveTextContent("Report Found from Order #106");
    await expect(dialog.getByTestId("report-found-order-product")).toHaveTextContent("SKU-BERAS-5K");
    await expect(dialog.getByTestId("report-found-order-amount-help")).toHaveTextContent("At most 1 — what the order took.");
    // No rack, nothing to send.
    await expect(dialog.getByTestId("report-found-order-submit")).toBeDisabled();

    await userEvent.click(dialog.getByTestId("report-found-order-rack"));
    await userEvent.click(await screen.findByTestId("rack-select-option-43"));
    await userEvent.click(dialog.getByTestId("report-found-order-submit"));

    await expect(await screen.findByText("1 × SKU-BERAS-5K sent for approval")).toBeInTheDocument();
    await expect(reportScenario.last).toEqual({ productId: 74n, rackId: 43n, quantity: 1n, note: "", orderId: 106n });

    // THE ORDER'S NOTES NAME THE REQUEST; THE ORDER STAYS LOST.
    const notes = await canvas.findByTestId("order-detail-notes");
    await waitFor(() => expect(notes).toHaveTextContent("found request #400"));
    await expect(canvas.getByTestId(`order-status-${OrderStatus.LOST}`)).toBeInTheDocument();

    // The same unit twice is more than the order took — the server says so.
    await userEvent.click(canvas.getByTestId("order-report-found"));
    const again = within(await screen.findByTestId("report-found-order-dialog"));
    await userEvent.click(again.getByTestId("report-found-order-rack"));
    await userEvent.click(await screen.findByTestId("rack-select-option-43"));
    await userEvent.click(again.getByTestId("report-found-order-submit"));
    await expect(await again.findByTestId("report-found-order-error")).toHaveTextContent(
      "more units than the lost order took",
    );
  },
};

// Report Found is the WAREHOUSE's, and only for a LOST order: the seller reading the same lost order is not offered it,
// and the warehouse reading it still on its way is not either.
export const OnlyTheWarehouseReportsALostOrderFound: Story = {
  name: "Only the warehouse reports a lost order found",
  beforeEach: () => {
    asTeam(SELLER.id)();
    withOrderStatus(106n, OrderStatus.LOST)();
  },
  render: () => <AtCompleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`order-status-${OrderStatus.LOST}`);
    await expect(canvas.queryByTestId("order-report-found")).toBeNull();
  },
};

export const NoReportFoundBeforeTheOrderIsLost: Story = {
  name: "No Report Found before the order is lost",
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    withOrderStatus(106n, OrderStatus.SHIPPED)();
  },
  render: () => <AtCompleted />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId(`order-status-${OrderStatus.SHIPPED}`);
    await expect(canvas.queryByTestId("order-report-found")).toBeNull();
  },
};
