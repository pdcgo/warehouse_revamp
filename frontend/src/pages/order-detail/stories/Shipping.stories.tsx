import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { AtCancelled, FULL, ORDER_DETAIL_META, Routed } from "./kit";

// ONE ORDER — Penerima and Pengiriman — the buyer's username under the customer, and the order's own leg.
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
