import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { customShipmentWrites } from "../../../../.storybook/customShipmentScenario";
import { PHONE, WAREHOUSE_META, clearToasts, typeInto, warehouseAt } from "../../../features/customShipment/storyKit";
import { aSampleOverTwoRacks, goodsMissingSent, noteRowIds, seedGoodsMissing } from "../../../features/customShipment/goodsMissingStoryKit";
import { fitsTheScreen } from "../../../features/warehouseTransfer/storyPhone";

// *BARANG TIDAK KETEMU* — backlog #88 P6, `missing-goods-leave-a-note-on-the-custom-shipment`, LIVE: the WAREHOUSE's side.
// Gudang Pusat (11), its Admin, on the pick page; the stub plays CustomShipmentMissingReport and the parcel's
// `goods_missing` / GOODS_MISSING trail rows (.storybook/customShipmentStub.ts); a story seeds the notes the server
// already holds (goodsMissingStoryKit's seedGoodsMissing).
//
//   801  sample, Diminta — 3 Beras the take drew from A-01-1
//   803  reship, Diminta — 4 broken Kecap of restock 512, never on a rack
//   810  sample, Diminta — 3 Beras drawn 1 from A-01-1 and 2 from B-02-1 (made in the story: aSampleOverTwoRacks)
//   802  sample, picked — no control any more
//
// What it pins: the control only while Diminta, as the writing warehouse; the dialog's racks prefilled from the take
// (every rack its own row and its own most), its confirm waiting for a count; the act sends CustomShipmentMissingReport
// and NOTHING else — no status move, no cancel — and the parcel can still be picked if the goods turn up.

const At801 = warehouseAt("/inventories/custom-shipments/801");
const At802 = warehouseAt("/inventories/custom-shipments/802");
const At803 = warehouseAt("/inventories/custom-shipments/803");
const At810 = warehouseAt("/inventories/custom-shipments/810");

const meta = {
  title: "Pages/Inventory/CustomShipment/Pick/GoodsMissing",
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

async function openDialog(canvasElement: HTMLElement) {
  const canvas = await opened(canvasElement);
  await userEvent.click(await canvas.findByTestId("custom-shipment-goods-missing-open"));
  const dialog = await screen.findByTestId("custom-shipment-goods-missing-dialog");
  await waitFor(() => expect(dialog).toBeVisible());
  return { canvas, dialog: within(dialog) };
}

const kinds = (canvasElement: HTMLElement) =>
  Array.from(within(canvasElement).getByTestId("custom-shipment-timeline").querySelectorAll("[data-kind]")).map((row) =>
    row.getAttribute("data-kind"),
  );

/** The writes other than the note itself — none: a note moves nothing. */
const otherWrites = () => customShipmentWrites().filter((c) => c.rpc !== "CustomShipmentMissingReport");

// The notes this file's stories seed, by parcel — filled in each story's beforeEach.
let seeded: Record<string, bigint> = {};

// THE CONTROL — *Barang Tidak Ketemu* in the header of a Diminta parcel, beside nothing else (the page's step while
// Diminta is the scan below). The warehouse never gets a cancel here, and the scan is still the page's way forward.
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    const open = await canvas.findByTestId("custom-shipment-goods-missing-open");
    await expect(open).toHaveTextContent("Goods Missing");
    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
    await expect(canvas.getByTestId("pick-scan")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-notice")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-action-cancel-801")).toBeNull();
  },
};

// ON A PHONE the header is one row and its action is an icon (a-phone-header-action-is-an-icon) — named for the ear.
export const Mobile: Story = {
  globals: PHONE,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(window.innerWidth).toBe(390);
    const open = await canvas.findByTestId("custom-shipment-goods-missing-open");
    await expect(open).toHaveAttribute("aria-label", "Goods Missing");
    // In the title row, on the same line as the parcel's number.
    const title = canvas.getByTestId("custom-shipment-title").getBoundingClientRect();
    const icon = open.getBoundingClientRect();
    await expect(Math.abs(icon.top + icon.height / 2 - (title.top + title.height / 2))).toBeLessThan(12);
    await fitsTheScreen(canvasElement);
  },
};

