import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentScenario, customShipmentWrites } from "../../../.storybook/customShipmentScenario";
import { customShipmentClient } from "../../api/clients";
import {
  CustomShipmentKind,
  CustomShipmentPayer,
} from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import { seedGoodsMissing } from "../../features/customShipment/goodsMissingStoryKit";
import {
  PHONE,
  SELLING_META,
  clearToasts,
  pickAccount,
  pickCourier,
  pickTeamIn,
  sellingAt,
  typeInto,
} from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// PAKET BARU, the selling team's create form (the-selling-team-asks-the-warehouse-ships), live: CustomShipmentCreate and
// CustomShipmentReshipOptions through the stub transport, the reship's supplier resolved by supplier_service's reads.
// Toko Melati (12): a SAMPLE from Gudang Pusat's 25 Beras; or a RESHIP of a problem restock's broken units — 503 (2
// broken Beras, PT Sumber Makmur, who keeps a contact and an address) or 512 (Kecap of CV Cahaya Abadi, 4 of its 6 already
// on parcel 803; Tepung of Toko Grosir Sinar, who keeps neither). Who pays is asked here, once
// (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A). A broken line's sentence adds up: what is left of its
// broken units, those on a live reship, and those a goods-missing note named on a cancelled one
// (the-reship-line-counts-the-units-not-found) — the not-found part only when there are some.

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
  await userEvent.click(await canvas.findByTestId("custom-shipment-form-restock", {}, { timeout: 4000 }));
  const option = await canvas.findByTestId(`custom-shipment-form-restock-option-${restockId}`);
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

const created = () => customShipmentWrites().find((c) => c.rpc === "CustomShipmentCreate")?.req;

// A NEW FORM, A SAMPLE BY DEFAULT: the products come from a warehouse's shelves, so the warehouse comes first; *Gudang
// bayar* is picked and asks nothing more now — *Kami bayar*'s fields stay hidden until it is picked; the ready line names
// the first thing missing, the button is off. The reship's choices are not asked until a reship is picked.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-form-kind-hint")).toHaveTextContent(/sample handed over in person is still recorded/i);
    await expect(canvas.getByTestId("custom-shipment-form-warehouse-first")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-missing-warehouse")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-submit")).toBeDisabled();
    await expect(canvas.getByTestId("custom-shipment-form-payer-hint")).toHaveTextContent(/types the real cost.*Team Balance/);
    await expect(canvas.queryByTestId("custom-shipment-form-team-pays")).toBeNull();
    await expect(customShipmentScenario.calls.some((c) => c.rpc === "CustomShipmentReshipOptions")).toBe(false);
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
    await expect(customShipmentWrites()).toEqual([]);
  },
};

// A SAMPLE, CREATED — the request is the real one: the warehouse and each product with its count (the server copies the
// code and name), *Gudang bayar* with account 0 and cost 0, the form's key; the form lands on the new parcel, Diminta,
// worth its batches' value.
export const ASampleIsCreated: Story = {
  name: "A sample is created",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await fillSample(canvasElement);
    await userEvent.click(canvas.getByTestId("custom-shipment-form-submit"));

    await expect(await canvas.findByTestId("custom-shipment-detail-page", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-title")).toHaveTextContent("Parcel #809");
    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
    await expect(canvas.getByTestId("custom-shipment-total")).toHaveTextContent("195.000");

    await expect(created()).toMatchObject({
      teamId: 12n,
      kind: CustomShipmentKind.SAMPLE,
      warehouseId: 11n,
      restockId: 0n,
      lines: [{ productId: 74n, restockItemId: 0n, quantity: 3n }],
      recipient: { name: "Rina Kusuma", phone: "0812-7777-1010", address: "Jl. Cihampelas 88, Bandung" },
      shipmentChannelId: 91n,
      payer: CustomShipmentPayer.WAREHOUSE,
      financeAccountId: 0n,
      shippingCost: 0,
      note: "Untuk video ulasan",
    });
    await expect(String(created()?.idempotencyKey ?? "")).not.toBe("");
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

// A REFUSED CREATE SAYS WHY AND KEEPS THE FORM — the server's sentence (here: the shelf ran short since the form read it)
// in the toast; nothing is lost, the button can be pressed again.
export const ARefusedCreateSaysWhy: Story = {
  name: "A refused create says why",
  play: async ({ canvasElement }) => {
    clearToasts();
    const canvas = await opened(canvasElement);

    await fillSample(canvasElement);
    customShipmentScenario.refuseNext = { rpc: "CustomShipmentCreate", message: "not enough stock: SKU-BERAS-5K" };
    await userEvent.click(canvas.getByTestId("custom-shipment-form-submit"));

    await waitFor(() => expect(screen.getByText("Parcel not created")).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText("not enough stock: SKU-BERAS-5K")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("custom-shipment-form")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-name")).toHaveValue("Rina Kusuma");
    await expect(canvas.getByTestId("custom-shipment-form-submit")).toBeEnabled();
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

    await expect(await canvas.findByTestId("custom-shipment-detail-page", {}, { timeout: 4000 })).toBeVisible();
    await expect(created()).toMatchObject({ payer: CustomShipmentPayer.TEAM, financeAccountId: BCA_OPS, shippingCost: 15000 });
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
    await expect(customShipmentWrites()).toEqual([]);
  },
};

// A RESHIP sends a problem restock's BROKEN units back — every one left, by default — and takes no rack stock; the
// supplier becomes the recipient, filled in from its record (name, contact, address — supplier_service's SupplierByIds),
// each still editable, and the line names its store (SupplierChannelByIds). It ships from the restock's warehouse; the
// request names the restock line and its product, never the supplier (the server takes it from the line).
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
    await expect(canvas.getByTestId("custom-shipment-form-broken-left-74")).toHaveTextContent(/^2 broken left$/);
    await expect(canvas.getByTestId("custom-shipment-form-broken-74")).toHaveTextContent("Broken: Karung sobek");
    await expect(canvas.getByTestId("custom-shipment-form-broken-74")).toHaveTextContent("Sumber Makmur Store");

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

    await expect(await canvas.findByTestId("custom-shipment-detail-page", {}, { timeout: 4000 })).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-restock")).toHaveTextContent("restock #503");
    await expect(canvas.getByTestId("custom-shipment-lines-broken-hint")).toHaveTextContent(/never on a rack/);
    await expect(canvas.queryByTestId("custom-shipment-total")).toBeNull();
    await expect(created()).toMatchObject({
      kind: CustomShipmentKind.RESTOCK_RESHIP,
      warehouseId: 11n,
      restockId: 503n,
      lines: [{ productId: 74n, quantity: 2n, restockItemId: 5031n }],
      recipient: { name: "PT Sumber Makmur" },
      payer: CustomShipmentPayer.WAREHOUSE,
    });
    await expect(created()).not.toHaveProperty("supplierId");
  },
};

// ONE PARCEL, ONE SUPPLIER: restock 512's broken lines name two, so the form asks which. Toko Grosir Sinar keeps no
// contact and no address — only its name is filled in, and the form says what to type. CV Cahaya Abadi's Kecap has 2
// left of 6: 4 already ride on parcel 803 (the server's count of the live reships).
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
    // Nothing noted gone on this line — the sentence is exactly the one without the not-found part.
    await expect(canvas.getByTestId("custom-shipment-form-broken-left-76")).toHaveTextContent(/^2 left · 6 broken, 4 already on a parcel$/);
    await expect(canvas.getByTestId("custom-shipment-form-name")).toHaveValue("CV Cahaya Abadi");
    await expect(canvas.getByTestId("custom-shipment-form-phone")).toHaveValue("0812-2222-3333");
  },
};

