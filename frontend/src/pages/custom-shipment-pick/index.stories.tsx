import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentCalls } from "../../../.storybook/customShipmentStory";
import { PHONE, WAREHOUSE_META, typeInto, warehouseAt } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// ⚠ PROTOTYPE (backlog #88) — THE WAREHOUSE'S PAGE FOR ONE PARCEL, Gudang Pusat (11) as Budi: the pick list (a sample's
// racks, a reship's broken units), the item scans and Sudah Diambil — the order pick page's own — then Serahkan ke
// Kurir, typing the real ongkir when the warehouse pays (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A).
//
//   801  sample, requested, Gudang bayar — 3 Beras on A-01-1, a note from the team
//   803  reship, requested — 4 broken Kecap of restock 512, to CV Cahaya Abadi
//   808  sample, picked, Gudang bayar — the handover types the cost
//   802  sample, picked, Kami bayar — the handover takes no cost

const At801 = warehouseAt("/inventories/custom-shipments/801");
const At803 = warehouseAt("/inventories/custom-shipments/803");
const At808 = warehouseAt("/inventories/custom-shipments/808");
const At802 = warehouseAt("/inventories/custom-shipments/802");
const At806 = warehouseAt("/inventories/custom-shipments/806");

const meta = {
  title: "Pages/Inventory/CustomShipment/Pick",
  component: At801,
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-pick-page", {}, { timeout: 4000 });
  return canvas;
}

async function scan(input: HTMLElement, code: string) {
  await userEvent.type(input, `${code}{Enter}`, { delay: 10 });
}

// A SAMPLE TO PICK: the team's note first (read before the walk), then the pick list — each line's racks as the take drew
// them — then the scans. No value anywhere, and the parcel says the warehouse pays the courier and bills the team.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
    await expect(canvas.getByTestId("custom-shipment-pick-note")).toHaveTextContent("Untuk video ulasan");
    await expect(canvas.getByTestId("custom-shipment-rack-74-41")).toHaveTextContent("A-01-1×3");
    await expect(canvas.queryByTestId("custom-shipment-value-74")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-total")).toBeNull();
    await expect(canvas.getByTestId("pick-scan")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-handover-open")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-payer")).toHaveTextContent("Warehouse pays — billed to Toko Melati"));
    await expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Typed by the warehouse at the handover");
    await expect(canvas.getByTestId("custom-shipment-timeline-awaiting")).toHaveTextContent("Waiting for the warehouse to pick");
  },
};

export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("custom-shipment-rack-74-41")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// THE ITEM SCANS, THEN SUDAH DIAMBIL — the order's own (the-item-scans-live-on-the-page): every unit by its product code,
// Set Picked on only when every line is exact, one write — requested → picked; then Serahkan ke Kurir is the step.
export const ScanningSetsPicked: Story = {
  name: "Scanning sets picked",
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);
    const input = canvas.getByTestId("pick-scan-input");

    await scan(input, "SKU-BERAS-5K");
    await scan(input, "SKU-BERAS-5K");
    await expect(canvas.getByTestId("pick-order-set-picked")).toBeDisabled();
    await scan(input, "SKU-BERAS-5K");
    await waitFor(() => expect(canvas.getByTestId("pick-order-set-picked")).toBeEnabled());

    await userEvent.click(canvas.getByTestId("pick-order-set-picked"));
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Picked"));
    await expect(canvas.queryByTestId("pick-scan")).toBeNull();
    await expect(canvas.getByTestId("custom-shipment-handover-open")).toBeVisible();
    await expect(customShipmentCalls).toEqual([{ rpc: "CustomShipmentPicked", id: 801n }]);
    await expect(canvas.getByTestId("custom-shipment-timeline-awaiting")).toHaveTextContent("Waiting for the handover");
  },
};

// A RESHIP'S UNITS WERE NEVER ON A RACK (a-restocks-broken-units-are-just-broken-for-now): no rack column — the page names
// the restock and the broken note written at Terima, and the scans are the same.
export const AReshipPicksTheBrokenUnits: Story = {
  name: "A reship picks the broken units",
  render: () => <At803 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-detail-kind")).toHaveTextContent("Back to supplier");
    await expect(canvas.getByTestId("custom-shipment-lines-broken-hint")).toHaveTextContent("Broken units of restock #512 — never on a rack.");
    await expect(canvas.getByTestId("custom-shipment-broken-76")).toHaveTextContent("Botol pecah");
    await expect(canvas.queryByTestId("custom-shipment-rack-76-42")).toBeNull();
    await expect(canvas.getByTestId("custom-shipment-qty-76")).toHaveTextContent("4");
    await expect(canvas.getByTestId("custom-shipment-detail-recipient")).toHaveTextContent("CV Cahaya Abadi");
    await expect(canvas.getByTestId("pick-scan")).toBeVisible();
  },
};