// THE DIALOG ON A PHONE — full screen, the rows full width.
export const MobileDialog: Story = {
  name: "Mobile · the dialog",
  globals: PHONE,
  render: () => <At810 />,
  beforeEach: async () => {
    await aSampleOverTwoRacks();
  },
  play: async ({ canvasElement }) => {
    const { dialog } = await openDialog(canvasElement);

    await expect(dialog.getByTestId("custom-shipment-goods-missing-rack-74-43")).toHaveTextContent("B-02-1×2");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-74-43"), "2");
    await waitFor(() => expect(screen.getByTestId("custom-shipment-goods-missing-confirm")).toBeEnabled());
    const box = screen.getByTestId("custom-shipment-goods-missing-dialog").getBoundingClientRect();
    await expect(box.width).toBeLessThanOrEqual(390);
  },
};

// THE RACKS ARE THE TAKE'S, PREFILLED — a line drawn from two racks is two rows, each its own rack and its own most
// (what the take drew there). Nothing is typed for the crew: the confirm waits for a count and says so, a count past the
// rack's units is refused, and Batal sends nothing.
export const TheDialogPrefillsTheRacks: Story = {
  name: "The dialog prefills the racks",
  render: () => <At810 />,
  beforeEach: async () => {
    await aSampleOverTwoRacks();
  },
  play: async ({ canvasElement }) => {
    const { dialog } = await openDialog(canvasElement);

    await expect(screen.getByTestId("custom-shipment-goods-missing-dialog")).toHaveTextContent("Goods Missing · Parcel #810");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-warning")).toHaveTextContent(
      "The parcel stays Requested — Toko Melati decides: cancel it, or wait.",
    );
    await expect(dialog.getByTestId("custom-shipment-goods-missing-where")).toHaveTextContent("On another rack? Take it from there");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-rack-74-41")).toHaveTextContent("A-01-1×1");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-rack-74-43")).toHaveTextContent("B-02-1×2");
    await expect(dialog.getAllByTestId(/^custom-shipment-goods-missing-row-/)).toHaveLength(2);

    const confirm = screen.getByTestId("custom-shipment-goods-missing-confirm");
    await expect(confirm).toBeDisabled();
    await expect(screen.getByTestId("custom-shipment-goods-missing-total")).toHaveTextContent("Type how many are missing");

    // More than the rack's units: refused while typed.
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-74-41"), "2");
    await waitFor(() => expect(confirm).toBeDisabled());
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-74-41"), "1");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-74-43"), "2");
    await waitFor(() => expect(confirm).toBeEnabled());
    await expect(screen.getByTestId("custom-shipment-goods-missing-total")).toHaveTextContent("3 units missing");

    await userEvent.click(screen.getByTestId("custom-shipment-goods-missing-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("custom-shipment-goods-missing-dialog")).toBeNull());
    await expect(goodsMissingSent()).toEqual([]);
  },
};

// THE DIALOG, FILLED IN — the two missing units of B-02-1 and a note; the footer says what it will record, and nothing is
// sent until the confirm. (Left open: the desktop picture of the dialog.)
export const TheDialogFilledIn: Story = {
  name: "The dialog, filled in",
  render: () => <At810 />,
  beforeEach: async () => {
    await aSampleOverTwoRacks();
  },
  play: async ({ canvasElement }) => {
    const { dialog } = await openDialog(canvasElement);

    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-74-43"), "2");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-note"), "Sudah cek B-02-1 dan rak di sebelahnya");
    await waitFor(() => expect(screen.getByTestId("custom-shipment-goods-missing-confirm")).toBeEnabled());
    await expect(screen.getByTestId("custom-shipment-goods-missing-total")).toHaveTextContent("2 units missing");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-note-count")).toHaveTextContent("38");
    await expect(goodsMissingSent()).toEqual([]);
  },
};

