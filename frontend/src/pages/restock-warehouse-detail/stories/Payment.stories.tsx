import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { At503, WAREHOUSE_DETAIL_META, loaded } from "./kit";

// RESTOCK WAREHOUSE DETAIL — the ongkir this warehouse paid at the door, a fact in Kiriman, and its slip.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouseDetail/Payment",
  ...WAREHOUSE_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// THE ONGKIR THIS WAREHOUSE PAID (owner: *"ongkirnya yang dibayar gudang … dibayar selling kita tidak perlu tahu"*,
// the-warehouse-sees-the-ongkir-it-paid) — 503's 5.000, its note, owed back by the selling team: a fact in Kiriman, after
// the courier, not a section of its own. No restock total, and not the selling team's own ongkir.
export const TheCouriersChargeIsOwedBack: Story = {
  name: "Courier's charge owed back",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const delivery = canvas.getByTestId("restock-detail-info");

    await expect(canvas.queryByTestId("restock-detail-total")).toBeNull();
    await expect(canvas.queryByTestId("restock-detail-shipping")).toBeNull();
    await expect(canvas.queryByTestId("restock-detail-courier-charge-card")).toBeNull();
    await expect(within(delivery).getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 5.000");
    await expect(within(delivery).getByTestId("restock-detail-courier-charge-note")).toHaveTextContent("Ongkos bongkar di gudang");
  },
};

// …and before the box is counted there is none on the restock yet — the fact reads "—".
export const BeforeTheCountTheOngkirIsADash: Story = {
  name: "Ongkir · not yet",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(within(canvas.getByTestId("restock-detail-info")).getByText("Courier COD")).toBeVisible();
    await expect(canvas.queryByTestId("restock-detail-courier-charge")).toBeNull();
  },
};

// THE COURIER'S SLIP (the-detail-pages-show-the-slip-and-the-broken-rack) — under the charge's note, opening whole. A
// SAMPLE, the page's fourth mark — its Ongkir COD sits with the info, after Produk.
export const TheSlipIsShownWithTheCharge: Story = {
  name: "Slip photo",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const slip = canvas.getByTestId("restock-detail-courier-photo");

    await expect(within(slip).getByTestId("not-implemented-courierPhoto")).toHaveTextContent("4");
    await userEvent.click(within(slip).getByTestId("restock-detail-courier-photo-open"));
    const whole = await screen.findByTestId("restock-detail-courier-photo-dialog");
    await waitFor(() => expect(whole).toBeVisible());
  },
};
