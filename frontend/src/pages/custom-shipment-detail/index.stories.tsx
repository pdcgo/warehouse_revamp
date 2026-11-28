import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentScenario, customShipmentWrites } from "../../../.storybook/customShipmentScenario";
import { PHONE, SELLING_META, clearToasts, pickAccount, sellingAt, typeInto } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// ONE PARCEL AS ITS OWNER READS IT, Toko Melati (12), live through the stub transport (CustomShipmentDetail as the
// owning team): the parcel, the goods with the sample's value, the team's acts in the header (CustomShipmentCostSet,
// CustomShipmentCancel) and the TRAIL — Diminta → Diambil → Diserahkan, or Dibatalkan.
//
//   804  sample, handed over, Gudang bayar Rp 12.000 + resi — the whole trail
//   801  sample, requested, Gudang bayar — Batalkan
//   802  sample, picked, Kami bayar (BCA Operasional, Rp 18.000) — Ubah Ongkir, no Batalkan
//   805  reship, handed over, Kami bayar — a cost edit in the trail
//   806  sample, cancelled

const At804 = sellingAt("/inventories/custom-shipments/804");
const At801 = sellingAt("/inventories/custom-shipments/801");
const At802 = sellingAt("/inventories/custom-shipments/802");
const At805 = sellingAt("/inventories/custom-shipments/805");
const At806 = sellingAt("/inventories/custom-shipments/806");
const At807 = sellingAt("/inventories/custom-shipments/807");

const meta = {
  title: "Pages/Inventory/CustomShipment/Detail",
  component: At804,
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const BCA_GAJI = 1302n;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-detail-page", {}, { timeout: 4000 });
  return canvas;
}

const steps = (canvasElement: HTMLElement) =>
  Array.from(within(canvasElement).getByTestId("custom-shipment-timeline").querySelectorAll("[data-kind]")).map((row) =>
    row.getAttribute("data-kind"),
  );

const writes = () => customShipmentWrites().map((c) => ({ rpc: c.rpc, ...c.req }));

// A PARCEL THAT IS DONE: handed over by Gudang Pusat, the courier paid by the warehouse and owed back through Team Balance,
// its resi; the goods with what they were worth; the trail requested → picked → handed over, nothing left to wait for, and
// nothing left to do.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-title")).toHaveTextContent("Parcel #804");
    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Handed over");
    await expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent(
      "Rp 12.000 — owed to the warehouse through Team Balance",
    );
    await expect(canvas.getByTestId("custom-shipment-detail-resi")).toHaveTextContent("JNE0098123456");
    await expect(canvas.getByTestId("custom-shipment-value-74")).toHaveTextContent("65.000");
    await expect(steps(canvasElement)).toEqual(["created", "status", "status"]);
    await expect(canvas.queryByTestId("custom-shipment-timeline-awaiting")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-action-cancel-804")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-action-edit-cost-804")).toBeNull();
  },
};

export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(canvas.getByTestId("custom-shipment-timeline")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// BATALKAN, WHILE NOBODY HAS TOUCHED THE GOODS — a requested parcel: confirmed, it is cancelled, its units go back on the
// racks they came from, and the trail ends there.
export const CancelWhileRequested: Story = {
  name: "Cancel while requested",
  render: () => <At801 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.queryByTestId("custom-shipment-action-edit-cost-801")).toBeNull();
    await userEvent.click(canvas.getByTestId("custom-shipment-action-cancel-801"));
    await waitFor(() => expect(screen.getByText("Its units go back on the racks they were taken from.")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Cancelled"));
    await expect(writes()).toEqual([expect.objectContaining({ rpc: "CustomShipmentCancel", teamId: 12n, id: 801n })]);
    await expect(steps(canvasElement)).toEqual(["created", "status"]);
    await expect(canvas.queryByTestId("custom-shipment-action-cancel-801")).toBeNull();
  },
};

// A REFUSED CANCEL SAYS WHY — the warehouse picked it meanwhile: the server's sentence in the toast, and the page re-reads
// the parcel as it now is.
export const ARefusedCancelSaysWhy: Story = {
  name: "A refused cancel says why",
  render: () => <At801 />,
  play: async ({ canvasElement }) => {
    clearToasts();
    const canvas = await opened(canvasElement);

    customShipmentScenario.refuseNext = { rpc: "CustomShipmentCancel", message: "only a requested parcel can be cancelled" };
    await userEvent.click(canvas.getByTestId("custom-shipment-action-cancel-801"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(screen.getByText("Not allowed in this status")).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText("only a requested parcel can be cancelled")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
  },
};

// NO CANCEL ONCE PICKED — the goods are in the basket (no-cancel-after-the-warehouse-confirms' reason). *Kami bayar*:
// Ubah Ongkir, until the handover — the account and the cost; the trail keeps the edit as its own row, with what moved.
export const WePayEditsTheCostUntilHandover: Story = {
  name: "We pay edits the cost until handover",
  render: () => <At802 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.queryByTestId("custom-shipment-action-cancel-802")).toBeNull();
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-account")).toHaveTextContent("BCA Operasional"));
    await expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Rp 18.000");

    await userEvent.click(canvas.getByTestId("custom-shipment-action-edit-cost-802"));
    const amount = await screen.findByTestId("custom-shipment-cost-amount");
    await typeInto(amount, "21000");
    await pickAccount("custom-shipment-cost-account", BCA_GAJI);
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-ongkir")).toHaveTextContent("Rp 21.000"));
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-account")).toHaveTextContent("BCA Gaji"));
    await expect(writes()).toEqual([
      expect.objectContaining({ rpc: "CustomShipmentCostSet", teamId: 12n, id: 802n, financeAccountId: BCA_GAJI, shippingCost: 21000 }),
    ]);
    await expect(steps(canvasElement)).toEqual(["created", "status", "edit"]);
    await expect(canvas.getByTestId("custom-shipment-timeline")).toHaveTextContent("Rp 18.000 → Rp 21.000");
  },
};

// A RESHIP, DONE: from restock 510 to its supplier, the team paying the courier — the trail keeps the cost edit made while
// it was picked, its amounts the team's own; no value (it took nothing from a rack).
export const AReshipHandedOver: Story = {
  name: "A reship handed over",
  render: () => <At805 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-restock")).toHaveTextContent("restock #510");
    await expect(canvas.getByTestId("custom-shipment-detail-recipient")).toHaveTextContent("PT Banyak Toko");
    await expect(canvas.queryByTestId("custom-shipment-value-73")).toBeNull();
    await expect(steps(canvasElement)).toEqual(["created", "status", "edit", "status"]);
    await expect(canvas.getByTestId("custom-shipment-timeline")).toHaveTextContent("Rp 0 → Rp 22.000");
    await expect(canvas.getByTestId("custom-shipment-timeline")).toHaveTextContent("The courier is paid by us");
  },
};

export const Cancelled: Story = {
  render: () => <At806 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Cancelled");
    await expect(canvas.queryByTestId("custom-shipment-timeline-awaiting")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-action-cancel-806")).toBeNull();
  },
};

// ANOTHER TEAM'S PARCEL reads as not found — 807 is Toko Kenanga's (the server answers NotFound).
export const AnotherTeamsParcelIsNotFound: Story = {
  name: "Another team's parcel is not found",
  render: () => <At807 />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByTestId("custom-shipment-not-found")).toBeVisible(), { timeout: 4000 });
  },
};
