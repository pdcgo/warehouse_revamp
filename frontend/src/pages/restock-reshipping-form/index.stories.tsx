import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { inboundById } from "../../../.storybook/restockResolutionScenario";
import { RestockResolutionType } from "../../gen/warehouse/inventory/v1/restock_resolution_pb";
import { pickCourier } from "../../features/customShipment/storyKit";
import {
  DESKTOP,
  PHONE,
  SELLING_META,
  WAREHOUSE_META,
  recordMenu,
  resolutionCalls,
  resolutionTypes,
  sellingAt,
  typeInto,
} from "../../features/restockResolution/storyKit";

// KIRIMAN ULANG DARI SUPPLIER (backlog #101, live since the-restock-resolutions-prototype-is-accepted): recording a
// `reshipping` creates its INBOUND custom shipment in the same step (a-suppliers-reshipping-comes-in-as-a-custom-shipment,
// 🔄 *"A"*) — RestockResolutionCreate RESHIPPING with its `reshipping` parcel: the lines (product, count, price — opened
// on the restock's problem at its unit price, every one free to change), the courier, the resi (may follow), the
// warehouse (opening on the restock's), the resolution's note; the supplier is the server's pick (0 — the one every
// restock line names). Saved, the restock's Resolusi has the row and the parcel is on its way to the warehouse's
// incoming list. Route: /inventories/restock/:requestId/reshipping.

const At503 = sellingAt({ pathname: "/inventories/restock/503/reshipping", state: { from: "/inventories/restock/503" } });
const At504 = sellingAt({ pathname: "/inventories/restock/504/reshipping", state: { from: "/inventories/restock/504" } });
const FromThe503 = sellingAt("/inventories/restock/503");

const meta = {
  title: "Pages/Inventory/Restock/ReshippingForm",
  component: At503,
  ...SELLING_META,
  globals: DESKTOP,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  return { canvas, form: within(await canvas.findByTestId("reshipping-form", {}, { timeout: 4000 })) };
}

/**
 * OPENED ON THE PROBLEM — 503's Beras: 2 broken + 1 missing = 3, at the line's Rp 65.000; the warehouse opens on Gudang
 * Pusat; the ready line waits for the courier; the resi may follow.
 */
export const OpenedOnTheProblem: Story = {
  name: "Opens on the restock's problem",
  play: async ({ canvasElement }) => {
    const { form } = await opened(canvasElement);
    await expect(form.getByTestId("reshipping-product-74")).toHaveTextContent("Beras Pandan Wangi 5kgSKU-BERAS-5K");
    await expect(form.getByTestId("reshipping-count-74")).toHaveValue("3");
    await expect(form.getByTestId("reshipping-price-74")).toHaveValue("65.000");
    await waitFor(() => expect(within(form.getByTestId("reshipping-warehouse")).getByRole("combobox")).toHaveValue("Gudang Pusat"), { timeout: 4000 });
    await expect(form.getByTestId("reshipping-ready-missing")).toHaveTextContent("courier");
    await expect(form.getByTestId("reshipping-save")).toBeDisabled();
  },
};

/**
 * THE WHOLE STEP, FROM THE RESTOCK — Catat Resolusi → Kirim Ulang, the count changed to 2, a courier and a resi, a note;
 * saved, back on 503 the Resolusi holds the reshipping row with its new inbound parcel on its way; ONE write.
 */
export const RecordFromTheRestock: Story = {
  name: "Record — from the restock and back",
  parameters: { resolutionSeed: "empty" },
  render: () => <FromThe503 />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("restock-detail-resolutions-section", {}, { timeout: 4000 });
    await recordMenu(canvas);
    await userEvent.click(screen.getByTestId("resolution-record-reshipping"));

    const { form } = await opened(canvasElement);
    await typeInto(form.getByTestId("reshipping-count-74"), "2");
    await pickCourier(canvasElement, "jne");
    await typeInto(form.getByTestId("reshipping-resi"), "JNE7788990011");
    await typeInto(form.getByTestId("reshipping-note"), "Supplier ganti 2 karung yang sobek");
    await waitFor(() => expect(form.getByTestId("reshipping-save")).toBeEnabled());
    await userEvent.click(form.getByTestId("reshipping-save"));

    const box = within(await canvas.findByTestId("restock-detail-resolutions-section", {}, { timeout: 4000 }));
    await waitFor(() => expect(resolutionTypes(canvasElement)).toEqual(["RESHIPPING"]));
    const calls = resolutionCalls();
    await expect(calls.map((c) => c.rpc)).toEqual(["RestockResolutionCreate"]);
    await expect(calls[0]!.req).toMatchObject({
      teamId: 12n,
      restockId: 503n,
      type: RestockResolutionType.RESHIPPING,
      note: "Supplier ganti 2 karung yang sobek",
      reshipping: {
        warehouseId: 11n,
        shipmentChannelId: 91n,
        resi: "JNE7788990011",
        supplierId: 0n,
        lines: [{ productId: 74n, count: 2n, priceUnit: 65000 }],
      },
    });
    const parcel = inboundById(951n);
    await expect(parcel).toMatchObject({ restockId: 503n, supplierId: 31n, warehouseId: 11n });
    await waitFor(() => expect(box.getByTestId("resolution-row-101-parcel")).toHaveTextContent("Reshipping #951"));
    await expect(within(box.getByTestId("resolution-row-101-parcel")).getByTestId("inbound-status-on_the_way")).toBeVisible();
    await expect(box.getByTestId("resolution-row-101-parcel")).toHaveTextContent("JNE7788990011");
  },
};

/** A LINE OFF, ANOTHER ON — every line can go; an empty line asks for its product before the save. */
export const LinesChange: Story = {
  name: "Lines — remove one, add one",
  play: async ({ canvasElement }) => {
    const { form } = await opened(canvasElement);
    await userEvent.click(form.getByTestId("reshipping-remove-74"));
    await expect(form.queryByTestId("reshipping-line-74")).toBeNull();
    await userEvent.click(form.getByTestId("reshipping-add-line"));
    await expect(form.getByTestId("reshipping-line-0")).toBeVisible();
    await expect(form.getByTestId("reshipping-ready-missing")).toHaveTextContent("a product on every line");
  },
};

/** A LOST RESTOCK — the whole line is owed: 504's 40 Gula at Rp 16.000. */
export const ALostRestock: Story = {
  name: "Lost restock — opens on every unit",
  render: () => <At504 />,
  play: async ({ canvasElement }) => {
    const { form } = await opened(canvasElement);
    await expect(form.getByTestId("reshipping-count-73")).toHaveValue("40");
    await expect(form.getByTestId("reshipping-price-73")).toHaveValue("16.000");
  },
};

/** ON A PHONE — the fields stack, nothing runs off. */
export const OnAPhone: Story = {
  name: "Phone — the form",
  globals: PHONE,
  play: async ({ canvasElement }) => {
    await opened(canvasElement);
    await expect(window.innerWidth).toBe(390);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** NOT THE WAREHOUSE'S — a warehouse reaching the address reads the one line, and reads nothing. */
export const AWarehouseReadsNothing: Story = {
  name: "Warehouse — not its form",
  ...WAREHOUSE_META,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByTestId("reshipping-unavailable", {}, { timeout: 4000 })).toBeVisible();
  },
};
