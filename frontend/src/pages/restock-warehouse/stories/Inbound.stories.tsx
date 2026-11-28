import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { isSettled, settledForStory, settlementKindsOf } from "../../../../.storybook/restockResolutionScenario";
import { takeProblemTagsOff } from "../../../../.storybook/restockTagScenario";
import { CustomShipmentDirection } from "../../../gen/warehouse/inventory/v1/custom_shipment_pb";
import { RestockLogKind } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { DESKTOP, PHONE, WAREHOUSE_META, resolutionCalls, typeInto, warehouseAt } from "../../../features/restockResolution/storyKit";
import { customShipmentScenario } from "../../../../.storybook/customShipmentScenario";

// RESTOK MASUK · INBOUND RESHIPPING PARCELS (backlog #101, live since the-restock-resolutions-prototype-is-accepted). A
// supplier's reshipping is an INBOUND custom shipment the warehouse sees in its incoming list like a restock on its way
// (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 *"A"*) — asked for with `direction` INBOUND (a warehouse's
// custom-shipment queue stays what it ships): a row per parcel in the tab of its step, marked *Reshipping from supplier*,
// naming the restock it settles; *Tandai Tiba* (the door charge noted) and *Terima* (the count: what is in the box,
// broken among it, the good units' rack; the charge final) on the row. No seller price anywhere — the server answers none.
//
// The seed: #901 (503's, on its way, 2 Beras by JNE) and #902 (504's, at the door, 15 Gula, Rp 8.000 noted at Tiba).

const Incoming = warehouseAt("/inventories/restock");
const OnItsWay = warehouseAt("/inventories/restock?status=ongoing");

const meta = {
  title: "Pages/Inventory/Restock/RestockWarehouse/Inbound",
  component: Incoming,
  ...WAREHOUSE_META,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function listed(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("inbound-row-901", {}, { timeout: 4000 });
  return canvas;
}

async function pickRack(productId: bigint, rackId: bigint) {
  const trigger = await screen.findByTestId(`inbound-rack-${productId}`);
  const root = trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!;
  await userEvent.click(trigger);
  const option = await within(root).findByTestId(`rack-select-option-${rackId}`, {}, { timeout: 3000 });
  await waitFor(() => expect(option).toBeVisible());
  await userEvent.click(option);
}

/** IN THE INCOMING LIST — the two parcels on top of the restocks, their steps and acts; no seller price on the row. */
export const InTheIncomingList: Story = {
  name: "Incoming list — the reshipping parcels",
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    const row901 = within(canvas.getByTestId("inbound-row-901"));
    await expect(row901.getByTestId("custom-shipment-kind-reshipping")).toHaveTextContent("Reshipping from supplier");
    await waitFor(() => expect(row901.getByTestId("inbound-for-901")).toHaveTextContent("for restock #503 · Toko Melati"));
    await expect(row901.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(row901.getByTestId("inbound-action-sign-901")).toHaveTextContent("Set Arrived");
    await expect(within(canvas.getByTestId("inbound-row-902")).getByTestId("inbound-action-receive-902")).toHaveTextContent("Count In");
    await expect(canvas.getByTestId("inbound-row-901")).not.toHaveTextContent("65.000");
    await expect(canvas.getByTestId("restock-row-501")).toBeVisible();
    // Asked for as INBOUND — the warehouse sees the parcels coming in only when it asks for them.
    const asked = customShipmentScenario.calls.filter((c) => c.rpc === "CustomShipmentList").at(-1);
    await expect((asked?.req.filter as { direction?: number } | undefined)?.direction).toBe(CustomShipmentDirection.INBOUND);
  },
};

/** THE TABS — a parcel sits in the tab of its step, as a restock box: Dalam Perjalanan holds #901, not #902. */
export const ByItsStep: Story = {
  name: "Tabs — a parcel in the tab of its step",
  render: () => <OnItsWay />,
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    await expect(canvas.queryByTestId("inbound-row-902")).toBeNull();
    await userEvent.click(canvas.getByTestId("restock-tab-arrived"));
    await canvas.findByTestId("inbound-row-902", {}, { timeout: 3000 });
    await expect(canvas.queryByTestId("inbound-row-901")).toBeNull();
  },
};

/** TANDAI TIBA — the courier asked Rp 5.000 at the door: noted, kept, the row moves to Tiba and offers Terima. */
export const SignForItWithACharge: Story = {
  name: "Tandai Tiba — with the courier's charge",
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    await userEvent.click(canvas.getByTestId("inbound-action-sign-901"));
    const dialog = within(await screen.findByRole("alertdialog", {}, { timeout: 3000 }));
    await userEvent.click(dialog.getByTestId("inbound-sign-courier-asked-yes"));
    await typeInto(dialog.getByTestId("inbound-sign-courier-charge"), "5000");
    await typeInto(dialog.getByTestId("inbound-sign-courier-note"), "COD diminta kurir");
    await userEvent.click(dialog.getByTestId("confirm-action"));

    await waitFor(() => expect(within(canvas.getByTestId("inbound-row-901")).getByTestId("inbound-status-arrived")).toBeVisible());
    await expect(canvas.getByTestId("inbound-action-receive-901")).toBeVisible();
    await expect(resolutionCalls().map((c) => c.rpc)).toEqual(["CustomShipmentArrive"]);
    await expect(resolutionCalls()[0]!.req).toMatchObject({ teamId: 11n, id: 901n, doorCharge: 5000, doorChargeNote: "COD diminta kurir" });
  },
};

