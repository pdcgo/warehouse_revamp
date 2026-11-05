import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { pickTeam } from "../../../../.storybook/pageStory";
import { BERAS, CAHAYA, CAHAYA_STORE, type Canvas, EditOngoing, FORM_META, connectSupplier, loaded, pickProducts } from "./kit";

// RESTOCK FORM — the money column — the checks in the form's order, the one line over Buat Restok, the totals, the
// note over the button, and the button's icon.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockForm/Summary",
  ...FORM_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const BCA_OPS = 1301n;

/** FinancialAccountSelect does not portal — its listbox is inside the canvas. */
async function pickAccount(canvas: Canvas, accountId: bigint) {
  await userEvent.click(canvas.getByTestId("restock-finance-account"));
  const option = await canvas.findByTestId(`restock-finance-account-option-${accountId}`, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** ShipmentChannelSelect portals — its options are on `screen`. */
async function pickCourier(canvas: Canvas, code: string) {
  await userEvent.click(within(canvas.getByTestId("restock-courier")).getByRole("combobox"));
  const option = await screen.findByTestId(`shipment-channel-option-${code}`, {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// THE CHECKS RUN IN THE FORM'S ORDER (owner: *"untuk urutan validasi restocknya mulai dari produk, gudang, rekening,
// resi"*, *"di produk perlu cek semuanya punya supplier dulu"*, the-checks-run-products-warehouse-account-resi) — the line
// by Buat Restok names one thing at a time: the products, a supplier and a total on every one, the warehouse, the paying account
// (a-restock-names-its-paying-account), the courier (the-courier-is-required-on-the-form), the resi — and while the resi
// is being checked, that it is (a-reference-in-use-stops-the-restock-form); then the ready mark, and Buat Restok saves.
export const TheChecksRunProductsWarehouseAccountResi: Story = {
  name: "Checks in the form's order",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const button = canvas.getByTestId("submit-restock");
    const first = (id: string) => waitFor(() => expect(canvas.getByTestId(`restock-form-missing-${id}`)).toBeVisible());

    await first("lines");
    await pickProducts(canvas, [BERAS]);
    await first("supplier");
    await expect(canvas.getByTestId("restock-line-0-supplier-required")).toBeVisible();

    await userEvent.click(canvas.getByTestId("restock-line-0-picker-trigger"));
    await connectSupplier("restock-line-0-picker", "Cahaya", CAHAYA.id, CAHAYA_STORE);
    // The count starts at 1; the TOTAL must be typed (the-count-and-total-are-required).
    await first("total");
    await expect(canvas.getByTestId("restock-total-required-0")).toBeVisible();
    await userEvent.type(canvas.getByTestId("restock-total-price-0"), "650000", { delay: 20 });
    await first("warehouse");

    await pickTeam(canvas.getByTestId("restock-warehouse"), "WH-01");
    await first("account");
    await expect(button).toBeDisabled();

    await pickAccount(canvas, BCA_OPS);
    await first("courier");
    await expect(button).toBeDisabled();

    await pickCourier(canvas, "jne");
    await first("receipt");
    await expect(button).toBeDisabled();

    // A resi no restock holds — asked first, so Buat waits for the answer.
    await userEvent.type(canvas.getByTestId("restock-receipt"), "JNE7000000001", { delay: 20 });
    await first("receiptChecking");
    await expect(button).toBeDisabled();

    await waitFor(() => expect(canvas.queryByTestId("restock-form-missing")).toBeNull(), { timeout: 4000 });
    await expect(canvas.queryByTestId("restock-receipt-check-taken")).toBeNull();
    // Everything in: the ready mark (a-save-button-says-what-it-waits-for).
    await expect(canvas.getByTestId("restock-form-ready")).toHaveTextContent("Ready to create");
    await expect(canvas.getByTestId("submit-restock")).toBeEnabled();

    await userEvent.click(canvas.getByTestId("submit-restock"));
    await canvas.findByTestId("at-restock-list", {}, { timeout: 4000 });
  },
};

// the-couriers-charge-stays-out-of-total: the total is goods + shipping, tracking what is typed — there is no courier's
// charge on this form, and the summary says where it goes instead.
export const TotalsAreGoodsPlusShippingOnly: Story = {
  name: "Goods plus shipping",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    // 650.000 + 960.000 + 450.000 of goods, 20.000 of shipping.
    await waitFor(() => expect(canvas.getByTestId("restock-summary-products")).toHaveTextContent("Rp 2.060.000"));
    await expect(canvas.getByTestId("restock-summary-shipping")).toHaveTextContent("Rp 20.000");
    await expect(canvas.getByTestId("restock-summary-total")).toHaveTextContent("Rp 2.080.000");

    const total = canvas.getByTestId("restock-total-price-2");
    await userEvent.clear(total);
    await userEvent.type(total, "500000", { delay: 20 });
    const shipping = canvas.getByTestId("restock-shipping-cost");
    await userEvent.clear(shipping);
    await userEvent.type(shipping, "25000", { delay: 20 });

    await waitFor(() => expect(canvas.getByTestId("restock-summary-total")).toHaveTextContent("Rp 2.135.000"));
    await expect(canvas.getByTestId("restock-summary-products")).toHaveTextContent("Rp 2.110.000");
    await expect(canvas.getByTestId("restock-summary-courier-note")).toBeVisible();
  },
};

// BUAT CARRIES A PLUS, SIMPAN A DISK (an-action-button-carries-its-icon) — as the product form's.
export const CreateCarriesAPlus: Story = {
  name: "Buat, a plus",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");

    await expect(within(canvas.getByTestId("submit-restock")).getByTestId("submit-restock-create-icon")).toBeInTheDocument();
  },
};

export const SaveCarriesADisk: Story = {
  name: "Simpan, a disk",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");

    await expect(within(canvas.getByTestId("submit-restock")).getByTestId("submit-restock-save-icon")).toBeInTheDocument();
  },
};

// THE WAREHOUSE OVER THE PAYMENT, THE NOTE OVER BUAT RESTOK (owner: *"gudang taruh di atas pembayaran dan paket, catatan
// taruh di atas buat restok"*, the-note-sits-over-buat-restok) — the note is the last thing written, between the total and
// the button, in the money column.
export const TheNoteSitsOverBuatRestok: Story = {
  name: "Note over Buat",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const after = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const money = canvas.getByTestId("restock-form-money");

    await expect(after(canvas.getByTestId("restock-warehouse"), canvas.getByTestId("restock-finance-account"))).toBe(true);

    await expect(money).toContainElement(canvas.getByTestId("restock-note"));
    await expect(after(canvas.getByTestId("restock-summary"), canvas.getByTestId("restock-note"))).toBe(true);
    await expect(after(canvas.getByTestId("restock-note"), canvas.getByTestId("submit-restock"))).toBe(true);
  },
};