// A RESHIP'S DIALOG, FILLED IN — one row per broken line, no rack; its count at most the line's broken units.
export const AReshipsDialog: Story = {
  name: "A reship's dialog",
  render: () => <At803 />,
  play: async ({ canvasElement }) => {
    const { dialog } = await openDialog(canvasElement);

    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-76-0"), "4");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-note"), "Botol pecahnya sudah dibuang waktu restok diterima");
    await waitFor(() => expect(screen.getByTestId("custom-shipment-goods-missing-confirm")).toBeEnabled());
    await expect(screen.getByTestId("custom-shipment-goods-missing-total")).toHaveTextContent("4 units missing");
  },
};

// RECORDING IT KEEPS THE PARCEL DIMINTA — one trail row of its own kind (never read as a cost edit), the notice on the page,
// and nothing else asked of the server: no status move, no cancel. The act sends the lines with their racks and the note
// (CustomShipmentMissingReport). The scan is still there, and so is the control.
export const RecordingKeepsItRequested: Story = {
  name: "Recording keeps it Requested",
  play: async ({ canvasElement }) => {
    clearToasts();
    const { canvas, dialog } = await openDialog(canvasElement);

    await expect(dialog.getByTestId("custom-shipment-goods-missing-rack-74-41")).toHaveTextContent("A-01-1×3");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-74-41"), "3");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-note"), "Sudah cek rak sebelah");
    await waitFor(() => expect(screen.getByTestId("custom-shipment-goods-missing-confirm")).toBeEnabled());
    await userEvent.click(screen.getByTestId("custom-shipment-goods-missing-confirm"));

    await waitFor(() => expect(screen.getByText("Goods missing recorded")).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-goods-missing-notice")).toBeVisible());
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-title")).toHaveTextContent("Goods missing recorded");
    await expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Requested");
    await expect(kinds(canvasElement)).toEqual(["created", "goods-missing"]);
    const [row] = noteRowIds(canvasElement);
    await expect(canvas.getByTestId(`${row}-line-74-41`)).toHaveTextContent("Beras Pandan Wangi 5kg ×3 · rack A-01-1");
    await expect(canvas.getByTestId(`${row}-note`)).toHaveTextContent("Sudah cek rak sebelah");
    // The row shows the status it left the parcel in — still Requested.
    await expect(within(canvas.getByTestId(row!)).getByTestId("custom-shipment-status-requested")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-timeline-awaiting")).toHaveTextContent("Waiting for the warehouse to pick");

    await expect(goodsMissingSent()).toEqual([
      expect.objectContaining({ teamId: 11n, id: 801n, lines: [expect.objectContaining({ itemId: 80101n, rackId: 41n, quantity: 3n })], note: "Sudah cek rak sebelah" }),
    ]);
    await expect(otherWrites()).toEqual([]);
    await expect(canvas.getByTestId("pick-scan")).toBeVisible();
    await expect(canvas.getByTestId("custom-shipment-goods-missing-open")).toBeVisible();
  },
};

// A RESHIP'S BROKEN UNITS WERE NEVER ON A RACK (a-restocks-broken-units-are-just-broken-for-now): its row names no rack —
// the restock and its broken count — and the trail says so.
export const AReshipNamesNoRack: Story = {
  name: "A reship names no rack",
  render: () => <At803 />,
  play: async ({ canvasElement }) => {
    const { canvas, dialog } = await openDialog(canvasElement);

    await expect(dialog.getByTestId("custom-shipment-goods-missing-where")).toHaveTextContent(
      "Broken units of restock #512 — never on a rack.",
    );
    await expect(dialog.getByTestId("custom-shipment-goods-missing-warning")).toHaveTextContent("no rack stock moves");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-warning")).not.toHaveTextContent("stock count");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-rack-76-0")).toHaveTextContent("×4 broken");
    await expect(dialog.getByTestId("custom-shipment-goods-missing-row-76-0")).toHaveTextContent("Broken: Botol pecah");
    await typeInto(dialog.getByTestId("custom-shipment-goods-missing-qty-76-0"), "4");
    await waitFor(() => expect(screen.getByTestId("custom-shipment-goods-missing-confirm")).toBeEnabled());
    await userEvent.click(screen.getByTestId("custom-shipment-goods-missing-confirm"));

    await waitFor(() => expect(noteRowIds(canvasElement)).toHaveLength(1));
    const [row] = noteRowIds(canvasElement);
    await expect(canvas.getByTestId(`${row}-line-76-0`)).toHaveTextContent("Kecap Manis 600ml ×4 · broken, never on a rack");
    await expect(goodsMissingSent()[0]?.lines).toEqual([expect.objectContaining({ itemId: 80301n, rackId: 0n, quantity: 4n })]);
    await expect(otherWrites()).toEqual([]);
  },
};

