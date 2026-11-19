import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentCalls } from "../../../.storybook/customShipmentStory";
import { PHONE, SELLING_META, pickAccount, pickCourier, pickTeamIn, sellingAt, typeInto } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// ⚠ PROTOTYPE (backlog #88) — PAKET BARU, the selling team's create form (the-selling-team-asks-the-warehouse-ships).
// Toko Melati (12): a SAMPLE from Gudang Pusat's 25 Beras; or a RESHIP of a problem restock's broken units — 503 (2
// broken Beras, PT Sumber Makmur, who keeps a contact and an address) or 512 (Kecap of CV Cahaya Abadi, 4 of its 6 already
// on parcel 803; Tepung of Toko Grosir Sinar, who keeps neither). Who pays is asked here, once
// (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A).

const Routed = sellingAt("/inventories/custom-shipments/new");

const meta = {
  title: "Pages/Inventory/CustomShipment/Form",
  component: Routed,
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const BCA_OPS = 1301n;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-form", {}, { timeout: 4000 });
  return canvas;
}

async function pickBeras() {
  await userEvent.click(screen.getByTestId("custom-shipment-form-pick"));
  const option = await screen.findByTestId("product-picker-option-74", {}, { timeout: 4000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
  await userEvent.click(screen.getByTestId("product-picker-confirm"));
}

async function recipient(canvas: ReturnType<typeof within>) {
  await typeInto(canvas.getByTestId("custom-shipment-form-name"), "Rina Kusuma");
  await typeInto(canvas.getByTestId("custom-shipment-form-phone"), "0812-7777-1010");
  await typeInto(canvas.getByTestId("custom-shipment-form-address"), "Jl. Cihampelas 88, Bandung");
}

async function reship(canvas: ReturnType<typeof within>, restockId: string) {
  await userEvent.click(canvas.getByTestId("custom-shipment-form-kind-reship"));
  await userEvent.click(await canvas.findByTestId("custom-shipment-form-restock"));
  const option = await canvas.findByTestId(`custom-shipment-form-restock-option-${restockId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

// A NEW FORM, A SAMPLE BY DEFAULT: the products come from a warehouse's shelves, so the warehouse comes first; *Gudang
// bayar* is picked and asks nothing more now — *Kami bayar*'s fields stay hidden until it is picked; the ready line names
// the first thing missing, the button is off.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-form-kind-hint")).toHaveTextContent(/sample handed over in person is still recorded/i);
    await expect(canvas.getByTestId("custom-shipment-form-warehouse-first")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-missing-warehouse")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-submit")).toBeDisabled();
    await expect(canvas.getByTestId("custom-shipment-form-payer-hint")).toHaveTextContent(/types the real cost.*Team Balance/);
    await expect(canvas.queryByTestId("custom-shipment-form-team-pays")).toBeNull();
  },
};

export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("custom-shipment-form-recipient")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// Gudang Pusat, 3 Beras of its 25, Rina Kusuma, JNE, *Gudang bayar*, a note — every part a sample asks for.
async function fillSample(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await pickTeamIn(canvas.getByTestId("custom-shipment-form-warehouse"), "WH-01");
  await pickBeras();
  const count = await canvas.findByTestId("custom-shipment-form-count-74");
  await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-available-74")).toHaveTextContent("25 on hand"));
  await typeInto(count, "3");
  await recipient(canvas);
  await pickCourier(canvasElement, "jne");
  await typeInto(canvas.getByTestId("custom-shipment-form-note"), "Untuk video ulasan");
  await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-ready")).toBeVisible());
}

// A SAMPLE, READY — every part answered, *Gudang bayar* asking nothing more now; nothing is sent until the button.
export const ASampleReadyToCreate: Story = {
  name: "A sample ready to create",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await fillSample(canvasElement);
    await expect(canvas.getByTestId("custom-shipment-form-submit")).toBeEnabled();
    await expect(canvas.getByTestId("custom-shipment-form-pieces")).toHaveTextContent("1 product · 3 pcs");
    await expect(canvas.queryByTestId("custom-shipment-form-team-pays")).toBeNull();
    await expect(customShipmentCalls).toEqual([]);
  },
};

// A SAMPLE, CREATED — the request carries no cost and no account, and the form lands on the new parcel, Diminta, worth its
// batches' value.
export const ASampleIsCreated: Story = {
  name: "A sample is created",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await fillSample(canvasElement);
    await userEvent.click(canvas.getByTestId("custom-shipment-form-submit"));

    await expect(await canvas.findByTestId("custom-shipment-detail-page")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-title")).toHaveTextContent("Parcel #809");
    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
    await expect(canvas.getByTestId("custom-shipment-total")).toHaveTextContent("195.000");

    const sent = customShipmentCalls.find((c) => c.rpc === "CustomShipmentCreate");
    await expect(sent).toMatchObject({
      draft: {
        teamId: 12n,
        kind: "SAMPLE",
        warehouseId: 11n,
        restockId: 0n,
        lines: [{ productId: 74n, quantity: 3n }],
        recipient: { name: "Rina Kusuma", phone: "0812-7777-1010", address: "Jl. Cihampelas 88, Bandung" },
        shipmentChannelId: 91n,
        payer: "WAREHOUSE",
        financeAccountId: 0n,
        shippingCost: 0,
        note: "Untuk video ulasan",
      },
    });
  },
};

// A SAMPLE NEVER ASKS MORE THAN THE SHELF HOLDS (a-shelf-never-goes-below-zero): typed past it, the count settles back to
// what Gudang Pusat holds when the field is left — the transfer form's quantity, as it is.
export const MoreThanTheShelfHoldsSettlesBack: Story = {
  name: "More than the shelf holds settles back",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await pickTeamIn(canvas.getByTestId("custom-shipment-form-warehouse"), "WH-01");
    await pickBeras();
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-available-74")).toHaveTextContent("25 on hand"));
    const count = await canvas.findByTestId("custom-shipment-form-count-74");
    await typeInto(count, "30");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-missing-stock")).toBeVisible());
    await expect(canvas.getByTestId("custom-shipment-form-available-74")).toHaveTextContent("25 on hand");

    await userEvent.click(canvas.getByTestId("custom-shipment-form-name"));
    await waitFor(() => expect(count).toHaveValue("25"));
  },
};

// KAMI BAYAR — asked first, then filled: its account (required) and its cost (may follow, until the handover).
export const WePayAsksForTheAccount: Story = {
  name: "We pay asks for the account",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await pickTeamIn(canvas.getByTestId("custom-shipment-form-warehouse"), "WH-01");
    await pickBeras();
    await recipient(canvas);
    await pickCourier(canvasElement, "jne");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-ready")).toBeVisible());

    await userEvent.click(canvas.getByTestId("custom-shipment-form-payer-team"));
    await expect(await canvas.findByTestId("custom-shipment-form-team-pays")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-payer-hint")).toHaveTextContent(/an expense.*until the handover/);
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-missing-account")).toBeVisible());
    await expect(canvas.getByTestId("custom-shipment-form-submit")).toBeDisabled();

    await pickAccount("custom-shipment-form-account", BCA_OPS);
    await typeInto(canvas.getByTestId("custom-shipment-form-cost"), "15000");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-ready")).toBeVisible());
    await userEvent.click(canvas.getByTestId("custom-shipment-form-submit"));

    await expect(await canvas.findByTestId("custom-shipment-detail-page")).toBeVisible();
    await expect(customShipmentCalls.find((c) => c.rpc === "CustomShipmentCreate")).toMatchObject({
      draft: { payer: "TEAM", financeAccountId: BCA_OPS, shippingCost: 15000 },
    });
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-account")).toHaveTextContent("BCA Operasional"));
    await expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Rp 15.000");
  },
};

// A RESHIP, READY, THE TEAM PAYING — restock 503's 2 broken Beras back to PT Sumber Makmur, filled in from its record;
// *Kami bayar* from BCA Operasional, its cost typed now (it may change until the handover).
export const AReshipReadyWePay: Story = {
  name: "A reship ready, we pay",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await reship(canvas, "503");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-name")).toHaveValue("PT Sumber Makmur"));
    await pickCourier(canvasElement, "jnt");
    await userEvent.click(canvas.getByTestId("custom-shipment-form-payer-team"));
    await pickAccount("custom-shipment-form-account", BCA_OPS);
    await typeInto(canvas.getByTestId("custom-shipment-form-cost"), "25000");
    await typeInto(canvas.getByTestId("custom-shipment-form-note"), "Retur 2 karung sobek — sesuai chat dengan Pak Darto");

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-ready")).toBeVisible());
    await expect(canvas.getByTestId("custom-shipment-form-pieces")).toHaveTextContent("1 product · 2 pcs");
    await expect(customShipmentCalls).toEqual([]);
  },
};

// A RESHIP sends a problem restock's BROKEN units back — every one left, by default — and takes no rack stock; the
// supplier becomes the recipient, filled in from its record (name, contact, address), each still editable. It ships from
// the restock's warehouse.
export const AReshipSendsTheBrokenUnits: Story = {
  name: "A reship sends the broken units",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await reship(canvas, "503");
    await expect(canvas.getByTestId("custom-shipment-form-kind-hint")).toHaveTextContent(/no rack stock is taken/i);
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-restock-facts")).toHaveTextContent("Gudang Pusat"));
    // One supplier on the restock — nothing to ask.
    await expect(canvas.queryByTestId("custom-shipment-form-supplier")).toBeNull();

    await expect(canvas.getByTestId("custom-shipment-form-broken-count-74")).toHaveValue("2");
    await expect(canvas.getByTestId("custom-shipment-form-broken-left-74")).toHaveTextContent("2 broken left");
    await expect(canvas.getByTestId("custom-shipment-form-broken-74")).toHaveTextContent("Broken: Karung sobek");

    await expect(canvas.getByTestId("custom-shipment-form-name")).toHaveValue("PT Sumber Makmur");
    await expect(canvas.getByTestId("custom-shipment-form-phone")).toHaveValue("0812-1111-2222");
    await expect(canvas.getByTestId("custom-shipment-form-address")).toHaveValue("Jl. Soekarno-Hatta 112, Bandung");
    await expect(canvas.getByTestId("custom-shipment-form-prefilled")).toHaveTextContent("PT Sumber Makmur's supplier record");

    // No more than the broken count.
    await typeInto(canvas.getByTestId("custom-shipment-form-broken-count-74"), "3");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-missing-overBroken")).toBeVisible());
    await typeInto(canvas.getByTestId("custom-shipment-form-broken-count-74"), "2");

    await pickCourier(canvasElement, "jnt");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-ready")).toBeVisible());
    await userEvent.click(canvas.getByTestId("custom-shipment-form-submit"));

    await expect(await canvas.findByTestId("custom-shipment-detail-page")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-restock")).toHaveTextContent("restock #503");
    await expect(canvas.getByTestId("custom-shipment-lines-broken-hint")).toHaveTextContent(/never on a rack/);
    await expect(canvas.queryByTestId("custom-shipment-total")).toBeNull();
    await expect(customShipmentCalls.find((c) => c.rpc === "CustomShipmentCreate")).toMatchObject({
      draft: {
        kind: "RESTOCK_RESHIP",
        warehouseId: 11n,
        restockId: 503n,
        supplierId: 31n,
        lines: [{ productId: 74n, quantity: 2n, restockItemId: 5031n }],
        recipient: { name: "PT Sumber Makmur" },
      },
    });
  },
};

// ONE PARCEL, ONE SUPPLIER: restock 512's broken lines name two, so the form asks which. Toko Grosir Sinar keeps no
// contact and no address — only its name is filled in, and the form says what to type. CV Cahaya Abadi's Kecap has 2
// left of 6: 4 already ride on parcel 803.
export const AReshipGoesToOneSupplier: Story = {
  name: "A reship goes to one supplier",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await reship(canvas, "512");
    await expect(await canvas.findByTestId("custom-shipment-form-supplier")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-missing-supplier")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-form-broken-lines")).toBeNull();

    await userEvent.click(canvas.getByTestId("custom-shipment-form-supplier-33"));
    await expect(await canvas.findByTestId("custom-shipment-form-broken-75")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-form-broken-76")).toBeNull();
    await expect(canvas.getByTestId("custom-shipment-form-name")).toHaveValue("Toko Grosir Sinar");
    await expect(canvas.getByTestId("custom-shipment-form-phone")).toHaveValue("");
    await expect(canvas.getByTestId("custom-shipment-form-address")).toHaveValue("");
    await expect(canvas.getByTestId("custom-shipment-form-prefilled")).toHaveTextContent(/lacks a contact or an address/);

    await userEvent.click(canvas.getByTestId("custom-shipment-form-supplier-32"));
    await expect(await canvas.findByTestId("custom-shipment-form-broken-76")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-broken-left-76")).toHaveTextContent("2 left · 6 broken, 4 already on a parcel");
    await expect(canvas.getByTestId("custom-shipment-form-name")).toHaveValue("CV Cahaya Abadi");
    await expect(canvas.getByTestId("custom-shipment-form-phone")).toHaveValue("0812-2222-3333");
  },
};

// THE GATE — live, the form draws only its one line.
export const Live: Story = {
  name: "Live · not available",
  parameters: { live: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("custom-shipment-unavailable")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-form")).toBeNull();
  },
};