// READY, OR THE ONE THING IT WAITS FOR, IN ONE LINE OVER BUAT RESTOK (owner: *"catatan di bawah buat tidak butuh, atau buat
// lebih bagus sebelum buat restok, tapi jangan makan tempat"*, then *"aku ingin info 1 aja ditampilkan yang belum saja,
// kalau sudah semua berarti ada tanda siap, masih bisa didetailkan"*, a-save-button-says-what-it-waits-for) — the first
// missing part, the rest behind +3 more; nothing under the button. (The ready mark: TheChecksRunProductsWarehouseAccountResi.)
export const WhatIsMissingIsOneLineOverBuat: Story = {
  name: "What is missing",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-create-page");
    const missing = canvas.getByTestId("restock-form-missing");
    const button = canvas.getByTestId("submit-restock");

    await expect(button).toBeDisabled();
    await expect(missing).toHaveTextContent("Not filled in: products");
    await expect(canvas.getByTestId("restock-form-missing-more")).toHaveTextContent("+4 more");
    await expect(missing.getBoundingClientRect().bottom).toBeLessThanOrEqual(button.getBoundingClientRect().top);
    await expect(missing.getBoundingClientRect().height).toBeLessThan(24);
    // Nothing under the button.
    await expect(button.parentElement!.lastElementChild).toBe(button);

    // The detail, on asking.
    await userEvent.click(canvas.getByTestId("restock-form-missing-more"));
    const detail = await screen.findByTestId("restock-form-missing-detail");
    await waitFor(() => expect(detail).toBeVisible());
    await expect(detail).toHaveTextContent(/products.*warehouse.*paying account.*courier.*tracking number/);
  },
};

// THE SUMMARY'S PRODUCTS FOLD (owner: *"rincian produk di kanan bisa di collapse"*, the-summary-folds-its-products) — open
// to start; the heading folds the list away and opens it again, the money staying put.
export const TheSummaryFoldsItsProducts: Story = {
  name: "Products fold",
  render: () => <EditOngoing />,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement, "restock-edit-page");
    const toggle = await canvas.findByTestId("restock-summary-toggle");

    await waitFor(() => expect(canvas.getByTestId("restock-summary-lines")).toBeVisible());

    await userEvent.click(toggle);
    await waitFor(() => expect(canvas.queryByTestId("restock-summary-lines")).not.toBeVisible());
    await expect(canvas.getByTestId("restock-summary-count")).toHaveTextContent("3");
    await expect(canvas.getByTestId("restock-summary-total")).toBeVisible();

    // Unfolding, the list cannot scroll until the box has finished growing — no scrollbar flashes through the
    // animation (owner: *"collapse muncul scrollbar dan mengganggu"*, the-summary-folds-without-a-scrollbar).
    await userEvent.click(toggle);
    const list = await canvas.findByTestId("restock-summary-lines");
    await expect(getComputedStyle(list).overflowY).toBe("hidden");
    await waitFor(() => expect(getComputedStyle(list).overflowY).toBe("auto"));
    await expect(list).toBeVisible();
  },
};
