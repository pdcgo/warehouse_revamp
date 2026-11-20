import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentWrites } from "../../../../.storybook/customShipmentScenario";
import { goodsMissingForStory } from "../../../../.storybook/customShipmentStub";
import { PHONE, SELLING_META, clearToasts, sellingAt } from "../../../features/customShipment/storyKit";
import { noteRowIds, seedGoodsMissing } from "../../../features/customShipment/goodsMissingStoryKit";
import { fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";

// *BARANG TIDAK KETEMU* — backlog #88 P6, `missing-goods-leave-a-note-on-the-custom-shipment`, LIVE: the TEAM's side.
// Toko Melati (12), its Owner, on the detail page; the warehouse's notes the server holds are seeded into the stub
// (goodsMissingStoryKit's seedGoodsMissing) and read back as the parcel's `goods_missing` and its GOODS_MISSING trail rows.
//
//   801  sample, Diminta — Gudang Pusat cannot find its 3 Beras on A-01-1
//   803  reship, Diminta — restock 512's 4 broken Kecap already thrown away
//   804  sample, handed over — no note: nothing drawn
//
// What it pins: the notice above the parcel and the trail row as the team reads them, the parcel STILL Diminta with
// Batalkan in the header (a-custom-shipment-is-cancelled-only-while-requested) — the team decides; its cancel is the
// one write, and after it the notice goes while the trail keeps the note.

const At801 = sellingAt("/inventories/custom-shipments/801");
const At803 = sellingAt("/inventories/custom-shipments/803");
const At804 = sellingAt("/inventories/custom-shipments/804");

// The notes the meta seeds, by parcel — filled in before every story.
let seeded: Record<string, bigint> = {};

const meta = {
  title: "Pages/Inventory/CustomShipment/Detail/GoodsMissing",
  component: At801,
  ...SELLING_META,
  beforeEach: () => {
    SELLING_META.beforeEach();
    seeded = seedGoodsMissing("801", "803", "806");
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function opened(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await canvas.findByTestId("custom-shipment-detail-page", {}, { timeout: 4000 });
  return canvas;
}

const kinds = (canvasElement: HTMLElement) =>
  Array.from(within(canvasElement).getByTestId("custom-shipment-timeline").querySelectorAll("[data-kind]")).map((row) =>
    row.getAttribute("data-kind"),
  );

const writes = () => customShipmentWrites().map((c) => ({ rpc: c.rpc, ...c.req }));

// THE TEAM READS THE NOTE — at the top, above the parcel: which warehouse cannot find what, on which rack, its note, and
// what the team may do. The parcel is still Diminta and Batalkan is in the header; the trail row says who wrote it.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);
    const row = `custom-shipment-timeline-missing-${seeded["801"]}`;

    const notice = await canvas.findByTestId("custom-shipment-goods-missing-notice");
    await expect(notice).toHaveAttribute("data-side", "selling");
    await waitFor(() =>
      expect(canvas.getByTestId("custom-shipment-goods-missing-notice-title")).toHaveTextContent("Gudang Pusat cannot find the goods"),
    );
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-line-74-41")).toHaveTextContent(
      "Beras Pandan Wangi 5kg ×3 · rack A-01-1",
    );
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-note")).toHaveTextContent("Sudah cek A-01-1");
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-next")).toHaveTextContent(
      "The parcel stays Requested. Cancel it if it cannot wait",
    );

    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
    await expect(canvas.getByTestId("custom-shipment-action-cancel-801")).toBeVisible();
    // The warehouse's act is never the team's.
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-open")).toBeNull();

    await expect(kinds(canvasElement)).toEqual(["created", "goods-missing"]);
    await waitFor(() => expect(canvas.getByTestId(`${row}-by`)).toHaveTextContent("Budi Santoso"));
    await expect(canvas.getByTestId(`${row}-stays`)).toHaveTextContent(
      "From Gudang Pusat · the parcel stays Requested — cancel it, or wait.",
    );
  },
};

export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(window.innerWidth).toBe(390);
    await expect(await canvas.findByTestId("custom-shipment-goods-missing-notice")).toBeVisible();
    // Batalkan is in the header's ⋯ on a phone.
    await expect(canvas.getByTestId("custom-shipment-actions-801")).toBeVisible();
    await fitsTheScreen(canvasElement);
  },
};

// THE TEAM DECIDES: CANCEL — the one write is the team's own CustomShipmentCancel; the parcel reads Dibatalkan, the notice
// goes (nothing waits on the team any more) and the trail keeps the note before the cancel.
export const TheTeamCancelsAfterTheNote: Story = {
  name: "The team cancels after the note",
  play: async ({ canvasElement }) => {
    clearToasts();
    const canvas = await opened(canvasElement);
    await canvas.findByTestId("custom-shipment-goods-missing-notice");

    await userEvent.click(canvas.getByTestId("custom-shipment-action-cancel-801"));
    await userEvent.click(await screen.findByTestId("confirm-action"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Cancelled"));
    await expect(writes()).toEqual([expect.objectContaining({ rpc: "CustomShipmentCancel", teamId: 12n, id: 801n })]);
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-notice")).toBeNull();
    await expect(kinds(canvasElement)).toEqual(["created", "goods-missing", "status"]);
  },
};

// A RESHIP'S NOTE — the broken units were never on a rack, so the note names none, and a cancel moves no rack stock.
export const AReshipsNote: Story = {
  name: "A reship's note",
  render: () => <At803 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await canvas.findByTestId("custom-shipment-goods-missing-notice");
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-line-76-0")).toHaveTextContent(
      "Kecap Manis 600ml ×4 · broken, never on a rack",
    );
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-next")).toHaveTextContent("no rack stock moves");
    await expect(canvas.getByTestId("custom-shipment-action-cancel-803")).toBeVisible();
  },
};

// A PARCEL WITH NO NOTE draws nothing new — the page is today's.
export const NothingWithoutANote: Story = {
  name: "Nothing without a note",
  render: () => <At804 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.queryByTestId("custom-shipment-goods-missing-notice")).toBeNull();
    await expect(kinds(canvasElement)).toEqual(["created", "status", "status"]);
  },
};

// RECORDED AGAIN — the warehouse may note a parcel again while Diminta (the-goods-missing-prototype-is-accepted's
// default): each note is its own trail row, and the notice reads the LATEST.
export const RecordedAgainTheNoticeReadsTheLatest: Story = {
  name: "Recorded again · the notice reads the latest",
  beforeEach: () => {
    goodsMissingForStory(801n, {
      lines: [{ itemId: 80101n, rackId: 41n, quantity: 1n }],
      note: "Tinggal satu yang tidak ada.",
      actorUserId: 62n,
      atUnix: BigInt(Math.floor(Date.now() / 1000) - 600),
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await waitFor(() => expect(noteRowIds(canvasElement)).toHaveLength(2));
    await expect(kinds(canvasElement)).toEqual(["created", "goods-missing", "goods-missing"]);
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-line-74-41")).toHaveTextContent(
      "Beras Pandan Wangi 5kg ×1 · rack A-01-1",
    );
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-note")).toHaveTextContent("Tinggal satu yang tidak ada.");
    await expect(canvas.getByTestId(`custom-shipment-timeline-missing-${seeded["801"]}-note`)).toHaveTextContent("Sudah cek A-01-1");
  },
};
