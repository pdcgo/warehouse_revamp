import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { DESKTOP, PHONE, SELLING_META, WAREHOUSE_META, resolutionCalls, sellingAt, typeInto, warehouseAt } from "../../features/restockResolution/storyKit";

// ONE INBOUND RESHIPPING PARCEL (backlog #101, live since the-restock-resolutions-prototype-is-accepted), read by either
// side through CustomShipmentDetail (a-suppliers-reshipping-comes-in-as-a-custom-shipment): the selling team sees its
// lines priced (its price values the stock and moves no money — his rule), edits the resi until Tiba
// (CustomShipmentResiSet) and the prices until Terima (CustomShipmentPricesSet), marks it Hilang while on its way
// (CustomShipmentMarkLost); the warehouse is answered no seller price (a-warehouse-sees-no-seller-money), signs for it with
// the door charge (CustomShipmentArrive) and counts it in (CustomShipmentReceive).

const Seller901 = sellingAt("/inventories/custom-shipments/in/901");
const Warehouse901 = warehouseAt("/inventories/custom-shipments/in/901");
const Warehouse902 = warehouseAt("/inventories/custom-shipments/in/902");
const AnOutboundId = sellingAt("/inventories/custom-shipments/in/801");

const meta = {
  title: "Pages/Inventory/CustomShipment/Inbound",
  component: Seller901,
  ...SELLING_META,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function page(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("inbound-detail-page", {}, { timeout: 4000 });
  return canvas;
}

/** THE SELLER'S VIEW — #901 on its way: from the supplier to Gudang Pusat for restock #503, its line priced, its acts. */
export const TheSellersView: Story = {
  name: "Seller — on its way, priced",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await expect(canvas.getByTestId("inbound-title")).toHaveTextContent("Reshipping #901");
    await expect(canvas.getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(canvas.getByTestId("inbound-supplier")).toHaveTextContent("PT Sumber Makmur");
    await waitFor(() => expect(canvas.getByTestId("inbound-other")).toHaveTextContent("Gudang Pusat"));
    await expect(canvas.getByTestId("inbound-restock")).toHaveTextContent("Restock #503");
    await expect(canvas.getByTestId("inbound-total")).toHaveTextContent("Rp 130.000");
    await expect(canvas.getByTestId("inbound-action-edit-resi-901")).toBeVisible();
    await expect(canvas.getByTestId("inbound-action-mark-lost-901")).toBeVisible();
    await expect(canvas.getByTestId("inbound-action-edit-prices-901")).toBeVisible();
  },
};

/** UBAH RESI — until Tiba the seller corrects the tracking number. */
export const EditTheResi: Story = {
  name: "Seller — edit the resi",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await userEvent.click(canvas.getByTestId("inbound-action-edit-resi-901"));
    const dialog = within(await screen.findByRole("alertdialog", {}, { timeout: 3000 }));
    await typeInto(dialog.getByTestId("inbound-resi-input"), "JNE0000111122");
    await userEvent.click(dialog.getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("inbound-resi")).toHaveTextContent("JNE0000111122"));
    await expect(resolutionCalls().map((c) => c.rpc)).toEqual(["CustomShipmentResiSet"]);
    await expect(resolutionCalls()[0]!.req).toMatchObject({ teamId: 12n, id: 901n, resi: "JNE0000111122" });
  },
};

/** UBAH HARGA — until Terima the seller re-prices the lines (the stock's value; no money moves). */
export const EditThePrices: Story = {
  name: "Seller — edit the prices",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await userEvent.click(canvas.getByTestId("inbound-action-edit-prices-901"));
    const dialog = within(await screen.findByRole("alertdialog", {}, { timeout: 3000 }));
    await expect(dialog.getByTestId("inbound-price-74")).toHaveValue("65.000");
    await typeInto(dialog.getByTestId("inbound-price-74"), "60000");
    await userEvent.click(dialog.getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("inbound-total")).toHaveTextContent("Rp 120.000"));
    await expect(resolutionCalls().map((c) => c.rpc)).toEqual(["CustomShipmentPricesSet"]);
    await expect(resolutionCalls()[0]!.req).toMatchObject({ teamId: 12n, id: 901n, lines: [{ itemId: 90101n, priceUnit: 60000 }] });
  },
};

