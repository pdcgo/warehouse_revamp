import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentCalls } from "../../../.storybook/customShipmentStory";
import { PHONE, SELLING_META, pickAccount, sellingAt, typeInto } from "../../features/customShipment/storyKit";
import { fitsTheScreen } from "../../features/warehouseTransfer/storyPhone";

// ⚠ PROTOTYPE (backlog #88) — ONE PARCEL AS ITS OWNER READS IT, Toko Melati (12) as Eko: the parcel, the goods with the
// sample's value, the team's acts in the header and the TRAIL — Diminta → Diambil → Diserahkan, or Dibatalkan.
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
    await expect(await screen.findByText("Its units go back on the racks they were taken from.")).toBeVisible();
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Cancelled"));
    await expect(customShipmentCalls).toEqual([{ rpc: "CustomShipmentCancel", id: 801n }]);
    await expect(steps(canvasElement)).toEqual(["created", "status"]);
    await expect(canvas.queryByTestId("custom-shipment-action-cancel-801")).toBeNull();
  },
};

// NO CANCEL ONCE PICKED — the goods are in the basket (no-cancel-after-the-warehouse-confirms' reason). *Kami bayar*:
// Ubah Ongkir, until the handover — the account and the cost; the trail keeps the edit as its own row.
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
    await expect(customShipmentCalls).toEqual([
      { rpc: "CustomShipmentCostSet", id: 802n, financeAccountId: BCA_GAJI, shippingCost: 21000 },
    ]);
    await expect(steps(canvasElement)).toEqual(["created", "status", "edit"]);
    await expect(canvas.getByTestId("custom-shipment-timeline")).toHaveTextContent("Rp 18.000 → Rp 21.000");
  },
};

// A RESHIP, DONE: from restock 510 to its supplier, the team paying the courier — the trail keeps the cost edit made while
// it was picked; no value (it took nothing from a rack).
export const AReshipHandedOver: Story = {
  name: "A reship handed over",
  render: () => <At805 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-restock")).toHaveTextContent("restock #510");
    await expect(canvas.getByTestId("custom-shipment-detail-recipient")).toHaveTextContent("PT Banyak Toko");
    await expect(canvas.queryByTestId("custom-shipment-value-73")).toBeNull();
    await expect(steps(canvasElement)).toEqual(["created", "status", "edit", "status"]);
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

// ANOTHER TEAM'S PARCEL reads as not found — 807 is Toko Kenanga's.
export const AnotherTeamsParcelIsNotFound: Story = {
  name: "Another team's parcel is not found",
  render: () => <At807 />,
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
    await expect(canvas.queryByTestId("custom-shipment-detail-page")).toBeNull();
  },
};
