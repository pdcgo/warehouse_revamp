import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { restockRequestService } from "../../../../.storybook/restockStub";
import {
  A_01_1,
  A_01_2,
  ACCEPT_META,
  COFFEE,
  PHOTO,
  RICE,
  acceptControl,
  arrivedWithACharge,
  askCharge,
  count,
  countWhole,
  expectAccept,
  lineOf,
  loaded,
  openCharge,
  typeInto,
} from "./kit";

// RESTOCK ACCEPT — the courier's COD charge at the door: asked first, then its amount, its note and its slip; owed back
// by the selling team, and inside every landed price.
// The page's stories are grouped by the part of the screen they are about
// (stories-are-grouped-by-the-part-of-the-screen); what they share is ./kit.tsx.

const meta = {
  title: "Pages/Inventory/Restock/RestockAccept/Charge",
  ...ACCEPT_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * the-courier-is-paid-once-per-restock — on Ada the amount is required, and its note once it is above 0. What is still
 * missing is the one line by Terima (a-save-button-says-what-it-waits-for); the note shows an example
 * (every-form-field-shows-an-example).
 */
export const ACourierChargeNeedsANote: Story = {
  name: "Charge needs a note",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await expectAccept(canvasElement, true);

    // Ada — Accept waits for an amount.
    await askCharge(canvasElement);
    await expectAccept(canvasElement, false);
    await expect(canvas.getByTestId("accept-ready-line-missing-chargeAmount")).toHaveTextContent("the courier's charge");
    await expect(canvas.getByTestId("accept-courier-note")).toHaveAttribute("placeholder", "e.g. COD handling fee");

    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");
    await expect(await canvas.findByTestId("accept-courier-note-error")).toBeInTheDocument();
    await expect(canvas.getByTestId("accept-ready-line-missing-chargeNote")).toHaveTextContent(
      "what the courier's charge was for",
    );
    await expectAccept(canvasElement, false);

    await typeInto(canvas.getByTestId("accept-courier-note"), "Biaya COD");
    await waitFor(() => expect(canvas.queryByTestId("accept-courier-note-error")).toBeNull());
    await expect(canvas.getByTestId("accept-ready-line-ready")).toHaveTextContent("Ready to accept");
    await expectAccept(canvasElement, true);
  },
};

/**
 * THE ONGKIR THE WAREHOUSE PAID IS SAID IN ITS OWN SECTION, AS TEXT (owner: *"di paket ongkir hilangkan, di section ongkir
 * cod dari kurir kasih teks keterangan berapa yang dibayarkan, nanti ada interaksi untuk bisa mengubahnya"*,
 * the-cod-paid-is-said-in-its-own-section) — none at first; Ubah opens the form, Selesai folds it back to *Dibayar gudang
 * Rp 5.000 · Biaya COD · diganti oleh Toko Melati*. The Paket card carries no ongkir. It is in the landed price
 * (the-couriers-ask-is-in-the-unit-price), so what a broken unit was worth moves with it.
 */
export const TheOngkirTheWarehousePaid: Story = {
  name: "Ongkir it paid",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await count(canvasElement, COFFEE.productId, "12", "1");

    // No value card, and no ongkir in Paket — the section is where it is said.
    await expect(canvas.queryByTestId("accept-grand-total")).toBeNull();
    await expect(canvas.getByTestId("accept-courier-none")).toHaveTextContent("No COD charge paid by the warehouse.");
    await expect(canvas.queryByTestId("accept-courier-charge")).toBeNull();
    // 400.000 ÷ 12 + 15.000 ÷ 17 units ordered = 34.215,69.
    await expect(canvas.getByTestId(`accept-broken-value-${COFFEE.productId}`)).toHaveTextContent("34.216");

    // Ubah — the form; the charge and its note; Selesai — the text again, with what was paid.
    await askCharge(canvasElement);
    await expect(canvas.getByTestId("accept-courier-done")).toBeDisabled();
    await typeInto(canvas.getByTestId("accept-courier-charge"), "5000");
    await typeInto(canvas.getByTestId("accept-courier-note"), "Biaya COD");
    await userEvent.click(canvas.getByTestId("accept-courier-done"));

    await waitFor(() => expect(canvas.getByTestId("accept-courier-owed")).toHaveTextContent("Rp 5.000"));
    await expect(canvas.getByTestId("accept-courier-paid-line")).toHaveTextContent("Biaya COD · owed back by Toko Melati");
    await expect(canvas.queryByTestId("accept-courier-charge")).toBeNull();
    // (15.000 + 5.000) ÷ 17 — the charge is in the landed price.
    await expect(canvas.getByTestId(`accept-broken-value-${COFFEE.productId}`)).toHaveTextContent("34.510");
  },
};

