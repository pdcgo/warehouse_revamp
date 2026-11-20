import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";

import { asTeam } from "../../../../.storybook/pageStory";
import { asRole } from "../../../../.storybook/sessionScenario";
import { Role } from "../../../gen/warehouse/role_base/v1/role_pb";
import { PHONE, SELLING_META, sellingAt, warehouseAt } from "../../../features/customShipment/storyKit";
import { seedGoodsMissing } from "../../../features/customShipment/goodsMissingStoryKit";
import { fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";

// *BARANG TIDAK KETEMU* — backlog #88 P6, `missing-goods-leave-a-note-on-the-custom-shipment`, LIVE: the LISTS.
// Toko Melati (12) on its *Kirim Paket* list, the warehouse's notes seeded into the stub (goodsMissingStoryKit — on 801
// and 803, Diminta, and on 806, cancelled after its note). Each list row carries the server's `goods_missing` — the open
// note, the latest while requested — which is what the badge reads (the-goods-missing-badge-is-on-both-lists).
//
// What it pins: the *Barang tidak ketemu* badge beside the status — on the status line, as the order list's *No settlement
// account* badge (the-settlement-missing-badge-is-accepted) — only while the parcel is Diminta; on a phone its own line in
// the block; the warehouse's queue carries it too.

const Selling = sellingAt("/inventories/custom-shipments");
const Warehouse = warehouseAt("/inventories/custom-shipments");

const meta = {
  title: "Pages/Inventory/CustomShipment/SellingList/GoodsMissing",
  component: Selling,
  ...SELLING_META,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The three notes most stories open with — 801 and 803 still Diminta, 806 cancelled after its note. */
const noted = () => {
  seedGoodsMissing("801", "803", "806");
};

async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-row-801", {}, { timeout: 4000 });
  return canvas;
}

const badged = (canvasElement: HTMLElement) =>
  Array.from(canvasElement.querySelectorAll("[data-testid^='custom-shipment-goods-missing-']"))
    .map((el) => el.getAttribute("data-testid")!.replace("custom-shipment-goods-missing-", ""))
    .sort();

// THE TEAM'S LIST — the badge beside Diminta on the two parcels the warehouse cannot fill, on the same line (a cell is at
// most two lines: the number, then the status). 806 was cancelled after its note: no badge — nothing waits on the team.
export const Default: Story = {
  beforeEach: noted,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await waitFor(() => expect(badged(canvasElement)).toEqual(["801", "803"]));
    await expect(canvas.getByTestId("custom-shipment-goods-missing-801")).toHaveTextContent("Goods missing");
    const status = canvas.getByTestId("custom-shipment-row-801").querySelector("[data-testid='custom-shipment-status-requested']")!;
    const badge = canvas.getByTestId("custom-shipment-goods-missing-801");
    await expect(Math.abs(status.getBoundingClientRect().top - badge.getBoundingClientRect().top)).toBeLessThan(4);
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-806")).toBeNull();
    // Batalkan is still the team's, on the row's ⋯.
    await expect(canvas.getByTestId("custom-shipment-actions-801")).toBeVisible();
  },
};

// ON A PHONE the badge is a line of its own in the block, under the number and the status.
export const Mobile: Story = {
  globals: PHONE,
  beforeEach: noted,
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await waitFor(() => expect(badged(canvasElement)).toEqual(["801", "803"]));
    const block = canvas.getByTestId("custom-shipment-row-801");
    await expect(within(block).getByTestId("custom-shipment-goods-missing-801")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// THE WAREHOUSE'S QUEUE CARRIES IT TOO — so a second picker does not walk for goods already reported
// (the-goods-missing-badge-is-on-both-lists). Toko Melati's 806 ships from Gudang Cabang and is not on this queue at all.
export const OnTheWarehousesQueueToo: Story = {
  name: "On the warehouse's queue too",
  render: () => <Warehouse />,
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_ADMIN)();
    noted();
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("custom-shipments-warehouse")).toBeVisible();
    await waitFor(() => expect(badged(canvasElement)).toEqual(["801", "803"]));
  },
};

// PICKED AFTER ITS NOTE, NO BADGE — 802 was noted while Diminta, then the goods turned up and it was picked: nothing waits
// on the team, so neither list draws the badge (the trail keeps the note). No other parcel is noted.
export const PickedAfterItsNoteNoBadge: Story = {
  name: "Picked after its note · no badge",
  beforeEach: () => {
    seedGoodsMissing("802");
  },
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-row-802")).toBeVisible();
    await expect(badged(canvasElement)).toEqual([]);
  },
};
