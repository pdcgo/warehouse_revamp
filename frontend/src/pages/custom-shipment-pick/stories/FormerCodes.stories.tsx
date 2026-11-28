import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { customShipmentWrites } from "../../../../.storybook/customShipmentScenario";
import { productCodeScenario, scanCodesForStory } from "../../../../.storybook/productCodeScenario";
import { WAREHOUSE_META, warehouseAt } from "../../../features/customShipment/storyKit";

// THE CUSTOM SHIPMENT'S PICK PAGE — A PRODUCT'S FORMER CODES STILL FIND IT (backlog #152, #141 P4 —
// a-team-code-change-recomposes-its-product-codes, its 🔄 *an old sticker scanned before the reprint*, owner Q1 "A": "the
// pick page's scan (ItemScan, the custom-shipment pick too)"). The order pick page's own item scan, fed the parcel's
// lines and its products' codes now and former codes — read once for the page, beside the racks (ProductCodesByIds,
// .storybook/productCodeStub.ts).
//
//   801  sample, Diminta, Gudang Pusat (11) — 3 Beras Pandan Wangi 5kg, its line written as SKU-BERAS-5K (product 74)

const At801 = warehouseAt("/inventories/custom-shipments/801");

const meta = {
  title: "Pages/Inventory/CustomShipment/Pick/FormerCodes",
  component: At801,
  ...WAREHOUSE_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function scanning(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("pick-scan", {}, { timeout: 4000 });
  return { canvas, input: canvas.getByTestId("pick-scan-input") };
}

async function scan(input: HTMLElement, code: string) {
  await userEvent.type(input, `${code}{Enter}`, { delay: 10 });
}

/**
 * THE PARCEL ASKED BEFORE THE CHANGE, THE NEW STICKER AND THE OLD: Beras is SL-01-BERAS-5K now and was SKU-BERAS-5K (the
 * code its line keeps) — a unit with either sticker counts, another product's code does not, and Sudah Diambil is the
 * one write. One read of the codes for the page, none per scan.
 */
export const BothStickersCount: Story = {
  name: "Old and new stickers count",
  beforeEach: scanCodesForStory(74n, "SL-01-BERAS-5K", "SKU-BERAS-5K"),
  play: async ({ canvasElement }) => {
    const { canvas, input } = await scanning(canvasElement);
    const setPicked = canvas.getByTestId("pick-order-set-picked");

    await scan(input, "SL-01-BERAS-5K");
    await scan(input, "sl-01-beras-5k");
    await scan(input, "SKU-TEH-100");
    await waitFor(() => expect(canvas.getByTestId("pick-scan-problem")).toHaveTextContent("Not on this order: SKU-TEH-100"));
    await expect(setPicked).toBeDisabled();

    await scan(input, "SKU-BERAS-5K");
    await waitFor(() => expect(setPicked).toBeEnabled());
    await expect(canvas.queryByTestId("pick-scan-problem")).toBeNull();

    await userEvent.click(setPicked);
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Picked"), { timeout: 5000 });
    await expect(customShipmentWrites().map((c) => ({ rpc: c.rpc, ...c.req }))).toEqual([
      expect.objectContaining({ rpc: "CustomShipmentPicked", teamId: 11n, id: 801n }),
    ]);

    // Asked once while Diminta, with the parcel's one product; the re-read after Sudah Diambil asks none (picked).
    await expect(productCodeScenario.calls).toEqual([{ teamId: 11n, productIds: [74n] }]);
  },
};