// A PHOTO OF THE COURIER'S SLIP (owner: *"kurasa masuk akal kalau opsional"*, the-courier-slip-has-an-optional-photo) —
// under the charge's amount and note, optional, the page's fourth mark — the last, in the info after the lines.
export const TheCouriersSlipTakesAPhoto: Story = {
  name: "Slip photo",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await askCharge(canvasElement);
    const slip = within(canvas.getByTestId("accept-courier-photo"));

    await expect(slip.getByTestId("not-implemented-courierPhoto")).toHaveTextContent("4");
    await userEvent.upload(slip.getByTestId("accept-courier-photo-input"), PHOTO());
    await waitFor(() => expect(slip.getByTestId("accept-courier-photo-shown")).toHaveTextContent("rusak.png"));
  },
};

// A CHARGE PAID AT TIBA IS SAID AS TEXT, NOT A FORM (owner: *"kalau sudah paid, tidak perlu set lagi"*, then *"di
// section ongkir cod dari kurir kasih teks keterangan berapa yang dibayarkan, nanti ada interaksi untuk bisa
// mengubahnya"*, the-cod-paid-is-said-in-its-own-section) — the page AS IT OPENS: *Dibayar gudang Rp 15.000 · Biaya COD ·
// diganti oleh Toko Melati*, Ubah beside it, no fields; the charge is nowhere in what Terima waits for. Nothing is typed,
// so the story stays on this view. Tandai Tiba keeps none yet, so 502 is given one by hand; the page's third mark says the
// rest is missing.
export const TheChargeOpensWithTheRestocks: Story = {
  name: "Opens with Tiba's charge",
  beforeEach: arrivedWithACharge,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("accept-courier-owed")).toHaveTextContent("Rp 15.000"), { timeout: 4000 });
    await expect(canvas.getByTestId("accept-courier-paid")).toHaveTextContent("Paid by the warehouse");
    await expect(canvas.getByTestId("accept-courier-paid-line")).toHaveTextContent("Biaya COD · owed back by Toko Melati");
    await expect(canvas.getByTestId("accept-courier-edit")).toBeVisible();
    // Text, not a form.
    await expect(canvas.queryByTestId("accept-courier-asked-yes")).toBeNull();
    await expect(canvas.queryByTestId("accept-courier-charge")).toBeNull();
    await expect(within(canvas.getByTestId("accept-courier")).getByTestId("not-implemented-codFromArrival")).toHaveTextContent("3");

    // NOTHING TO SET AGAIN: what Terima waits for is the box — the two lines — never the charge.
    await lineOf(canvasElement, COFFEE.productId);
    await expect(canvas.getByTestId(`accept-ready-line-missing-line-${COFFEE.productId}`)).toBeVisible();
    await expect(canvas.queryByTestId("accept-ready-line-missing-chargeAmount")).toBeNull();
    await expect(canvas.queryByTestId("accept-ready-line-missing-chargeNote")).toBeNull();
  },
};

// …and once the box is counted, Terima sends Tiba's charge as it came — 15.000 and *Biaya COD*, untouched.
export const TibasChargeIsSentAsItCame: Story = {
  name: "Tiba's charge, accepted",
  beforeEach: arrivedWithACharge,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("accept-courier-owed")).toHaveTextContent("Rp 15.000"), { timeout: 4000 });

    await countWhole(canvasElement, COFFEE.productId, A_01_1);
    await countWhole(canvasElement, RICE.productId, A_01_2);
    await expect(canvas.getByTestId("accept-ready-line-ready")).toBeVisible();

    await userEvent.click(acceptControl(canvasElement));
    const confirm = await screen.findByTestId("confirm-action");
    await waitFor(() => expect(confirm).toBeVisible());
    await userEvent.click(confirm);
    await canvas.findByTestId("at-restock-detail", {}, { timeout: 4000 });

    const stored = (
      await restockRequestService.restockRequestDetail!({ teamId: 11n, requestId: 502n } as never, {} as never)
    ).request!;
    await expect(stored.warehouseAdditionalCost).toBe(15000);
    await expect(stored.warehouseAdditionalCostNote).toBe("Biaya COD");
  },
};

// …and still open to change (owner: *"tiba dan diterima bisa mengubah ongkir"*): Ubah opens the form with Tiba's values in
// it; typed over and Selesai, the text says the new figure.
export const TibasChargeCanBeChanged: Story = {
  name: "Tiba's charge, changed",
  beforeEach: arrivedWithACharge,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("accept-courier-owed")).toHaveTextContent("Rp 15.000"), { timeout: 4000 });

    await openCharge(canvasElement);
    await expect(canvas.getByTestId("accept-courier-asked-yes")).toHaveAttribute("data-state", "checked");
    await expect(canvas.getByTestId("accept-courier-charge")).toHaveValue("15.000");
    await expect(canvas.getByTestId("accept-courier-note")).toHaveValue("Biaya COD");

    await typeInto(canvas.getByTestId("accept-courier-charge"), "20000");
    await userEvent.click(canvas.getByTestId("accept-courier-done"));
    await waitFor(() => expect(canvas.getByTestId("accept-courier-owed")).toHaveTextContent("Rp 20.000"));
  },
};
