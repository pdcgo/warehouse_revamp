import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { orderLabelScenario } from "../../../../.storybook/sessionScenario";
import { OrderLabelReason } from "../../../gen/warehouse/selling/v1/order_pb";
import { AtCancelled, FULL, ORDER_DETAIL_META, Routed, WAREHOUSE } from "./kit";

// ONE ORDER — Penerima and Pengiriman — the buyer's username under the customer, the order's own leg, and the shipping
// label: the seller opens it as its owner, the warehouse through the order.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Order/OrderDetailPage/Shipping",
  ...ORDER_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * THE BUYER'S USERNAME IS SHOWN UNDER THE CUSTOMER — and NOTHING when there is none
 * (the-buyers-username-is-optional). 101 carries one; 107 does not, and its recipient section draws no `—` row for it.
 */
export const TheBuyersUsernameShowsUnderTheCustomer: Story = {
  name: "Buyer username",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("order-detail-title")).toBeInTheDocument());
    await expect(canvas.getByTestId("order-detail-buyer-username")).toHaveTextContent(FULL.buyerUsername!);
  },
};

export const NoBuyersUsernameShowsNothing: Story = {
  name: "No buyer username",
  render: () => <AtCancelled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("section-recipient")).toBeInTheDocument());
    await expect(canvas.queryByTestId("order-detail-buyer-username")).not.toBeInTheDocument();
  },
};

/**
 * THE ORDER'S OWN LEG ONLY (the-return-leg-waits-for-tracking). There is no return shipment record, so
 * Pengiriman draws no return leg and Info no return resi. 108 is the fixture that once carried an
 * invented return, so it is the one that would show it if it came back.
 */
const AtOnceReturned = Routed("/orders/108");

export const OnlyTheOrderLegIsShown: Story = {
  name: "Order leg only",
  render: () => <AtOnceReturned />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("shipment-outbound")).toBeInTheDocument());

    await expect(canvas.queryByTestId("shipment-return")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("shipment-return-none")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("order-reference-return")).not.toBeInTheDocument();
  },
};

// ── The shipping label (a-warehouse-prints-the-labels-of-orders-it-ships) ─────────────────────────────────────────

// The SELLER opens its own label as the file's owner — GetDownloadUrl, never OrderLabels.
export const TheSellerOpensItsLabelAsTheOwner: Story = {
  name: "Seller opens its label",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(await canvas.findByTestId("order-receipt-open", {}, { timeout: 3000 }));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(`https://example.invalid/proof/${FULL.receipt!.documentId}`, "_blank", "noopener,noreferrer"),
    );
    await expect(orderLabelScenario.last).toBeUndefined();
    open.mockRestore();
  },
};

// THE WAREHOUSE THAT SHIPS IT opens the seller's label through the ORDER — OrderLabels, scoped to the warehouse. As the
// document's owner it would be NotFound: the label is the seller's, and nothing is shared.
export const TheWarehouseOpensTheLabelThroughTheOrder: Story = {
  name: "Warehouse opens the label",
  beforeEach: asTeam(WAREHOUSE.id),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(await canvas.findByTestId("order-receipt-open", {}, { timeout: 3000 }));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(`https://example.invalid/label/${FULL.receipt!.documentId}`, "_blank", "noopener,noreferrer"),
    );
    await expect(orderLabelScenario.last).toEqual({ teamId: WAREHOUSE.id, orderIds: [FULL.id] });
    open.mockRestore();
  },
};

// A refused label says WHY, and opens nothing — here, the seller has not attached one the server can find.
export const AWarehouseLabelRefusalSaysWhy: Story = {
  name: "Label refused",
  beforeEach: () => {
    asTeam(WAREHOUSE.id)();
    orderLabelScenario.refusal = OrderLabelReason.NO_LABEL;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    await userEvent.click(await canvas.findByTestId("order-receipt-open", {}, { timeout: 3000 }));

    // The toast animates in: wait for it to SHOW, not only to be in the document (a bare toBeVisible right after
    // findByText caught it mid-animation whenever the stories before it ran a little longer).
    const refusal = await screen.findByText(`Order #${FULL.id} has no label attached yet — ask the seller to attach it`);
    await waitFor(() => expect(refusal).toBeVisible());
    await expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  },
};