/**
 * SET ARRIVED WITH A CHARGE AND NO NOTE (the-couriers-charge-note-is-optional; an-arrival-is-set-arrived): the dialog is
 * *Set Arrived — Reshipping #901*; on Ada the amount alone frees it, and the parcel is set arrived with an empty note.
 */
export const SetArrivedWithAChargeAndNoNote: Story = {
  name: "Set Arrived — a charge with no note",
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    await userEvent.click(canvas.getByTestId("inbound-action-sign-901"));
    const box = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    const dialog = within(box);
    await expect(box).toHaveTextContent("Set Arrived — Reshipping #901");
    await expect(dialog.getByTestId("confirm-action")).toHaveTextContent("Set Arrived");

    await userEvent.click(dialog.getByTestId("inbound-sign-courier-asked-yes"));
    await expect(await dialog.findByTestId("confirm-action")).toBeDisabled();
    await typeInto(dialog.getByTestId("inbound-sign-courier-charge"), "5000");
    await waitFor(() => expect(dialog.getByTestId("confirm-action")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("confirm-action"));

    await waitFor(() => expect(within(canvas.getByTestId("inbound-row-901")).getByTestId("inbound-status-arrived")).toBeVisible());
    await expect(resolutionCalls()[0]!.req).toMatchObject({ teamId: 11n, id: 901n, doorCharge: 5000, doorChargeNote: "" });
  },
};

/**
 * TERIMA — #902: the charge opens with Tiba's Rp 8.000; 14 in the box, 1 broken → 13 good to a rack, 1 short; the rack is
 * asked only for good units; counted, the row reads Diterima.
 */
export const CountItIn: Story = {
  name: "Terima — good, broken, short; the charge final",
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    await userEvent.click(canvas.getByTestId("inbound-action-receive-902"));
    const dialog = within(await screen.findByTestId("inbound-receive-dialog", {}, { timeout: 3000 }));
    await expect(dialog.getByTestId("inbound-receive-courier-charge")).toHaveValue("8.000");
    await expect(dialog.getByTestId("inbound-receive-confirm")).toBeDisabled();

    await typeInto(dialog.getByTestId("inbound-received-73"), "14");
    await typeInto(dialog.getByTestId("inbound-broken-73"), "1");
    await expect(dialog.getByTestId("inbound-short-73")).toHaveTextContent("13 good to the rack · 1 short");
    await expect(dialog.getByTestId("inbound-receive-confirm")).toBeDisabled();
    await pickRack(73n, 41n);
    await waitFor(() => expect(dialog.getByTestId("inbound-receive-confirm")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("inbound-receive-confirm"));

    await waitFor(() => expect(within(canvas.getByTestId("inbound-row-902")).getByTestId("inbound-status-received")).toBeVisible());
    await expect(resolutionCalls().map((c) => c.rpc)).toEqual(["CustomShipmentReceive"]);
    await expect(resolutionCalls()[0]!.req).toMatchObject({
      teamId: 11n,
      id: 902n,
      lines: [{ itemId: 90201n, received: 14n, broken: 1n, rackId: 41n }],
      doorCharge: 8000,
      doorChargeNote: "Ongkir COD diminta kurir",
    });
  },
};

/**
 * A SHORT TERIMA REOPENS A SETTLED RESTOCK (🔄 A) — 503 was marked settled; its reshipping #901 comes in 1 of 2: the
 * server lifts the mark and writes the Riwayat's REOPENED row (settled → reopened).
 */
export const AShortCountReopensTheRestock: Story = {
  name: "Terima — short on a settled restock reopens it",
  beforeEach: () => {
    settledForStory(503n);
    takeProblemTagsOff(503n);
  },
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    await expect(isSettled(503n)).toBe(true);
    // Tiba first (no charge at the door), then Terima.
    await userEvent.click(canvas.getByTestId("inbound-action-sign-901"));
    const sign = within(await screen.findByRole("alertdialog", {}, { timeout: 3000 }));
    await userEvent.click(sign.getByTestId("confirm-action"));
    await userEvent.click(await canvas.findByTestId("inbound-action-receive-901", {}, { timeout: 3000 }));
    const dialog = within(await screen.findByTestId("inbound-receive-dialog", {}, { timeout: 3000 }));
    await typeInto(dialog.getByTestId("inbound-received-74"), "1");
    await pickRack(74n, 41n);
    await waitFor(() => expect(dialog.getByTestId("inbound-receive-confirm")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("inbound-receive-confirm"));

    await waitFor(() => expect(within(canvas.getByTestId("inbound-row-901")).getByTestId("inbound-status-received")).toBeVisible());
    await expect(isSettled(503n)).toBe(false);
    await expect(settlementKindsOf(503n).filter((k) => k !== RestockLogKind.RESOLUTION)).toEqual([RestockLogKind.SETTLED, RestockLogKind.REOPENED]);
  },
};

/** ON A PHONE — each parcel a block, its act at its foot; nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the parcels as blocks",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await listed(canvasElement);
    await expect(canvas.getByTestId("inbound-action-sign-901")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};