/** TANDAI HILANG — the parcel never came: Hilang, its reason in the trail; no act is left. */
export const MarkItLost: Story = {
  name: "Seller — mark it lost",
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await userEvent.click(canvas.getByTestId("inbound-action-mark-lost-901"));
    const dialog = within(await screen.findByRole("alertdialog", {}, { timeout: 3000 }));
    await typeInto(dialog.getByTestId("inbound-lost-reason"), "Kurir tidak bisa melacak paket");
    await userEvent.click(dialog.getByTestId("confirm-action"));
    await waitFor(() => expect(canvas.getByTestId("inbound-status-lost")).toBeVisible());
    await expect(canvas.getByTestId("inbound-trail-lost")).toHaveTextContent("Kurir tidak bisa melacak paket");
    await expect(canvas.queryByTestId("inbound-action-edit-resi-901")).toBeNull();
    await expect(resolutionCalls()[0]!.req).toMatchObject({ teamId: 12n, id: 901n, reason: "Kurir tidak bisa melacak paket" });
  },
};

/**
 * THE WAREHOUSE'S VIEW — #902 at its door: no seller price; the courier's charge noted at Tiba; Terima counts it in and the
 * lines read what came: good, broken, short, the rack.
 */
export const TheWarehousesView: Story = {
  name: "Warehouse — at the door, then counted in",
  render: () => <Warehouse902 />,
  ...WAREHOUSE_META,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await expect(canvas.getByTestId("inbound-detail-page")).toHaveAttribute("data-side", "warehouse");
    await expect(canvas.getByTestId("inbound-lines")).not.toHaveTextContent("16.000");
    await expect(canvas.queryByTestId("inbound-total")).toBeNull();
    await expect(canvas.getByTestId("inbound-door-charge")).toHaveTextContent("Rp 8.000");
    await expect(canvas.getByTestId("inbound-door-charge")).toHaveTextContent("noted at Tiba");
    // A note given reads as it always did: the note, a dash, what it means.
    await expect(canvas.getByTestId("inbound-door-charge-line")).toHaveTextContent(/^Ongkir COD diminta kurir — noted at Tiba/);

    await userEvent.click(canvas.getByTestId("inbound-action-receive-902"));
    const dialog = within(await screen.findByTestId("inbound-receive-dialog", {}, { timeout: 3000 }));
    await typeInto(dialog.getByTestId("inbound-received-73"), "15");
    const trigger = dialog.getByTestId("inbound-rack-73");
    await userEvent.click(trigger);
    const option = await within(trigger.closest<HTMLElement>('[data-scope="select"][data-part="root"]')!).findByTestId("rack-select-option-41");
    await waitFor(() => expect(option).toBeVisible());
    await userEvent.click(option);
    await waitFor(() => expect(dialog.getByTestId("inbound-receive-confirm")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("inbound-receive-confirm"));

    await waitFor(() => expect(canvas.getByTestId("inbound-status-received")).toBeVisible());
    await expect(canvas.getByTestId("inbound-good-73")).toHaveTextContent("15");
    await expect(canvas.getByTestId("inbound-shortcount-73")).toHaveTextContent("0");
    await waitFor(() => expect(canvas.getByTestId("inbound-lines")).toHaveTextContent("A-01-1"));
    await expect(canvas.getByTestId("inbound-door-charge")).toHaveTextContent("owes it back");
  },
};

/**
 * A CHARGE WITH NO NOTE (the-couriers-charge-note-is-optional) — #901 set arrived with Rp 5.000 and nothing for what it was
 * for: the page reads the amount, and its line starts at what it means — no dangling dash before it.
 */
export const AChargeWithNoNote: Story = {
  name: "Warehouse — a charge with no note",
  render: () => <Warehouse901 />,
  ...WAREHOUSE_META,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await userEvent.click(await canvas.findByTestId("inbound-action-sign-901"));
    const dialog = within(await screen.findByRole("alertdialog", {}, { timeout: 3000 }));
    await userEvent.click(dialog.getByTestId("inbound-sign-courier-asked-yes"));
    await typeInto(await dialog.findByTestId("inbound-sign-courier-charge"), "5000");
    await waitFor(() => expect(dialog.getByTestId("confirm-action")).toBeEnabled());
    await userEvent.click(dialog.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("inbound-door-charge")).toHaveTextContent("Rp 5.000"));
    await expect(canvas.getByTestId("inbound-door-charge-line")).toHaveTextContent(/^noted at Tiba — final at count-in$/);
  },
};

/** ON A PHONE — the header one row (back, number, step, ⋯), the kind under it; nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the seller's page",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await page(canvasElement);
    await expect(canvas.getByTestId("inbound-title")).toHaveTextContent("#901");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** NOT AN INBOUND PARCEL — an outbound parcel's id reads as not found here (its own page is the custom-shipment detail). */
export const AnOutboundIdIsNotFound: Story = {
  name: "Not found — an outbound parcel's id",
  render: () => <AnOutboundId />,
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByTestId("inbound-not-found")).toBeVisible(), { timeout: 4000 });
  },
};
