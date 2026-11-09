import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { At503, SELLING_DETAIL_META, loaded } from "./kit";

// RESTOCK SELLING DETAIL — the money — the receipt, the parcel and the paying account, and the courier's charge on its own.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockSellingDetail/Payment",
  ...SELLING_DETAIL_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// the-couriers-charge-stays-out-of-total — 503's total is goods 950.000 + shipping 30.000; the courier's 5.000 shows on
// its own, with its note, as owed to the warehouse (the-warehouse-cost-is-the-couriers-charge-at-the-door).
export const TheTotalLeavesOutTheCouriersCharge: Story = {
  name: "Total leaves out the charge",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-subtotal")).toHaveTextContent("Rp 950.000");
    await expect(canvas.getByTestId("restock-detail-shipping")).toHaveTextContent("Rp 30.000");
    await expect(canvas.getByTestId("restock-detail-total")).toHaveTextContent("Rp 980.000");

    await expect(canvas.getByTestId("restock-detail-courier-charge")).toHaveTextContent("Rp 5.000");
    await expect(canvas.getByTestId("restock-detail-courier-charge-note")).toHaveTextContent("Ongkos bongkar di gudang");
  },
};

// Before it is accepted there is no charge to owe, so the card is not there at all.
export const NoCouriersChargeBeforeAccept: Story = {
  name: "No charge before accept",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-total")).toHaveTextContent("Rp 2.080.000");
    await expect(canvas.queryByTestId("restock-detail-courier-charge-card")).toBeNull();
  },
};

// The parcel and the payment: the courier by its shipment channel, the tracking number with a photo of the label, the
// paying account by name, the invoice.
export const TheParcelAndThePayment: Story = {
  name: "Parcel and payment",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("restock-detail-paid-from")).toHaveTextContent("BCA Operasional"));
    await expect(canvas.getByTestId("restock-detail-invoice")).toHaveTextContent("INV/2026/09/0412");
    await expect(canvas.getByTestId("restock-detail-tracking")).toHaveTextContent("SCP5544332211");
    await waitFor(() => expect(canvas.getByTestId("restock-detail-courier")).toHaveTextContent("SiCepat"));
  },
};

// #18 — receipt_file is a DOCUMENT ID, never a URL: the selling team (its owner) opens the photo through a link minted on
// click by GetDownloadUrl, so the button carries no href and the signed URL never sits on an open page.
export const TheLabelPhotoOpensASignedLink: Story = {
  name: "Label photo, signed link",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const open = spyOn(window, "open").mockReturnValue(null);

    const button = canvas.getByTestId("restock-detail-receipt-photo-open");
    await expect(button).toHaveTextContent("Open Label Photo");
    await expect(button).not.toHaveAttribute("href");
    await userEvent.click(button);

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith("https://example.invalid/proof/doc-restock-503-label", "_blank", "noopener,noreferrer"),
    );
    open.mockRestore();
  },
};

// Nothing attached reads as a stated absence, not an empty cell or a dead button.
export const NoLabelPhoto: Story = {
  name: "No label photo",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("restock-detail-receipt-photo")).toHaveTextContent("No photo of the label");
    await expect(canvas.queryByTestId("restock-detail-receipt-photo-open")).toBeNull();
  },
};

// PEMBAYARAN IS A SMALL RECEIPT (payment-is-a-receipt-on-the-right) — which account, then each line's figure held right on
// its own row, the total last.
export const PaymentIsAReceipt: Story = {
  name: "A receipt",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const total = canvas.getByTestId("restock-detail-total");
    const label = within(canvas.getByTestId("restock-detail-payment")).getByText("Total");

    await expect(total).toHaveTextContent("Rp 2.080.000");
    await expect(Math.abs(total.getBoundingClientRect().top - label.getBoundingClientRect().top)).toBeLessThan(2);
    await expect(total.getBoundingClientRect().left).toBeGreaterThan(label.getBoundingClientRect().right);
  },
};

// The courier's charge is a section only once accepted — an ongoing restock's nav has no Ongkir COD.
export const OngkirCodIsASectionOnceAccepted: Story = {
  name: "Ongkir COD once accepted",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await expect(canvas.queryByTestId("section-nav-courier")).toBeNull();
  },
};

// THE COURIER'S SLIP (owner: *"tampilkan"*, the-detail-pages-show-the-slip-and-the-broken-rack) — under the charge's note,
// a thumbnail that opens it whole. A SAMPLE, the page's second mark.
export const TheSlipIsShownWithTheCharge: Story = {
  name: "Slip photo",
  render: () => <At503 />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    const slip = canvas.getByTestId("restock-detail-courier-photo");

    await expect(within(slip).getByTestId("not-implemented-courierPhoto")).toHaveTextContent("3");
    await userEvent.click(within(slip).getByTestId("restock-detail-courier-photo-open"));
    const whole = await screen.findByTestId("restock-detail-courier-photo-dialog");
    await waitFor(() => expect(whole).toBeVisible());
    await expect(within(whole).getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
  },
};
