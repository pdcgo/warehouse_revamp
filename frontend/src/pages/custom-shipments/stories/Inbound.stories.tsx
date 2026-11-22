import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { customShipmentScenario } from "../../../../.storybook/customShipmentScenario";
import { CustomShipmentKind } from "../../../gen/warehouse/inventory/v1/custom_shipment_pb";
import { DESKTOP, PHONE, SELLING_META, sellingAt } from "../../../features/restockResolution/storyKit";

// KIRIM PAKET · THE INBOUND ONES (backlog #101, live since the-restock-resolutions-prototype-is-accepted). Custom shipments
// go both ways now (a-suppliers-reshipping-comes-in-as-a-custom-shipment): the seller's list carries its inbound
// reshipping parcels beside the outbound ones — the server's list answers the selling team both ways when no direction is
// asked — under Semua (their steps are a restock box's, Dalam Perjalanan → Tiba → Diterima / Hilang, not the outbound
// tabs') and as a third kind in the Kind filter (SUPPLIER_RESHIPPING); each from its supplier, for its restock, valued at
// the seller's price. A row opens the parcel's page.

const AllOfThem = sellingAt("/inventories/custom-shipments");
const InboundOnly = sellingAt("/inventories/custom-shipments?kind=reshipping");
const Requested = sellingAt("/inventories/custom-shipments?status=requested");

const meta = {
  title: "Pages/Inventory/CustomShipment/List/Inbound",
  component: AllOfThem,
  ...SELLING_META,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** SEMUA — #901 and #902 on top, the outbound parcels under them; each inbound row its kind, its supplier and restock. */
export const BesideTheOutbound: Story = {
  name: "All — inbound beside outbound",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = within(await canvas.findByTestId("custom-shipment-row-in-901", {}, { timeout: 4000 }));
    await expect(row.getByTestId("custom-shipment-kind-reshipping")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-row-in-901")).toHaveTextContent("From PT Sumber Makmur");
    await expect(canvas.getByTestId("custom-shipment-row-in-901")).toHaveTextContent("for restock #503");
    await expect(canvas.getByTestId("inbound-value-901")).toHaveTextContent("Rp 130.000");
    await expect(within(canvas.getByTestId("custom-shipment-row-in-902")).getByTestId("inbound-status-arrived")).toBeVisible();
    await expect(await canvas.findByTestId("custom-shipment-row-801", {}, { timeout: 4000 })).toBeVisible();
  },
};

/** A ROW OPENS ITS PARCEL — the inbound parcel's own page. */
export const ARowOpensItsParcel: Story = {
  name: "All — a row opens its parcel",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("custom-shipment-row-in-901", {}, { timeout: 4000 }));
    await expect(await canvas.findByTestId("inbound-detail-page", {}, { timeout: 3000 })).toBeVisible();
  },
};

/** THE KIND FILTER — *Reshipping from supplier* lists the inbound parcels alone: SUPPLIER_RESHIPPING asked of the server. */
export const TheInboundKind: Story = {
  name: "Kind — reshipping from supplier only",
  render: () => <InboundOnly />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("custom-shipment-row-in-901", {}, { timeout: 4000 });
    await waitFor(() => expect(canvas.queryByTestId("custom-shipment-row-801")).toBeNull());
    await expect(canvas.getByTestId("custom-shipment-kind")).toHaveTextContent("Reshipping from supplier");
    const asked = customShipmentScenario.calls.filter((c) => c.rpc === "CustomShipmentList").at(-1);
    await expect((asked?.req.filter as { kind?: number } | undefined)?.kind).toBe(CustomShipmentKind.SUPPLIER_RESHIPPING);
  },
};

/** AN OUTBOUND TAB — Diminta holds no inbound parcel. */
export const NotUnderAnOutboundTab: Story = {
  name: "Diminta — no inbound parcel",
  render: () => <Requested />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("custom-shipment-row-801", {}, { timeout: 4000 });
    await expect(canvas.queryByTestId("custom-shipment-row-in-901")).toBeNull();
  },
};

/** ON A PHONE — blocks, the inbound ones first. */
export const OnAPhone: Story = {
  name: "Phone — the inbound blocks",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("custom-shipment-row-in-901", {}, { timeout: 4000 });
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