// THE TRAIL ROW AS THE WAREHOUSE READS IT — who wrote it and when, the lines and racks, the note, and that the parcel
// waits on the team; the notice at the top says the scan still works if the goods turn up.
export const TheWarehouseReadsTheNote: Story = {
  name: "The warehouse reads the note",
  beforeEach: () => {
    seeded = seedGoodsMissing("801");
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);
    const row = `custom-shipment-timeline-missing-${seeded["801"]}`;

    const notice = await canvas.findByTestId("custom-shipment-goods-missing-notice");
    await expect(notice).toHaveAttribute("data-side", "warehouse");
    await expect(canvas.getByTestId("custom-shipment-goods-missing-notice-next")).toHaveTextContent(
      "Waiting for Toko Melati to decide — cancel, or wait. Found after all? Scan it as usual.",
    );
    await waitFor(() => expect(within(canvas.getByTestId(row)).getByTestId(`${row}-by`)).toHaveTextContent("Budi Santoso"));
    await expect(canvas.getByTestId(`${row}-stays`)).toHaveTextContent(
      "The parcel stays Requested — Toko Melati decides: cancel, or wait.",
    );
    await expect(canvas.getByTestId(`${row}-note`)).toHaveTextContent("Sudah cek A-01-1");
    await expect(kinds(canvasElement)).toEqual(["created", "goods-missing"]);
  },
};

// FOUND AFTER ALL — the parcel is still Diminta, so the scan and Sudah Diambil go on as ever; once picked, the control and
// the notice are gone and the trail keeps the note before the pick.
export const FoundAfterAllThePickGoesOn: Story = {
  name: "Found after all, the pick goes on",
  beforeEach: () => {
    seeded = seedGoodsMissing("801");
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);
    await canvas.findByTestId("custom-shipment-goods-missing-notice");

    const input = canvas.getByTestId("pick-scan-input");
    for (let i = 0; i < 3; i++) await userEvent.type(input, "SKU-BERAS-5K{Enter}", { delay: 10 });
    await waitFor(() => expect(canvas.getByTestId("pick-order-set-picked")).toBeEnabled());
    await userEvent.click(canvas.getByTestId("pick-order-set-picked"));

    await waitFor(() => expect(canvas.getByTestId("custom-shipment-detail-status")).toHaveTextContent("Picked"));
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-open")).toBeNull();
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-notice")).toBeNull();
    await expect(kinds(canvasElement)).toEqual(["created", "goods-missing", "status"]);
  },
};

// NOTHING ONCE PICKED — the goods are in the basket; the control is a Diminta parcel's only.
export const NoControlOncePicked: Story = {
  name: "No control once picked",
  render: () => <At802 />,
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("custom-shipment-handover-open")).toBeVisible();
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-open")).toBeNull();
  },
};

// ANOTHER PARCEL'S NOTE STAYS ON IT — 803 is noted; 801 draws the control and no notice, its trail its own rows only.
export const AnotherParcelsNoteStaysOnIt: Story = {
  name: "Another parcel's note stays on it",
  beforeEach: () => {
    seeded = seedGoodsMissing("803");
  },
  play: async ({ canvasElement }) => {
    const canvas = await opened(canvasElement);

    await expect(canvas.getByTestId("pick-scan")).toBeVisible();
    await waitFor(() => expect(canvas.getByTestId("custom-shipment-goods-missing-open")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.queryByTestId("custom-shipment-goods-missing-notice")).toBeNull();
    await expect(kinds(canvasElement)).toEqual(["created"]);
  },
};
