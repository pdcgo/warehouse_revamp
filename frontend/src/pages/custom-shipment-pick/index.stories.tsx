import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentScenario, customShipmentWrites } from "../../../.storybook/customShipmentScenario";
import { PHONE, WAREHOUSE_META, clearToasts, moneySent, typeInto, warehouseAt } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// THE WAREHOUSE'S PAGE FOR ONE PARCEL, Gudang Pusat (11), live through the stub transport: CustomShipmentDetail as the
// warehouse (no seller money), the sample's racks from StockPickLocations by its take, the item scans and Sudah Diambil
// (CustomShipmentPicked) — the order pick page's own — then Serahkan ke Kurir (CustomShipmentHandover), typing the real
// ongkir when the warehouse pays (the-courier-is-paid-by-the-team-or-by-the-warehouse, 🔄 A).
//
//   801  sample, requested, Gudang bayar — 3 Beras on A-01-1, a note from the team
//   803  reship, requested — 4 broken Kecap of restock 512, to CV Cahaya Abadi
//   808  sample, picked, Gudang bayar — the handover types the cost
//   802  sample, picked, Kami bayar — the handover takes no cost
//   805  reship, handed over, Kami bayar — the team edited its cost while picked

const At801 = warehouseAt("/inventories/custom-shipments/801");
const At803 = warehouseAt("/inventories/custom-shipments/803");
const At808 = warehouseAt("/inventories/custom-shipments/808");
const At802 = warehouseAt("/inventories/custom-shipments/802");
const At805 = warehouseAt("/inventories/custom-shipments/805");
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

const writes = () => customShipmentWrites().map((c) => ({ rpc: c.rpc, ...c.req }));

// A SAMPLE TO PICK: the team's note first (read before the walk), then the pick list — each line's racks as its take
// drew them (StockPickLocations) — then the scans. No value anywhere, and the parcel says the warehouse pays the courier
// and bills the team.
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

// THE RACKS ARE THE TAKE'S — a two-product sample lists every rack each line's take drew from, each with its count.
export const EachLineNamesTheRacksItsTakeDrew: Story = {
  name: "Each line names the racks its take drew",
  render: () => <At802 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-rack-74-41")).toHaveTextContent("A-01-1×2");
    await expect(canvas.getByTestId("custom-shipment-rack-75-42")).toHaveTextContent("A-01-2×4");
  },
};

// THE ITEM SCANS, THEN SUDAH DIAMBIL — the order's own (the-item-scans-live-on-the-page): every unit by its product code,
// Set Picked on only when every line is exact, one write as the warehouse — requested → picked; then Serahkan ke Kurir.
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
    await expect(writes()).toEqual([expect.objectContaining({ rpc: "CustomShipmentPicked", teamId: 11n, id: 801n })]);
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
    await expect(customShipmentWrites()).toEqual([]);
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
    await expect(writes()).toEqual([
      expect.objectContaining({ rpc: "CustomShipmentHandover", teamId: 11n, id: 808n, shippingCost: 12000, resi: "JNE0098125555" }),
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
// team's amount is never shown here, nor sent (the-warehouse-sees-the-ongkir-it-paid).
export const HandoverWhenTheTeamPays: Story = {
  name: "Handover when the team pays",
  render: () => <At802 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Paid by the team — not the warehouse's"));
    await expect(canvas.getByTestId("custom-shipment-parcel-card")).not.toHaveTextContent("18.000");
    await expect(canvas.queryByTestId("custom-shipment-detail-account")).toBeNull();
    await expect(moneySent("CustomShipmentDetail", 11n, 802n)).toEqual({
      total: undefined,
      itemTotals: [undefined, undefined],
      financeAccountId: 0n,
      shippingCost: undefined,
    });

    await userEvent.click(canvas.getByTestId("custom-shipment-handover-open"));
    await waitFor(() =>
      expect(screen.getByTestId("custom-shipment-handover-team-pays")).toHaveTextContent("Toko Melati pays this courier — the warehouse does not pay."),
    );
    await expect(screen.queryByTestId("custom-shipment-handover-cost")).toBeNull();
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Handed over"));
    await expect(writes()).toEqual([expect.objectContaining({ rpc: "CustomShipmentHandover", teamId: 11n, id: 802n, resi: "" })]);
    // No cost at all — the field is unset, never a 0 on the team's behalf.
    await expect(customShipmentWrites()[0]?.req.shippingCost).toBeUndefined();
  },
};

// THE COST EDIT REACHES THE WAREHOUSE WITHOUT ITS AMOUNTS — the server sends the trail row with no description, and the
// page draws what it was sent: the warehouse reads THAT the team edited its cost, never what to.
export const TheWarehouseReadsOnlyThatTheCostWasEdited: Story = {
  name: "The warehouse reads only that the cost was edited",
  render: () => <At805 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    const edit = canvas.getByTestId("custom-shipment-timeline").querySelector("[data-kind='edit']") as HTMLElement;
    await expect(edit).toHaveTextContent("Shipping cost changed");
    await expect(within(edit).queryByTestId(/-description$/)).toBeNull();
    await expect(canvas.getByTestId("custom-shipment-timeline")).not.toHaveTextContent("22.000");
    const sent = customShipmentScenario.answered.filter((a) => a.rpc === "CustomShipmentDetail" && a.shipment.id === 805n).at(-1);
    await expect(sent?.shipment.logs.filter((l) => l.fromStatus === l.toStatus).map((l) => l.description)).toEqual([""]);
  },
};

// A REFUSED HANDOVER SAYS WHY — the server's sentence in the toast; the parcel stays picked.
export const ARefusedHandoverSaysWhy: Story = {
  name: "A refused handover says why",
  render: () => <At802 />,
  play: async ({ canvasElement }) => {
    clearToasts();
    const canvas = await opened(canvasElement);

    customShipmentScenario.refuseNext = { rpc: "CustomShipmentHandover", message: "only a picked parcel is handed over" };
    await userEvent.click(canvas.getByTestId("custom-shipment-handover-open"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(screen.getByText("only a picked parcel is handed over")).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Picked"));
  },
};

// ANOTHER WAREHOUSE'S PARCEL reads as not found — 806 ships from Gudang Cabang (the server answers NotFound).
export const AnotherWarehousesParcelIsNotFound: Story = {
  name: "Another warehouse's parcel is not found",
  render: () => <At806 />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("custom-shipment-not-found", {}, { timeout: 4000 })).toBeVisible();
  },
};