// THE HANDOVER ASKS THE WAREHOUSE'S COST — Gudang bayar: the dialog open, the courier read off the parcel, the cost and the
// resi typed; nothing is sent until Serahkan.
export const TheHandoverAsksTheCost: Story = {
  name: "The handover asks the cost",
  render: () => <At808 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-handover-open"));
    const dialog = within(await screen.findByTestId("custom-shipment-handover"));
    await waitFor(() => expect(dialog.getByTestId("custom-shipment-handover-owed")).toHaveTextContent("Toko Melati"));
    await typeInto(dialog.getByTestId("custom-shipment-handover-cost"), "12000");
    await typeInto(dialog.getByTestId("custom-shipment-handover-resi"), "JNE0098125555");
    await expect(screen.getByTestId("confirm-action")).toBeEnabled();
    await expect(customShipmentCalls).toEqual([]);
  },
};

// GUDANG BAYAR — THE REAL COST, TYPED AT THE HANDOVER: required (an empty field is not a 0), 0 allowed, billed to the team
// through Team Balance; the resi is optional. The parcel is then done, and the trail says what the warehouse paid.
export const HandoverTypesTheCost: Story = {
  name: "Handover types the cost",
  render: () => <At808 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await userEvent.click(canvas.getByTestId("custom-shipment-handover-open"));
    const dialog = within(await screen.findByTestId("custom-shipment-handover"));
    await waitFor(() => expect(dialog.getByTestId("custom-shipment-handover-owed")).toHaveTextContent("Billed to Toko Melati through Team Balance. 0 is allowed."));
    await expect(screen.getByTestId("confirm-action")).toBeDisabled();

    const cost = dialog.getByTestId("custom-shipment-handover-cost");
    await typeInto(cost, "0");
    await expect(screen.getByTestId("confirm-action")).toBeEnabled();
    await typeInto(cost, "12000");
    await typeInto(dialog.getByTestId("custom-shipment-handover-resi"), "JNE0098125555");
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Handed over"));
    await expect(customShipmentCalls).toEqual([
      { rpc: "CustomShipmentHandover", id: 808n, shippingCost: 12000, resi: "JNE0098125555" },
    ]);
    await expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Rp 12.000 — billed to Toko Melati");
    await expect(canvas.getByTestId("custom-shipment-detail-resi")).toHaveTextContent("JNE0098125555");
    await expect(canvas.getByTestId("custom-shipment-timeline")).toHaveTextContent(
      "The warehouse paid Rp 12.000 — owed back through Team Balance",
    );
    await expect(canvas.queryByTestId("custom-shipment-timeline-awaiting")).toBeNull();
  },
};

// KAMI BAYAR — the team pays the courier itself: the handover takes NO cost and says the warehouse does not pay; the
// team's amount is never shown here (the-warehouse-sees-the-ongkir-it-paid).
export const HandoverWhenTheTeamPays: Story = {
  name: "Handover when the team pays",
  render: () => <At802 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Paid by the team — not the warehouse's"));
    await expect(canvas.getByTestId("custom-shipment-parcel-card")).not.toHaveTextContent("18.000");
    await expect(canvas.queryByTestId("custom-shipment-detail-account")).toBeNull();

    await userEvent.click(canvas.getByTestId("custom-shipment-handover-open"));
    await waitFor(() =>
      expect(screen.getByTestId("custom-shipment-handover-team-pays")).toHaveTextContent("Toko Melati pays this courier — the warehouse does not pay."),
    );
    await expect(screen.queryByTestId("custom-shipment-handover-cost")).toBeNull();
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Handed over"));
    await expect(customShipmentCalls).toEqual([{ rpc: "CustomShipmentHandover", id: 802n, shippingCost: undefined, resi: "" }]);
  },
};

// ANOTHER WAREHOUSE'S PARCEL reads as not found — 806 ships from Gudang Cabang.
export const AnotherWarehousesParcelIsNotFound: Story = {
  name: "Another warehouse's parcel is not found",
  render: () => <At806 />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("custom-shipment-not-found")).toBeVisible();
  },
};

export const Live: Story = {
  name: "Live · not available",
  parameters: { live: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByTestId("custom-shipment-unavailable")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-pick-page")).toBeNull();
  },
};