// THE SERVER ALREADY HOLDS: the warehouse's note on reship 803 — its 4 broken Kecap already thrown away (goodsMissingStoryKit)
// — and the team's cancel of 803 after it, both through the stub's real RPCs. Those 4 are gone for good
// (missing-reship-units-are-not-offered-again): restock 512's Kecap has 2 of its 6 left, never 6 again.
async function kecapNotedGoneThenCancelled() {
  seedGoodsMissing("803");
  await customShipmentClient.customShipmentCancel({ teamId: 12n, id: 803n });
}

// A LINE WHOSE UNITS ARE BOTH NOTED GONE AND ON A LIVE RESHIP — after 803's 4 went, the team sent 1 more Kecap on a new
// reship: 1 left · 6 broken, 1 on a parcel, 4 not found — the sentence adds up, and the count stops at what is left.
export const AReshipLineCountsTheUnitsNotFound: Story = {
  name: "A reship line counts the units not found",
  beforeEach: async () => {
    await kecapNotedGoneThenCancelled();
    await customShipmentClient.customShipmentCreate({
      teamId: 12n,
      kind: CustomShipmentKind.RESTOCK_RESHIP,
      restockId: 512n,
      lines: [{ restockItemId: 5121n, productId: 76n, quantity: 1n }],
      recipient: { name: "CV Cahaya Abadi", phone: "0812-2222-3333", address: "Jl. Raya Darmo 45, Surabaya" },
      shipmentChannelId: 91n,
      payer: CustomShipmentPayer.WAREHOUSE,
      idempotencyKey: "story-reship-after-not-found",
      note: "",
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await reship(canvas, "512");
    await userEvent.click(await canvas.findByTestId("custom-shipment-form-supplier-32"));
    await expect(await canvas.findByTestId("custom-shipment-form-broken-76")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-broken-left-76")).toHaveTextContent(/^1 left · 6 broken, 1 on a parcel, 4 not found$/);
    await expect(canvas.getByTestId("custom-shipment-form-broken-count-76")).toHaveValue("1");

    await typeInto(canvas.getByTestId("custom-shipment-form-broken-count-76"), "2");
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-form-missing-overBroken")).toBeVisible());
  },
};

// NOTED GONE, NONE ON A PARCEL — 803 cancelled after its note and nothing sent since: 2 left · 6 broken, 4 not found. The
// on-a-parcel part is left out when it holds no unit, as the sentence always did.
export const AReshipLineNotFoundOnly: Story = {
  name: "A reship line, not found only",
  beforeEach: kecapNotedGoneThenCancelled,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await reship(canvas, "512");
    await userEvent.click(await canvas.findByTestId("custom-shipment-form-supplier-32"));
    await expect(await canvas.findByTestId("custom-shipment-form-broken-76")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-form-broken-left-76")).toHaveTextContent(/^2 left · 6 broken, 4 not found$/);
    await expect(canvas.getByTestId("custom-shipment-form-broken-count-76")).toHaveValue("2");
  },
};
